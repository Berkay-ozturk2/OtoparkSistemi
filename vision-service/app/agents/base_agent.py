"""Kamera ajanlarının ortak temeli.

Her ajan kendi iş parçacığında çalışır:
  * cv2.VideoCapture ile kaynak açılır: webcam indeksi ("0"), RTSP/HTTP URL ya da video dosyası
  * video dosyası bitince başa sarılır (demo için sonsuz döngü)
  * kamera ayrı bir iş parçacığında tam hızında okunur (akıcı önizleme); YOLO/OCR her zaman
    en son kareyi işler, böylece işleme yavaş olsa bile gecikme birikmez
  * bağlantı koparsa artan beklemeyle yeniden bağlanılır, durum "Error" olur
  * son işlenmiş (üzerine çizim yapılmış) kare yalnızca BELLEKTE tutulur — diske yazılmaz (KVKK)
"""
from __future__ import annotations

import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Union

import cv2
import numpy as np

from app.agents.shared_camera import SharedWebcamReader, StillImageCapture, is_image_file
from app.config import BASE_DIR
from app.pipeline.recognizer import encode_jpeg

log = logging.getLogger(__name__)

STATUS_STOPPED = "Stopped"
STATUS_RUNNING = "Running"
STATUS_ERROR = "Error"


def parse_source(source: Union[str, int]) -> Union[int, str]:
    """"0" -> 0 (webcam), göreli dosya yolu -> vision-service/ altına göre mutlak yol, URL olduğu gibi."""
    if isinstance(source, int):
        return source
    s = str(source).strip()
    if s.isdigit():
        return int(s)
    if "://" in s:
        return s
    p = Path(s)
    if not p.is_absolute():
        p = BASE_DIR / p
    return str(p)


def is_file_source(source: Union[int, str]) -> bool:
    return isinstance(source, str) and "://" not in source


def mask_source(source: Union[str, int]) -> str:
    """RTSP URL'lerindeki kullanıcı adı/parolayı gizler (rtsp://user:pass@host -> rtsp://***@host)."""
    return re.sub(r"(://)([^/@]+)@", r"\1***@", str(source))


