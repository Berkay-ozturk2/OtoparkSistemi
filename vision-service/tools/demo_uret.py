"""Gerçek kamera ve otopark OLMADAN uçtan uca test için sentetik demo içeriği üretir.

Üretilenler (varsayılan: vision-service/samples/demo/):
  doluluk.mp4   Üstten görünüşlü GAZI otoparkı. Cepler config/slots.json geometrisiyle BİREBİR çizilir,
                araçlar zamanla park edip ayrılır. Engelli cebe (A02) izinsiz araç park eder -> ihlal demosu.
                cameras.demo.yaml'da `detector: color` ile okunur (demo renk dedektörü).
  giris.mp4     Bariyere yaklaşan, Türk plakalı araçlar (önden görünüş) -> giriş kamerası
  cikis.mp4     Aynı araçlar çıkışta -> çıkış kamerası
  plaka_*.jpg   Tek araç fotoğrafları -> Operatör > Kamera Testi'ne yüklemek için
  plakalar.txt  Videolardaki plakaların listesi

Videolar döngüsel oynatılır (bitince başa sarar), böylece sürekli canlı kamera gibi davranır.

Kullanım:
    python tools/demo_uret.py
    python tools/demo_uret.py --seconds 120 --plates 34KLM482,06AB1903
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from app.pipeline.sample_scene import ASPHALT, CAR_COLORS, draw_car_top  # noqa: E402,F401 (ortak çizim)
from app.pipeline.tr_plate import format_display, is_valid, normalize  # noqa: E402

try:  # polycars 3D araç modelleri (frontend/scripts/convert-polycars.mjs ile üretilir)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import polycar_render  # noqa: E402
except Exception:  # pragma: no cover - model/numpy sorunu olursa düz çizime dön
    polycar_render = None

DEFAULT_PLATES = ["34KLM482", "06ENG061", "06AB1903", "35FH7716", "16YV248", "07H5521"]  # 06ENG061: seed engelli izinli araç
DISABLED_SLOTS = {"A01", "A02"}           # DbSeeder: GAZI'de girişe en yakın iki engelli cep


# ----------------------------------------------------------------------------- yazı tipi / plaka
def _font(size: int):
    from PIL import ImageFont
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf",
                 "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return None


def render_plate(plate: str, width: int = 520) -> np.ndarray:
    """Türk plakası görünümünde görüntü (BGR): beyaz zemin, sol mavi TR şeridi, siyah yazı."""
    h = int(width * 0.215)
    img = np.full((h, width, 3), 255, np.uint8)
    strip = int(width * 0.085)
    cv2.rectangle(img, (0, 0), (strip, h), (160, 60, 0), -1)          # mavi şerit (BGR)
    cv2.rectangle(img, (0, 0), (width - 1, h - 1), (20, 20, 20), max(2, width // 130))
    text = format_display(plate)
    font = _font(int(h * 0.62))
    if font is not None:
        from PIL import Image, ImageDraw
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(pil)
        # Yazıyı plakaya sığdır (şerit hariç genişliğin ~%88'i)
        size = int(h * 0.62)
        while size > 10 and d.textlength(text, font=font) > (width - strip) * 0.88:
            size -= 2
            font = _font(size)
        small = _font(max(8, int(strip * 0.42)))
        if small is not None:
            d.text((strip // 2, int(h * 0.78)), "TR", font=small, fill=(255, 255, 255), anchor="mm")
        d.text((strip + (width - strip) // 2, h // 2), text, font=font, fill=(10, 10, 10), anchor="mm")
        img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    else:  # Pillow/yazı tipi yoksa OpenCV yazısı
        cv2.putText(img, "TR", (int(strip * 0.15), int(h * 0.85)), cv2.FONT_HERSHEY_SIMPLEX, h / 110, (255, 255, 255), 2)
        scale = h / 38
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, 3)
        cv2.putText(img, text, (strip + (width - strip - tw) // 2, (h + th) // 2), cv2.FONT_HERSHEY_DUPLEX,
                    scale, (10, 10, 10), 3, cv2.LINE_AA)
    return img


# ----------------------------------------------------------------------------- giriş/çıkış sahnesi
def draw_car_front(canvas: np.ndarray, cx: int, bottom: int, scale: float, color, plate_img: np.ndarray) -> None:
    """Önden görünüşlü basit araç çizer; plaka tamponun ortasında."""
    w = int(620 * scale)
    h = int(380 * scale)
    x1, y1 = cx - w // 2, bottom - h
    x2, y2 = cx + w // 2, bottom
    shade = tuple(int(c * 0.6) for c in color)
    # gövde ve tavan
    cv2.rectangle(canvas, (x1, y1 + int(h * 0.30)), (x2, y2), color, -1)
    cv2.rectangle(canvas, (x1 + int(w * 0.14), y1), (x2 - int(w * 0.14), y1 + int(h * 0.34)), color, -1)
    # ön cam
    cv2.rectangle(canvas, (x1 + int(w * 0.18), y1 + int(h * 0.05)), (x2 - int(w * 0.18), y1 + int(h * 0.30)),
                  (70, 50, 40), -1)
    # farlar, ızgara, tampon, tekerlekler
    for fx in (x1 + int(w * 0.04), x2 - int(w * 0.20)):
        cv2.rectangle(canvas, (fx, y1 + int(h * 0.42)), (fx + int(w * 0.16), y1 + int(h * 0.54)), (210, 240, 250), -1)
    cv2.rectangle(canvas, (x1 + int(w * 0.30), y1 + int(h * 0.44)), (x2 - int(w * 0.30), y1 + int(h * 0.56)), shade, -1)
    cv2.rectangle(canvas, (x1, y1 + int(h * 0.62)), (x2, y1 + int(h * 0.90)), (45, 45, 45), -1)
    for wx in (x1 + int(w * 0.02), x2 - int(w * 0.16)):
        cv2.rectangle(canvas, (wx, y2 - int(h * 0.10)), (wx + int(w * 0.14), y2), (20, 20, 20), -1)
    # plaka
    pw = int(w * 0.42)
    if pw >= 24:
        p = cv2.resize(plate_img, (pw, int(pw * plate_img.shape[0] / plate_img.shape[1])), interpolation=cv2.INTER_AREA)
        px, py = cx - pw // 2, y1 + int(h * 0.66)
        H, W = canvas.shape[:2]
        if 0 <= px and px + p.shape[1] <= W and 0 <= py and py + p.shape[0] <= H:
            canvas[py:py + p.shape[0], px:px + p.shape[1]] = p


# ----------------------------------------------------------------------------- 3D model araçlar
SPRITE_W = 1100          # en büyük ölçekte (çıkarken ~1.6x) bile keskin kalsın
CAR_W = 540              # ölçek 1'de görüntüdeki araç genişliği (px); 3D araç önden daha uzun göründüğü için eskiden dar


def use_models() -> bool:
    return polycar_render is not None and polycar_render.available()


def assign_cars(plates: Sequence[str], seed: int = 1) -> Dict[str, Tuple[str, tuple]]:
    """Her plakaya bir araç modeli ve rengi; ardışık araçlar mümkün olduğunca farklı model/renk olur.
    Aynı plaka giriş videosunda, çıkış videosunda ve fotoğrafta aynı araçla görünür."""
    rng = random.Random(seed)
    ids = [m["id"] for m in polycar_render.manifest()]
    paints = [p for p, _ in polycar_render.PAINTS_BGR]
    pool_m, pool_p, out = [], [], {}
    for plate in plates:
        if not pool_m:
            pool_m = ids[:]
            weights = [polycar_render.WEIGHTS.get(i, 2) + rng.random() for i in pool_m]
            pool_m = [i for _, i in sorted(zip(weights, pool_m), reverse=True)]   # sık görülen gövdeler önce
            rng.shuffle(pool_m[:4])
        if not pool_p:
            pool_p = paints[:]
            rng.shuffle(pool_p)
        out[plate] = (pool_m.pop(rng.randrange(min(3, len(pool_m)))), pool_p.pop())
    return out


def car_sprite(rng: random.Random, plate: str, car: Optional[Tuple[str, tuple]] = None) -> np.ndarray:
    """polycars aracı (verilmezse rastgele) önden; plakası tamponda (BGRA)."""
    model, paint = car or polycar_render.pick_car(rng)
    yaw = 0.0                                # tam karşıdan: plaka ile gövde aynı hizada kalsın
    img, (px, py), unit = polycar_render.render(model, paint, width=SPRITE_W, front=True, yaw_deg=yaw)
    img = img.copy()
    p = render_plate(plate)
    pw = int(img.shape[1] * 0.44)            # araç eninin ~%44ü: okunabilsin diye gerçeğinden biraz büyük (modeldeki plakayı da örter)
    ph = int(pw * p.shape[0] / p.shape[1])
    p = cv2.resize(p, (pw, ph), interpolation=cv2.INTER_AREA)
    x0, y0 = int(px - pw / 2), int(py - ph / 2)
    H, W = img.shape[:2]
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + pw), min(H, y0 + ph)
    if xb > xa and yb > ya:
        img[ya:yb, xa:xb, :3] = p[ya - y0:yb - y0, xa - x0:xb - x0]
        img[ya:yb, xa:xb, 3] = 255
    return img


def draw_sprite(canvas: np.ndarray, sprite: np.ndarray, cx: int, bottom: int, scale: float) -> None:
    """Araç görüntüsünü alt-orta noktası (cx, bottom) olacak şekilde, gölgesiyle yerleştirir."""
    tw = max(8, int(CAR_W * scale))
    th = max(4, int(sprite.shape[0] * tw / sprite.shape[1]))
    s = cv2.resize(sprite, (tw, th), interpolation=cv2.INTER_AREA)
    H, W = canvas.shape[:2]
    # yumuşak gölge
    shadow = np.zeros((H, W), np.float32)
    cv2.ellipse(shadow, (cx, bottom - int(th * 0.03)), (int(tw * 0.52), max(2, int(th * 0.07))), 0, 0, 360, 0.55, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), max(1.0, tw / 40))
    canvas[:] = (canvas * (1 - shadow[..., None])).astype(np.uint8)
    x0, y0 = cx - tw // 2, bottom - th
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + tw), min(H, y0 + th)
    if xb <= xa or yb <= ya:
        return
    part = s[ya - y0:yb - y0, xa - x0:xb - x0]
    a = part[..., 3:4].astype(np.float32) / 255.0
    region = canvas[ya:yb, xa:xb].astype(np.float32)
    canvas[ya:yb, xa:xb] = (part[..., :3] * a + region * (1 - a)).astype(np.uint8)


def gate_background(w: int, h: int, label: str) -> np.ndarray:
    """Otopark giriş/çıkışı: duvar, kaldırım, şeritli yol, dur çizgisi ve bariyer gövdesi (kolu ayrıca çizilir)."""
    bg = np.zeros((h, w, 3), np.uint8)
    horizon = int(h * 0.55)
    # duvar: üstten alta hafif koyulaşan beton
    for y in range(horizon):
        k = 0.85 + 0.15 * (1 - y / horizon)
        bg[y] = (int(150 * k), int(140 * k), int(128 * k))
    for x in range(0, w, 160):                                       # beton panel derzleri
        cv2.line(bg, (x, 0), (x, horizon), (120, 112, 102), 2)
    cv2.rectangle(bg, (0, int(h * 0.12)), (w, int(h * 0.15)), (115, 108, 98), -1)
    bx0, by0, bx1, by1 = int(w * 0.30), int(h * 0.20), int(w * 0.62), int(h * 0.29)   # tabela
    cv2.rectangle(bg, (bx0 + 6, by0 + 6), (bx1 + 6, by1 + 6), (90, 84, 76), -1)
    cv2.rectangle(bg, (bx0, by0), (bx1, by1), (120, 60, 20), -1)
    cv2.rectangle(bg, (bx0, by0), (bx1, by1), (235, 235, 235), 2)
    cv2.putText(bg, "P  OTOPARK GIRIS", (bx0 + 22, by1 - 20), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (250, 250, 250), 2,
                cv2.LINE_AA)
    # kaldırım
    cv2.rectangle(bg, (0, horizon), (w, horizon + int(h * 0.03)), (175, 175, 170), -1)
    # yol: asfalt, uzağa doğru hafif açık
    for y in range(horizon + int(h * 0.03), h):
        v = int(62 + 18 * (1 - (y - horizon) / (h - horizon)))
        bg[y] = (v, v, v)
    rng = np.random.default_rng(5)
    road = bg[horizon + int(h * 0.03):]
    road[:] = np.clip(road.astype(np.int16) + rng.integers(-5, 6, road.shape[:2] + (1,), dtype=np.int16), 0, 255)
    # şerit kenar çizgileri (perspektifli) ve dur çizgisi
    cx = w // 2 - 60
    for side in (-1, 1):
        top = (cx + side * int(w * 0.20), horizon + int(h * 0.03))
        bot = (cx + side * int(w * 0.52), h)
        cv2.line(bg, top, bot, (210, 210, 210), 4, cv2.LINE_AA)
    stop_y = int(h * 0.80)
    cv2.rectangle(bg, (int(w * 0.08), stop_y), (int(w * 0.82), stop_y + 10), (235, 235, 235), -1)
    _barrier_cabinet(bg, w, h)
    cv2.putText(bg, f"DEMO - {label} kamerasi (sentetik)", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    return bg


BARRIER_ARM = 0.75       # kol uzunluğu (görüntü genişliğine oran)


def _pivot(w: int, h: int) -> Tuple[int, int]:
    return int(w * 0.875), int(h * 0.585)


def _barrier_cabinet(img: np.ndarray, w: int, h: int) -> None:
    """Bariyer motor kutusu: sarı-gri gövde, gölgeli yan yüz, uyarı bandı."""
    x0, x1 = int(w * 0.85), int(w * 0.905)
    y0, y1 = int(h * 0.55), int(h * 0.86)
    cv2.ellipse(img, ((x0 + x1) // 2 + 6, y1), ((x1 - x0) // 2 + 18, 10), 0, 0, 360, (45, 45, 45), -1)
    cv2.rectangle(img, (x0, y0), (x1, y1), (40, 170, 225), -1)                    # ön yüz (sarı, BGR)
    cv2.rectangle(img, (x1, y0 + 6), (x1 + 14, y1), (25, 120, 170), -1)          # yan yüz
    cv2.rectangle(img, (x0 - 4, y0 - 12), (x1 + 16, y0 + 4), (70, 70, 72), -1)   # kapak
    for i in range(6):                                                           # siyah-sarı uyarı bandı
        xa = x0 + i * (x1 - x0) // 6
        cv2.rectangle(img, (xa, y1 - 34), (xa + (x1 - x0) // 12, y1 - 18), (20, 20, 20), -1)
    cv2.rectangle(img, (x0 + 10, y0 + 30), (x1 - 10, y0 + 70), (30, 30, 30), -1)  # durum ekranı yuvası


def draw_barrier(img: np.ndarray, open_frac: float) -> None:
    """Bariyer kolu (kırmızı-beyaz şeritli) ve trafik ışığı; open_frac 0 = kapalı, 1 = tam açık (~85°)."""
    h, w = img.shape[:2]
    px, py = _pivot(w, h)
    ang = math.radians(85 * max(0.0, min(1.0, open_frac)))
    length = w * BARRIER_ARM
    d = np.array([-math.cos(ang), -math.sin(ang)])          # pivottan kol ucuna (sola, açılınca yukarı)
    nrm = np.array([-d[1], d[0]])
    thick = h * 0.022
    segs = 9
    for i in range(segs):
        a = np.array([px, py]) + d * (length * i / segs)
        b = np.array([px, py]) + d * (length * (i + 1) / segs)
        quad = np.array([a - nrm * thick / 2, b - nrm * thick / 2, b + nrm * thick / 2, a + nrm * thick / 2])
        color = (40, 40, 210) if i % 2 == 0 else (245, 245, 245)
        cv2.fillConvexPoly(img, np.round(quad * 16).astype(np.int32), color, cv2.LINE_AA, 4)
    # alt kenar gölge çizgisi ve uç lambası
    a = np.array([px, py]) + nrm * thick / 2
    b = a + d * length
    cv2.line(img, tuple(np.round(a).astype(int)), tuple(np.round(b).astype(int)), (60, 60, 60), 1, cv2.LINE_AA)
    tip = np.array([px, py]) + d * length
    cv2.circle(img, tuple(np.round(tip).astype(int)), int(thick * 0.45), (30, 30, 230), -1, cv2.LINE_AA)
    # dönme göbeği
    cv2.circle(img, (px, py), int(thick * 0.9), (60, 60, 62), -1, cv2.LINE_AA)
    cv2.circle(img, (px, py), int(thick * 0.4), (150, 150, 150), -1, cv2.LINE_AA)
    # trafik ışığı (kapalıyken kırmızı, açıkken yeşil)
    lx, ly = int(w * 0.877), int(h * 0.655)
    cv2.rectangle(img, (lx - 14, ly - 30), (lx + 14, ly + 30), (25, 25, 25), -1)
    green = open_frac > 0.6
    cv2.circle(img, (lx, ly - 14), 10, (40, 40, 255) if not green else (40, 40, 70), -1, cv2.LINE_AA)
    cv2.circle(img, (lx, ly + 14), 10, (80, 230, 60) if green else (40, 70, 40), -1, cv2.LINE_AA)


def make_gate_video(path: Path, plates: Sequence[str], label: str, fps: int, size=(1280, 720), seed: int = 1,
                    lead_cars: int = 0) -> Path:
    """lead_cars>0: video başında o kadar araçlık boşluk bırakılır (çıkış videosunda araçlar önce girsin)."""
    w, h = size
    rng = random.Random(seed)
    bg = gate_background(w, h, label)
    writer, path = _writer(path, fps, size)
    approach, hold, leave, gap = int(2.0 * fps), int(2.5 * fps), int(0.8 * fps), int(1.0 * fps)
    lift = max(1, int(0.8 * fps))
    closed = bg.copy()
    draw_barrier(closed, 0.0)
    for _ in range(lead_cars * (approach + hold + leave + gap)):
        writer.write(closed)
    models = use_models()
    cars = assign_cars(plates) if models else {}
    for plate in plates:
        color = rng.choice(CAR_COLORS)
        plate_img = render_plate(plate)
        sprite = car_sprite(random.Random(f"{seed}-{plate}"), plate, cars[plate]) if models else None
        for i in range(approach + hold + leave):
            frame = bg.copy()
            if i < approach:
                t = i / approach
                scale, bottom = 0.45 + 0.55 * t, int(h * (0.70 + 0.22 * t))
            elif i < approach + hold:
                scale, bottom = 1.0, int(h * 0.92)
            else:
                t = (i - approach - hold) / leave
                scale, bottom = 1.0 + 0.6 * t, int(h * (0.92 + 0.6 * t))
            # Plaka okunduktan sonra (bekleme süresinin ortası) kol kalkar; araç geçerken kolun önündedir
            open_frac = min(1.0, max(0.0, (i - approach - hold // 2) / lift))
            car_in_front = i >= approach + hold

            def car():
                if sprite is not None:
                    draw_sprite(frame, sprite, w // 2 - 60, bottom, scale)
                else:
                    draw_car_front(frame, w // 2 - 60, bottom, scale, color, plate_img)

            if car_in_front:
                draw_barrier(frame, 1.0)
                car()
            else:
                car()
                draw_barrier(frame, open_frac)
            cv2.putText(frame, f"{label}: {format_display(plate)}", (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (255, 255, 255), 1)
            writer.write(frame)
        for g in range(gap):                                   # araç geçti, kol iner
            frame = bg.copy()
            draw_barrier(frame, 1.0 - min(1.0, (g + 1) / lift))
            writer.write(frame)
    writer.release()
    return path


def make_plate_photos(out: Path, plates: Sequence[str], seed: int = 2) -> List[Path]:
    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    cars = assign_cars(plates) if use_models() else {}
    for i, plate in enumerate(plates, 1):
        img = gate_background(1280, 720, "ornek")
        color = rng.choice(CAR_COLORS)
        if use_models():
            draw_sprite(img, car_sprite(random.Random(f"1-{plate}"), plate, cars[plate]), 580, int(720 * 0.92), 1.0)
        else:
            draw_car_front(img, 580, int(720 * 0.92), 1.0, color, render_plate(plate))
        draw_barrier(img, 0.0)
        p = out / f"plaka_{i:02d}_{plate}.jpg"
        cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        paths.append(p)
    return paths


# ----------------------------------------------------------------------------- doluluk sahnesi
def load_slots(path: Path) -> Tuple[int, int, List[Tuple[str, np.ndarray]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    slots = [(s["code"], np.array(s["polygon"], np.int32)) for s in data["slots"]]
    return int(data.get("imageWidth", 1280)), int(data.get("imageHeight", 720)), slots


def lot_background(w: int, h: int, slots, disabled: set) -> np.ndarray:
    bg = np.zeros((h, w, 3), np.uint8)
    bg[:] = ASPHALT
    rng = np.random.default_rng(3)
    noise = rng.integers(-6, 7, size=(h, w, 1), dtype=np.int16)
    bg = np.clip(bg.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    for code, poly in slots:
        cv2.polylines(bg, [poly], True, (235, 235, 235), 2)
        x, y, bw, bh = cv2.boundingRect(poly)
        cv2.putText(bg, code, (x + 6, y + bh - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
        if code in disabled:   # ince mavi işaret (dedektör büyük doygun blok aradığı için araç sayılmaz)
            cv2.rectangle(bg, (x + 4, y + 4), (x + bw - 4, y + bh - 4), (200, 110, 20), 1)
            cv2.putText(bg, "ENGELLI", (x + 8, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 110, 20), 1, cv2.LINE_AA)
    cv2.putText(bg, "DEMO - Doluluk kamerasi (sentetik, GAZI)", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                (255, 255, 255), 2)
    return bg


def build_schedule(codes: Sequence[str], frames: int, fps: int, rng: random.Random) -> Dict[str, List[Tuple[int, int, int]]]:
    """Her cep için (başlangıç, bitiş, renk) aralıkları. Engelli cepler özel senaryo izler."""
    sched: Dict[str, List[Tuple[int, int, int]]] = {}
    for code in codes:
        if code in DISABLED_SLOTS:
            continue
        items = []
        t = 0 if rng.random() < 0.35 else rng.randint(0, frames // 3)
        while t < frames:
            dur = rng.randint(int(frames * 0.15), int(frames * 0.55))
            items.append((t, min(frames - 1, t + dur), rng.randrange(len(CAR_COLORS))))
            t += dur + rng.randint(int(frames * 0.05), int(frames * 0.35))
        sched[code] = items
    # Engelli cepler: A01 izinli araç gibi (simülatör/LPR ile girer), A02 İZİNSİZ park -> ihlal, sonra ayrılır
    if "A01" in codes:
        sched["A01"] = [(int(frames * 0.20), int(frames * 0.55), 6)]
    if "A02" in codes:
        sched["A02"] = [(int(frames * 0.45), int(frames * 0.75), 0)]
    return sched


def make_occupancy_video(path: Path, slots_file: Path, seconds: int, fps: int, seed: int = 7) -> Path:
    w, h, slots = load_slots(slots_file)
    frames = seconds * fps
    rng = random.Random(seed)
    sched = build_schedule([c for c, _ in slots], frames, fps, rng)
    bg = lot_background(w, h, slots, DISABLED_SLOTS)
    writer, path = _writer(path, fps, (w, h))
    slide_frames = max(1, int(1.2 * fps))
    for f in range(frames):
        frame = bg.copy()
        for code, poly in slots:
            for start, end, ci in sched.get(code, []):
                if start <= f <= end:
                    if f - start < slide_frames:
                        alpha = (f - start + 1) / slide_frames         # park ediyor
                    elif end - f < slide_frames:
                        alpha = (end - f + 1) / slide_frames           # ayrılıyor
                    else:
                        alpha = 1.0
                    draw_car_top(frame, poly, CAR_COLORS[ci], alpha)
        cv2.putText(frame, f"t={f / fps:5.1f}s", (w - 160, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        writer.write(frame)
    writer.release()
    return path


# ----------------------------------------------------------------------------- yardımcılar
def _writer(path: Path, fps: int, size: Tuple[int, int]):
    path.parent.mkdir(parents=True, exist_ok=True)
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if w.isOpened():
        return w, path
    alt = path.with_suffix(".avi")   # mp4 kodlayıcısı yoksa
    w = cv2.VideoWriter(str(alt), cv2.VideoWriter_fourcc(*"MJPG"), fps, size)
    if not w.isOpened():
        raise RuntimeError(f"Video yazılamadı: {path}")
    print(f"  ! mp4 kodlayıcısı yok, {alt.name} olarak yazılıyor (cameras.demo.yaml'da uzantıyı değiştirin)")
    return w, alt


def parse_args(argv: Optional[Sequence[str]] = None):
    ap = argparse.ArgumentParser(description="Sentetik demo videoları ve plaka fotoğrafları üretir")
    ap.add_argument("--out", default=str(BASE / "samples" / "demo"), help="Çıktı klasörü")
    ap.add_argument("--slots", default=str(BASE / "config" / "slots.json"), help="Cep poligonları")
    ap.add_argument("--seconds", type=int, default=90, help="Doluluk videosu süresi (sn)")
    ap.add_argument("--fps", type=int, default=10, help="Doluluk videosu FPS")
    ap.add_argument("--gate-fps", type=int, default=15, help="Giriş/çıkış videosu FPS")
    ap.add_argument("--plates", default=",".join(DEFAULT_PLATES), help="Virgülle plakalar")
    ap.add_argument("--only", choices=["doluluk", "giris", "cikis", "foto"], help="Yalnızca birini üret")
    return ap.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    a = parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    plates = [normalize(p) for p in a.plates.split(",") if p.strip()]
    bad = [p for p in plates if not is_valid(p)]
    if bad:
        print(f"Geçersiz TR plaka biçimi: {bad}")
        return 2
    print(f"Demo içeriği üretiliyor -> {out}")
    if a.only in (None, "doluluk"):
        p = make_occupancy_video(out / "doluluk.mp4", Path(a.slots), a.seconds, a.fps)
        print(f"  ✔ {p.name}  ({a.seconds} sn, slots.json ile birebir cepler)")
    if a.only in (None, "giris"):
        p = make_gate_video(out / "giris.mp4", plates, "GIRIS", a.gate_fps, seed=1)
        print(f"  ✔ {p.name}  ({len(plates)} araç)")
    if a.only in (None, "cikis"):
        p = make_gate_video(out / "cikis.mp4", plates, "CIKIS", a.gate_fps, seed=1, lead_cars=2)
        print(f"  ✔ {p.name}  ({len(plates)} araç; girişten 2 araç sonra başlar)")
    if a.only in (None, "foto"):
        for p in make_plate_photos(out, plates):
            print(f"  ✔ {p.name}")
    (out / "plakalar.txt").write_text("\n".join(format_display(p) for p in plates) + "\n", encoding="utf-8")
    print("Bitti. Demo kameraları için: scripts\\6_demo_baslat.bat (CAMERAS_FILE=config/cameras.demo.yaml)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
