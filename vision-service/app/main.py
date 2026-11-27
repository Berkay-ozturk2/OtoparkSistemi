"""Görüntü İşleme Servisi — FastAPI uygulaması.

Çalıştırma (vision-service klasöründe):
    uvicorn app.main:app --port 8000

Uç noktalar API sözleşmesi bölüm 9'daki gibidir.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Literal, Optional

import cv2
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.agents.manager import AgentManager
from app.backend_client import BackendClient, utc_now_iso
from app.config import get_settings
from app.model_registry import ModelRegistry
from app.pipeline.demo_detector import ColorVehicleDetector
from app.pipeline.layouts import LayoutNotFound, LayoutRegistry
from app.pipeline.occupancy import draw_layout, evaluate_slots
from app.pipeline.sample_scene import render_sample
from app.pipeline.recognizer import annotate_plates, best_result, decode_image, to_base64_jpeg
from app.schemas import (AgentInfo, HealthResponse, LayoutSummary, OccupancyAnalyzeResponse, RecognizeResponse)

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("vision")

registry = ModelRegistry(settings)
backend = BackendClient(settings.BACKEND_URL, settings.VISION_API_KEY, settings.BACKEND_TIMEOUT, settings.BACKEND_RETRIES)
manager = AgentManager(settings, registry, backend)
layouts = LayoutRegistry(settings.slots_file, settings.slots_dir)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("Görüntü işleme servisi başlıyor (backend: %s)", settings.BACKEND_URL)
    registry.start_background_load()  # modeller arka planda yüklenir; servis hemen yanıt verir
    manager.load()
    if settings.AUTOSTART_AGENTS:
        manager.start_enabled()
    manager.start_heartbeat()
    try:
        yield
    finally:
        log.info("Servis kapanıyor; ajanlar durduruluyor...")
        manager.shutdown()
        backend.close()


app = FastAPI(
    title="Akıllı Otopark — Görüntü İşleme Servisi",
    version="1.0.0",
    description="Plaka tanıma (YOLOv8 + OCR) ve cep doluluk analizi. BMT-315 dönem projesi.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------
# Hata yanıtları: { "message": "Türkçe açıklama" } (sözleşme bölüm 1)
# ----------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_req: Request, exc: StarletteHTTPException):
    msg = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail, ensure_ascii=False)
    if exc.status_code == 404 and msg == "Not Found":
        msg = "Uç nokta bulunamadı"
    return JSONResponse(status_code=exc.status_code, content={"message": msg}, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_req: Request, exc: RequestValidationError):
    parts = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x not in ("body", "query"))
        parts.append(f"{loc}: {err.get('msg')}")
    return JSONResponse(status_code=422, content={"message": "Geçersiz istek — " + "; ".join(parts)})


@app.exception_handler(Exception)
async def unhandled_error_handler(_req: Request, exc: Exception):
    log.exception("Beklenmeyen hata: %s", exc)
    return JSONResponse(status_code=500, content={"message": f"Sunucu hatası: {exc.__class__.__name__}"})


# ----------------------------------------------------------------------
def _read_upload(file: UploadFile):
    data = file.file.read()
    if not data:
        raise HTTPException(400, "Dosya boş ya da gönderilmedi (multipart alan adı: file)")
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Dosya çok büyük (en fazla {settings.MAX_UPLOAD_MB:.0f} MB)")
    img = decode_image(data)
    if img is None:
        raise HTTPException(400, "Görüntü çözülemedi; JPEG/PNG/BMP bir resim yükleyin")
    return img


def _layout_or_error(layout_id: Optional[str], lot: Optional[str]):
    try:
        return layouts.resolve(layout_id, lot)
    except LayoutNotFound as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


def _agent_or_404(agent_id: str):
    agent = manager.get(agent_id)
    if agent is None:
        raise HTTPException(404, f"Ajan bulunamadı: {agent_id}")
    return agent


# ----------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, response_model_by_alias=True)
def health():
    return {
        "status": "ok",
        "models": registry.health(),
        "details": {**registry.details(), "backendUrl": settings.BACKEND_URL,
                    "backendLastError": backend.last_error, "backendLastSuccess": backend.last_success},
        "agents": len(manager.agents),
    }


@app.get("/agents", response_model=list[AgentInfo], response_model_by_alias=True)
def list_agents():
    return manager.list_info()


@app.post("/agents/{agent_id}/start", response_model=AgentInfo, response_model_by_alias=True)
def start_agent(agent_id: str):
    agent = _agent_or_404(agent_id)
    manager.start(agent_id)  # aynı webcam'i kullanan diğer giriş/çıkış ajanı durdurulur
    return agent.info()


@app.post("/agents/{agent_id}/stop", response_model=AgentInfo, response_model_by_alias=True)
def stop_agent(agent_id: str):
    agent = _agent_or_404(agent_id)
    agent.stop()
    return agent.info()


@app.post("/agents/{agent_id}/assign", response_model=AgentInfo, response_model_by_alias=True)
def assign_agent(
    agent_id: str,
    lot: Optional[str] = Query(None, description="Otopark kodu (giriş/çıkış kamerası için)"),
    layout: Optional[str] = Query(None, description="Cep yerleşimi kimliği (doluluk kamerası için, ör. MERKEZ-K1)"),
):
    """Kamerayı başka bir otoparka / krokiye bağlar (servis yeniden başlayana kadar).
    Çalışan kamera yeni ayarla yeniden başlatılır."""
    agent = _agent_or_404(agent_id)
    if agent.agent_type == "Occupancy":
        entry = _layout_or_error(layout, lot)
        manager.assign(agent_id, entry.lot_code, entry)
    else:
        if not lot or not lot.strip():
            raise HTTPException(400, "Otopark kodu (lot) gerekli")
        manager.assign(agent_id, lot.strip().upper())
    return agent.info()


@app.get("/agents/{agent_id}/snapshot", responses={200: {"content": {"image/jpeg": {}}}})
def agent_snapshot(agent_id: str):
    agent = _agent_or_404(agent_id)
    data = agent.snapshot()
    if not data:
        raise HTTPException(404, "Henüz işlenmiş kare yok (ajan çalışıyor mu?)")
    # Yalnızca bellekten sunulur; tarayıcı önbelleğe almasın
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/agents/{agent_id}/stream")
async def agent_stream(agent_id: str, request: Request,
                       fps: float = Query(15.0, ge=1, le=30, description="Akış kare hızı")):
    """Canlı MJPEG akışı (<img src> ile doğrudan izlenir). Kareler yalnızca bellekten okunur, kaydedilmez.

    Akış şu durumlarda KENDİLİĞİNDEN biter (bağlantılar birikip tarayıcıyı kilitlemesin diye):
      * tarayıcı ayrıldığında (sekme kapandı, başka kameraya geçildi)
      * ajan durdurulduğunda (2 sn sonra)
      * en fazla 30 dakika sonra (tarayıcı otomatik yeniden bağlanabilir)
    Yeni kare olmasa bile her saniye son kare yeniden gönderilir; böylece kopan bağlantı fark edilir.
    """
    agent = _agent_or_404(agent_id)
    interval = 1.0 / fps

    async def frames():
        last = None
        last_sent = 0.0
        stopped_since = None
        started = time.monotonic()
        try:
            while True:
                now = time.monotonic()
                if await request.is_disconnected() or now - started > 1800:
                    break
                if not agent.running:
                    stopped_since = stopped_since or now
                    if now - stopped_since > 2.0:
                        break
                else:
                    stopped_since = None
                data = agent.snapshot()
                if data is not None and (data is not last or now - last_sent >= 1.0):
                    last, last_sent = data, now
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                           + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
                await asyncio.sleep(interval)
        except (asyncio.CancelledError, ConnectionError):  # tarayıcı bağlantıyı kapattı
            return

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/recognize", response_model=RecognizeResponse, response_model_by_alias=True)
def recognize(
    file: UploadFile = File(..., description="Araç/plaka resmi"),
    gate: Literal["Entry", "Exit"] = Query("Entry"),
    forward: bool = Query(False, description="true ise en iyi sonuç backend'e plaka olayı olarak gönderilir"),
    camera_id: str = Query("web-test", alias="cameraId"),
    lot: str = Query("GAZI", description="Olayın gönderileceği otopark kodu"),
):
    reason = registry.unavailable_reason(["plate"])
    if reason:
        raise HTTPException(503, reason)
    img = _read_upload(file)
    t0 = time.perf_counter()
    results = registry.recognizer.recognize(img, fast=False)
    elapsed = (time.perf_counter() - t0) * 1000
    annotated = annotate_plates(img, results)

    backend_response = None
    message = None
    if not results:
        message = "Görüntüde plaka bulunamadı"
    elif registry.ocr.name == "none":
        message = "OCR motoru yüklü değil; yalnızca plaka konumu bulundu (easyocr kurun ya da char_reader.pt ekleyin)"
    if forward:
        best = best_result(results)
        if best is None:
            message = (message or "") + " — backend'e gönderilecek okunmuş plaka yok"
        else:
            ok, body = backend.send_plate_event(
                camera_id, gate, best.plate, best.confidence, best.format_valid,
                to_base64_jpeg(best.crop, 85, 400) if settings.SEND_PLATE_CROP else None, utc_now_iso(),
                lot_code=lot.upper())
            backend_response = body if ok else {"message": "Backend'e ulaşılamadı ya da istek reddedildi",
                                                "detail": body, "error": backend.last_error}
    return {
        "plates": [r.to_api() for r in results],
        "backendResponse": backend_response,
        "elapsedMs": round(elapsed, 1),
        "annotatedImageBase64": to_base64_jpeg(annotated, 85, 1280),
        "ocr": registry.ocr.name,
        "message": message,
    }


@app.post("/occupancy/analyze", response_model=OccupancyAnalyzeResponse, response_model_by_alias=True)
def occupancy_analyze(
    file: UploadFile = File(..., description="Otopark görüntüsü (seçilen cep yerleşimiyle aynı bakış açısı)"),
    forward: bool = Query(False),
    camera_id: str = Query("web-test", alias="cameraId"),
    threshold: Optional[float] = Query(None, ge=0.05, le=0.95),
    lot: Optional[str] = Query(None, description="Otopark kodu (layout yoksa o otoparkın ilk yerleşimi)"),
    layout: Optional[str] = Query(None, description="Cep yerleşimi kimliği (GET /config/layouts)"),
    detector: Literal["yolo", "color"] = Query(
        "yolo", description="yolo: gerçek fotoğraf; color: sentetik örnek görüntü (GET /occupancy/sample)"),
):
    entry = _layout_or_error(layout, lot)
    if detector == "yolo":
        reason = registry.unavailable_reason(["vehicle"])
        if reason:
            raise HTTPException(503, reason)
    img = _read_upload(file)
    t0 = time.perf_counter()
    h, w = img.shape[:2]
    slot_layout = entry.layout.scaled(w, h)
    if detector == "color":
        vd = ColorVehicleDetector.for_layout(slot_layout, w, h)
    else:
        vd = registry.vehicle_detector
    vehicles = vd.detect(img, conf=settings.VEHICLE_CONFIDENCE)
    obs = evaluate_slots(slot_layout, [v.bbox for v in vehicles], [v.confidence for v in vehicles],
                         threshold or settings.OCCUPANCY_THRESHOLD, settings.OCCUPANCY_FOOTPRINT)
    elapsed = (time.perf_counter() - t0) * 1000
    annotated = draw_layout(img, slot_layout, {o.code: o.occupied for o in obs})
    for v in vehicles:
        x1, y1, x2, y2 = [int(a) for a in v.bbox]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 160, 0), 2)
    slots = [{"code": o.code, "occupied": o.occupied, "confidence": o.confidence} for o in obs]
    backend_response = None
    if forward:
        ok = backend.send_occupancy(camera_id, slots, utc_now_iso(), lot_code=entry.lot_code)
        backend_response = {"sent": ok, "error": None if ok else backend.last_error}
    return {
        "slots": slots,
        "vehicles": len(vehicles),
        "layout": entry.id,
        "lotCode": entry.lot_code,
        "detector": detector,
        "annotatedImageBase64": to_base64_jpeg(annotated, 85, 1280),
        "elapsedMs": round(elapsed, 1),
        "backendResponse": backend_response,
    }


@app.get("/occupancy/sample", responses={200: {"content": {"image/jpeg": {}}}})
def occupancy_sample(
    layout: Optional[str] = Query(None, description="Cep yerleşimi kimliği"),
    lot: Optional[str] = Query(None, description="Otopark kodu (layout yoksa)"),
    ratio: float = Query(0.5, ge=0, le=1, description="Dolu cep oranı"),
    seed: Optional[int] = Query(None, description="Aynı görüntüyü yeniden üretmek için"),
):
    """Seçilen kroki için sentetik üstten görünüş otopark görüntüsü (Kamera Testi için).
    Analizde detector=color kullanın; YOLO çizilmiş araçları güvenilir tanımaz."""
    entry = _layout_or_error(layout, lot)
    img, occupied = render_sample(entry.layout, ratio, seed, title=f"ORNEK - {entry.layout.name or entry.id}")
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(500, "Örnek görüntü kodlanamadı")
    return Response(content=buf.tobytes(), media_type="image/jpeg", headers={
        "Cache-Control": "no-store",
        "X-Layout": entry.id,
        "X-Occupied-Count": str(len(occupied)),
        "Access-Control-Expose-Headers": "X-Layout, X-Occupied-Count",
    })


@app.get("/config/layouts", response_model=list[LayoutSummary], response_model_by_alias=True)
def config_layouts(lot: Optional[str] = Query(None, description="Yalnızca bu otoparkın yerleşimleri")):
    """Tanımlı doluluk kamerası görüş alanları (otopark / kat başına cep yerleşimleri)."""
    entries = layouts.for_lot(lot) if lot else layouts.entries()
    return [e.summary() for e in entries]


@app.get("/config/slots")
def config_slots(layout: Optional[str] = Query(None), lot: Optional[str] = Query(None)):
    entry = _layout_or_error(layout, lot)
    try:
        return entry.layout.to_dict()
    except Exception as exc:
        raise HTTPException(500, f"{entry.path.name} okunamadı: {exc}")


@app.get("/", include_in_schema=False)
def root():
    return {"message": "Akıllı Otopark görüntü işleme servisi çalışıyor. Belgeler: /docs"}
