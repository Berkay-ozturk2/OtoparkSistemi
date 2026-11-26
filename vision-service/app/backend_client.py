"""Ana backend'e (ASP.NET Core) makineler arası istemci.

Sözleşme bölüm 3: X-Api-Key başlığı ile
  POST /api/vision/plate-events
  POST /api/vision/occupancy
  POST /api/vision/heartbeat

Hata durumunda log yazılır ve (yeniden denenebilir hatalarda) üstel bekleme ile yeniden denenir;
hiçbir hata servisi çökertmez. Kamera döngüsünü bekletmemek için ajanlar submit_* ile
arka plandaki iş havuzunu kullanır.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

log = logging.getLogger(__name__)


def utc_now_iso() -> str:
    """ISO-8601 UTC zaman damgası: 2026-11-25T08:30:00Z"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class BackendClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 5.0, retries: int = 3,
                 backoff: float = 0.5, max_workers: int = 2):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.retries = max(1, retries)
        self.backoff = backoff
        self._session = requests.Session()
        self._session.headers.update({"X-Api-Key": api_key, "Content-Type": "application/json",
                                      "User-Agent": "otopark-vision-service/1.0"})
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="backend")
        self._lock = threading.Lock()
        self._last_warn: Dict[str, float] = {}
        self.last_error: Optional[str] = None
        self.last_success: Optional[str] = None

    # ------------------------------------------------------------------
    def _warn(self, key: str, msg: str, *args) -> None:
        """Aynı uyarıyı 30 sn'de bir yazar (backend kapalıyken log selini önler)."""
        now = time.monotonic()
        with self._lock:
            if now - self._last_warn.get(key, -1e9) < 30:
                log.debug(msg, *args)
                return
            self._last_warn[key] = now
        log.warning(msg, *args)

    def post_json(self, path: str, payload: Dict[str, Any], retries: Optional[int] = None) -> Tuple[bool, Optional[Any], Optional[int]]:
        """JSON gönderir. Dönüş: (başarılı mı, yanıt gövdesi ya da None, HTTP kodu)."""
        url = f"{self.base_url}{path}"
        attempts = self.retries if retries is None else max(1, retries)
        last_status: Optional[int] = None
        for attempt in range(1, attempts + 1):
            try:
                resp = self._session.post(url, json=payload, timeout=self.timeout)
                last_status = resp.status_code
                if 200 <= resp.status_code < 300:
                    body = None
                    if resp.content:
                        try:
                            body = resp.json()
                        except ValueError:
                            body = resp.text
                    self.last_success = utc_now_iso()
                    self.last_error = None
                    return True, body, resp.status_code
                message = _error_message(resp)
                self.last_error = f"{path}: HTTP {resp.status_code} {message}"
                # 4xx (429 hariç) yeniden denemeyle düzelmez
                if 400 <= resp.status_code < 500 and resp.status_code != 429:
                    self._warn(path + str(resp.status_code), "Backend isteği reddetti %s: HTTP %s %s",
                               path, resp.status_code, message)
                    try:
                        body = resp.json()
                    except ValueError:
                        body = {"message": message}
                    return False, body, resp.status_code
                self._warn(path, "Backend hatası %s: HTTP %s (deneme %d/%d)", path, resp.status_code, attempt, attempts)
            except requests.RequestException as exc:
                self.last_error = f"{path}: {exc.__class__.__name__}"
                self._warn(path, "Backend'e ulaşılamadı %s (%s) — deneme %d/%d", url, exc.__class__.__name__, attempt, attempts)
            except Exception as exc:  # beklenmeyen: servis çökmesin
                self.last_error = f"{path}: {exc}"
                log.exception("Backend isteğinde beklenmeyen hata: %s", exc)
                return False, None, last_status
            if attempt < attempts:
                time.sleep(self.backoff * (2 ** (attempt - 1)))
        return False, None, last_status

    # ------------------------------------------------------------------
    def send_plate_event(self, camera_id: str, gate: str, plate: str, confidence: float, format_valid: bool,
                         image_base64: Optional[str] = None, timestamp: Optional[str] = None,
                         lot_code: Optional[str] = None) -> Tuple[bool, Optional[Any]]:
        payload = build_plate_event(camera_id, gate, plate, confidence, format_valid, image_base64, timestamp,
                                    lot_code=lot_code)
        ok, body, _ = self.post_json("/api/vision/plate-events", payload)
        if ok:
            log.info("Plaka olayı gönderildi: %s %s %s (güven %.2f) -> %s", camera_id, gate, plate, confidence,
                     (body or {}).get("decision") if isinstance(body, dict) else body)
        return ok, body

    def send_occupancy(self, camera_id: str, slots: List[Dict[str, Any]], timestamp: Optional[str] = None,
                       lot_code: Optional[str] = None) -> bool:
        payload = {"cameraId": camera_id, "timestamp": timestamp or utc_now_iso(), "slots": slots}
        if lot_code:
            payload["lotCode"] = lot_code  # sözleşme 11.4 — kameranın bağlı olduğu otopark
        ok, _, _ = self.post_json("/api/vision/occupancy", payload)
        if ok:
            log.debug("Doluluk gönderildi: %s (%d cep)", camera_id, len(slots))
        return ok

    def send_heartbeat(self, agents: List[Dict[str, Any]]) -> bool:
        ok, _, _ = self.post_json("/api/vision/heartbeat", {"agents": agents}, retries=1)
        return ok

    # Arka planda (kamera döngüsünü bekletmeden) gönderim ----------------
    def submit(self, fn, *args, **kwargs) -> Optional[Future]:
        try:
            return self._executor.submit(fn, *args, **kwargs)
        except RuntimeError:  # kapatılmışsa
            return None

    def close(self) -> None:
        self._executor.shutdown(wait=False)
        self._session.close()


def build_plate_event(camera_id: str, gate: str, plate: str, confidence: float, format_valid: bool,
                      image_base64: Optional[str] = None, timestamp: Optional[str] = None,
                      lot_code: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "cameraId": camera_id,
        "gate": gate,
        "plate": plate,
        "confidence": round(float(max(0.0, min(1.0, confidence))), 4),
        "formatValid": bool(format_valid),
        "timestamp": timestamp or utc_now_iso(),
    }
    if lot_code:
        payload["lotCode"] = lot_code
    if image_base64:
        payload["imageBase64"] = image_base64
    return payload


def _error_message(resp) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict):
            return str(data.get("message") or data.get("title") or data)[:200]
    except ValueError:
        pass
    return (resp.text or "")[:200]
