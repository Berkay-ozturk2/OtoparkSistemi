"""Kamera paylaşımı ve sabit resim kaynağı.

Windows'ta bir webcam'i aynı anda yalnızca TEK bir VideoCapture açabilir. Giriş, çıkış ve doluluk
ajanları aynı webcam'i ("0") kullanmak istediğinde kamera bir kez açılır (SharedWebcam) ve her
ajan, VideoCapture gibi davranan bir okuyucu (SharedWebcamReader) üzerinden aynı kareleri alır.

Ayrıca doluluk kamerası için tek bir otopark FOTOĞRAFI (jpg/png) kaynak olarak verilebilir
(StillImageCapture): fotoğraf sürekli aynı kare olarak döndürülür.
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger(__name__)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def is_image_file(source) -> bool:
    return isinstance(source, str) and "://" not in source and Path(source).suffix.lower() in IMAGE_SUFFIXES


def _is_windows() -> bool:
    return sys.platform.startswith("win")


def open_webcam(index: int, stop: Optional[threading.Event] = None, tag: str = "") -> Optional[cv2.VideoCapture]:
    """Webcam'i sırayla farklı yöntemlerle dener; ilk GERÇEKTEN kare veren yöntemi döndürür.
    Bazı dizüstü kameraları MJPG'yi desteklemez ya da DirectShow ile boş kare verir."""
    attempts = []
    if _is_windows():
        if hasattr(cv2, "CAP_DSHOW"):
            attempts += [("DirectShow + MJPG", cv2.CAP_DSHOW, True), ("DirectShow", cv2.CAP_DSHOW, False)]
        if hasattr(cv2, "CAP_MSMF"):
            attempts.append(("Media Foundation", cv2.CAP_MSMF, False))
    attempts.append(("varsayılan", None, False))
    for name, api, mjpg in attempts:
        if stop is not None and stop.is_set():
            return None
        try:
            cap = cv2.VideoCapture(index, api) if api is not None else cv2.VideoCapture(index)
        except Exception:
            continue
        if not cap or not cap.isOpened():
            if cap:
                cap.release()
            continue
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if mjpg:
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                cap.set(cv2.CAP_PROP_FPS, 30)
        except Exception:
            pass
        for _ in range(10):  # bazı kameralar ilk birkaç karede boş döner
            ret, frame = cap.read()
            if ret and frame is not None and frame.size > 0:
                log.info("[%s] webcam %d açıldı (%s)", tag or "kamera", index, name)
                return cap
            time.sleep(0.05)
        log.info("[%s] webcam %d '%s' yöntemiyle görüntü vermedi, başka yöntem deneniyor", tag or "kamera", index, name)
        cap.release()
    return None


WEBCAM_ERROR = ("Webcam {i} açılamadı ya da görüntü vermiyor. Kamera başka bir uygulamada (Zoom, Teams, Kamera) "
                "açık olabilir, Windows gizlilik ayarlarında masaüstü uygulamalarının kameraya erişimi kapalı olabilir "
                "ya da kamera numarası farklı olabilir (scripts\\5_kamera_bul.bat ile bulun; cameras.yaml: source)")


class SharedWebcam:
    """Bir webcam'i tek kez açıp karelerini tüm abonelere dağıtır (referans sayımlı)."""

    _registry: Dict[int, "SharedWebcam"] = {}
    _registry_lock = threading.Lock()

    def __init__(self, index: int):
        self.index = index
        self.refs = 0
        self.error: Optional[str] = None
        self._cond = threading.Condition()
        self._frame: Optional[np.ndarray] = None
        self._frame_id = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name=f"webcam-{index}", daemon=True)
        self._thread.start()

    # -- kayıt ---------------------------------------------------------
    @classmethod
    def acquire(cls, index: int) -> "SharedWebcam":
        with cls._registry_lock:
            cam = cls._registry.get(index)
            if cam is None:
                cam = cls(index)
                cls._registry[index] = cam
            cam.refs += 1
            return cam

    def release(self) -> None:
        with SharedWebcam._registry_lock:
            self.refs -= 1
            if self.refs > 0:
                return
            SharedWebcam._registry.pop(self.index, None)
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        if threading.current_thread() is not self._thread:
            self._thread.join(3.0)

    # -- okuma döngüsü ---------------------------------------------------
    def _loop(self) -> None:
        backoff = 1.0
        cap: Optional[cv2.VideoCapture] = None
        while not self._stop.is_set():
            if cap is None:
                cap = open_webcam(self.index, self._stop, tag=f"webcam-{self.index}")
                if cap is None:
                    self.error = WEBCAM_ERROR.format(i=self.index)
                    with self._cond:
                        self._cond.notify_all()
                    self._stop.wait(backoff)
                    backoff = min(30.0, backoff * 2)
                    continue
                backoff = 1.0
                self.error = None
            ok, frame = cap.read()
            if not ok or frame is None:
                log.warning("webcam %d görüntü vermeyi bıraktı, yeniden bağlanılıyor", self.index)
                cap.release()
                cap = None
                self._stop.wait(1.0)
                continue
            with self._cond:
                self._frame = frame
                self._frame_id += 1
                self._cond.notify_all()
        if cap is not None:
            cap.release()
        log.info("webcam %d kapatıldı (kullanan ajan kalmadı)", self.index)

    def wait_frame(self, last_id: int, timeout: float) -> Tuple[Optional[np.ndarray], int]:
        """last_id'den yeni bir kare gelene kadar bekler; zaman aşımında (None, last_id)."""
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._frame_id == last_id and not self._stop.is_set():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None, last_id
                self._cond.wait(remaining)
            if self._frame_id == last_id:
                return None, last_id
            return self._frame, self._frame_id


class SharedWebcamReader:
    """SharedWebcam için cv2.VideoCapture benzeri arayüz (ajan kodu değişmeden kullanır)."""

    def __init__(self, index: int, first_frame_timeout: float = 12.0):
        self.cam = SharedWebcam.acquire(index)
        self._last_id = 0
        self._first_timeout = first_frame_timeout
        self._released = False

    def isOpened(self) -> bool:  # noqa: N802 - cv2 uyumlu ad
        return not self._released

    def read(self):
        # İlk karede kameranın açılmasını bekle (farklı yöntemler denenirken birkaç sn sürebilir)
        timeout = self._first_timeout if self._last_id == 0 else 3.0
        frame, fid = self.cam.wait_frame(self._last_id, timeout)
        if frame is None:
            return False, None
        self._last_id = fid
        return True, frame

    @property
    def error(self) -> Optional[str]:
        return self.cam.error

    def set(self, *_args) -> bool:
        return True

    def get(self, _prop) -> float:
        return 0.0

    def release(self) -> None:
        if not self._released:
            self._released = True
            self.cam.release()


class StillImageCapture:
    """Tek bir resmi sürekli aynı kare olarak döndüren kaynak (ör. otopark fotoğrafı ile doluluk testi)."""

    def __init__(self, path: str, fps: float = 2.0):
        self.path = path
        self.image = cv2.imread(path)
        self.fps = fps

    def isOpened(self) -> bool:  # noqa: N802
        return self.image is not None

    def read(self):
        if self.image is None:
            return False, None
        return True, self.image.copy()

    def set(self, *_args) -> bool:
        return True

    def get(self, prop) -> float:
        return float(self.fps) if prop == cv2.CAP_PROP_FPS else 0.0

    def release(self) -> None:
        self.image = None