class BaseCameraAgent:
    agent_type = "Base"

    def __init__(self, agent_id: str, source: Union[str, int], target_fps: float = 5.0, enabled: bool = True,
                 name: Optional[str] = None, reconnect_max_seconds: float = 30.0, snapshot_max_width: int = 960,
                 preview_fps: float = 15.0, lot_code: str = "GAZI"):
        self.id = agent_id
        self.lot_code = (lot_code or "GAZI").upper()  # kameranın bağlı olduğu otopark (sözleşme 11.4)
        self.name = name or agent_id
        self.source_raw = str(source)
        self.source = parse_source(source)
        # target_fps: en fazla bu hızda işle; 0 = sınırsız (donanım ne kadar izin verirse)
        self.target_fps = max(0.0, float(target_fps or 0))
        self.enabled = enabled
        self.reconnect_max_seconds = reconnect_max_seconds
        self.snapshot_max_width = snapshot_max_width

        self.status = STATUS_STOPPED
        self.fps = 0.0
        self.last_error: Optional[str] = None
        self.frames_processed = 0

        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._snapshot_lock = threading.Lock()
        self._snapshot_jpeg: Optional[bytes] = None
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame_lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_id = 0
        self._file_period = 1.0 / 25.0
        self.camera_fps = 0.0
        self.loops = 0  # video dosyası kaç kez başa sarıldı (demo)
        self.preview_fps = preview_fps
        self.live_preview = False  # alt sınıf draw_overlay uygularsa True yapar

    # ------------------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self.last_error = None
        self.status = STATUS_RUNNING
        self._thread = threading.Thread(target=self._run, name=f"agent-{self.id}", daemon=True)
        self._thread.start()
        log.info("[%s] ajan başlatıldı (kaynak: %s, hedef FPS: %.1f)", self.id, mask_source(self.source_raw), self.target_fps)

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout)
        self._thread = None
        self.status = STATUS_STOPPED
        self.fps = 0.0
        log.info("[%s] ajan durduruldu", self.id)

    # ------------------------------------------------------------------
    def info(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.agent_type,
            "gate": None,
            "source": mask_source(self.source_raw),
            "enabled": self.enabled,
            "status": self.status,
            "fps": round(self.fps, 2),
            "cameraFps": round(self.camera_fps, 2),
            "lotCode": self.lot_code,
            "name": self.name,
            "framesProcessed": int(getattr(self, "frames_processed", 0) or 0),
            "lastPlate": None,
            "lastError": self.last_error,
        }

    def heartbeat_info(self) -> Dict[str, Any]:
        return {"id": self.id, "type": self.agent_type, "lotCode": self.lot_code, "status": self.status,
                "fps": round(self.fps, 2), "lastError": self.last_error}

    def snapshot(self) -> Optional[bytes]:
        with self._snapshot_lock:
            return self._snapshot_jpeg

    def _set_snapshot(self, frame: Optional[np.ndarray]) -> None:
        if frame is None:
            return
        try:
            if frame.shape[1] > self.snapshot_max_width:
                s = self.snapshot_max_width / frame.shape[1]
                frame = cv2.resize(frame, (self.snapshot_max_width, int(frame.shape[0] * s)), interpolation=cv2.INTER_AREA)
            data = encode_jpeg(frame, 80)
            with self._snapshot_lock:
                self._snapshot_jpeg = data
        except Exception as exc:
            log.debug("[%s] anlık görüntü kodlanamadı: %s", self.id, exc)

    # ------------------------------------------------------------------
    def process_frame(self, frame: np.ndarray, now: float) -> Optional[np.ndarray]:
        """Alt sınıflar kareyi işler ve çizim yapılmış kareyi döndürür."""
        raise NotImplementedError

    def on_start(self) -> None:
        """İş parçacığı başında bir kez çağrılır."""

    def on_stop(self) -> None:
        """İş parçacığı sonunda bir kez çağrılır."""

    # ------------------------------------------------------------------
    def _open(self) -> bool:
        if is_file_source(self.source) and not Path(self.source).exists():
            self._fail(f"Dosya bulunamadı: {self.source_raw} — cameras.yaml'da 'source' alanına var olan bir "
                       f"video/fotoğraf yolu ya da webcam numarası (\"0\") yazın")
            return False
        if isinstance(self.source, int):
            # Webcam paylaşılır: aynı numarayı kullanan ajanlar aynı kareleri alır (Windows'ta webcam tek açılır)
            cap = SharedWebcamReader(self.source)
        elif is_image_file(self.source):
            cap = StillImageCapture(self.source)
            if not cap.isOpened():
                self._fail(f"Fotoğraf okunamadı: {self.source_raw}")
                return False
        else:
            cap = cv2.VideoCapture(self.source)
            if not cap or not cap.isOpened():
                self._fail(f"Kamera kaynağı açılamadı: {mask_source(self.source_raw)}")
                if cap:
                    cap.release()
                return False
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # canlı yayında gecikmeyi azaltır
            except Exception:
                pass
        if is_file_source(self.source):
            vfps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            self._file_period = 1.0 / max(1.0, min(60.0, vfps))
        self._cap = cap
        return True

    def _fail(self, message: str) -> None:
        if self.last_error != message:
            log.warning("[%s] %s", self.id, message)
        self.last_error = message
        self.status = STATUS_ERROR

    def _release(self) -> None:
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
        self._cap = None

    def draw_overlay(self, frame: np.ndarray) -> Optional[np.ndarray]:
        """Canlı önizleme için: ham kareye son işleme sonuçlarını çizer.
        None dönerse önizleme olarak yalnızca işlenmiş kareler kullanılır."""
        return None

    # ------------------------------------------------------------------
    # İki iş parçacığı: (1) yakalama — kameradan kesintisiz kare okur, canlı önizleme üretir;
    # (2) işleme — her zaman EN SON kareyi alır (eski kareler birikmez, gecikme olmaz).
    def _run(self) -> None:
        period = 1.0 / self.target_fps if self.target_fps > 0 else 0.0
        fps_t0 = time.monotonic()
        fps_count = 0
        last_id = 0
        try:
            self.on_start()
        except Exception as exc:
            self._fail(f"Ajan başlatılamadı: {exc}")
        cap_thread = threading.Thread(target=self._capture_loop, name=f"capture-{self.id}", daemon=True)
        cap_thread.start()
        while not self._stop.is_set():
            with self._frame_lock:
                frame, fid = self._latest_frame, self._latest_id
            if frame is None or fid == last_id:
                self._stop.wait(0.005)
                continue
            last_id = fid
            loop_start = time.monotonic()
            try:
                annotated = self.process_frame(frame, time.time())
                if self.status == STATUS_ERROR and self.last_error and self.last_error.startswith("İşleme hatası"):
                    self.status, self.last_error = STATUS_RUNNING, None
                if not self.live_preview:
                    self._set_snapshot(annotated if annotated is not None else frame)
                self.frames_processed += 1
                fps_count += 1
            except Exception as exc:
                log.exception("[%s] kare işlenirken hata: %s", self.id, exc)
                self._fail(f"İşleme hatası: {exc}")
            now = time.monotonic()
            if now - fps_t0 >= 2.0:
                self.fps = fps_count / (now - fps_t0)
                fps_t0, fps_count = now, 0
            wait = period - (time.monotonic() - loop_start)
            if wait > 0:
                self._stop.wait(wait)
        cap_thread.join(3.0)
        self._release()
        try:
            self.on_stop()
        except Exception:
            pass
        with self._frame_lock:
            self._latest_frame = None
        self.status = STATUS_STOPPED
        self.fps = 0.0
        self.camera_fps = 0.0

    def _capture_loop(self) -> None:
        backoff = 1.0
        t0 = time.monotonic()
        count = 0
        last_preview = 0.0
        preview_period = 1.0 / max(1.0, self.preview_fps)
        while not self._stop.is_set():
            if self._cap is None:
                if not self._open():
                    self._stop.wait(backoff)
                    backoff = min(self.reconnect_max_seconds, backoff * 2)
                    continue
                backoff = 1.0
                self.status = STATUS_RUNNING
                self.last_error = None
            read_start = time.monotonic()
            frame = self._read_frame()
            if frame is None:
                continue
            with self._frame_lock:
                self._latest_frame = frame
                self._latest_id += 1
            count += 1
            now = time.monotonic()
            if now - t0 >= 2.0:
                self.camera_fps = count / (now - t0)
                t0, count = now, 0
            if self.live_preview and now - last_preview >= preview_period:
                last_preview = now
                try:
                    self._set_snapshot(self.draw_overlay(frame))
                except Exception as exc:
                    log.debug("[%s] önizleme çizilemedi: %s", self.id, exc)
            if is_file_source(self.source):
                # Video dosyasını gerçek zamanlı oynat (kamerayı taklit eder)
                wait = self._file_period - (time.monotonic() - read_start)
                if wait > 0:
                    self._stop.wait(wait)

    def _read_frame(self) -> Optional[np.ndarray]:
        cap = self._cap
        if cap is None:
            return None
        ok, frame = cap.read()
        if ok and frame is not None:
            return frame
        if is_file_source(self.source):
            # Video bitti: başa sar (sürekli canlı yayın gibi döngü)
            try:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = cap.read()
            except Exception:
                ok, frame = False, None
            if ok and frame is not None:
                self.loops += 1
                return frame
            # Bazı mp4 dosyalarında başa sarma çalışmaz: dosyayı hata vermeden yeniden aç
            self._release()
            if self._open():
                ok, frame = self._cap.read()
                if ok and frame is not None:
                    self.loops += 1
                    return frame
        shared_error = getattr(cap, "error", None)
        self._fail(shared_error or f"Kameradan görüntü alınamadı, yeniden bağlanılıyor: {mask_source(self.source_raw)}")
        self._release()
        self._stop.wait(1.0)
        return None


def _is_windows() -> bool:
    import sys
    return sys.platform.startswith("win")
