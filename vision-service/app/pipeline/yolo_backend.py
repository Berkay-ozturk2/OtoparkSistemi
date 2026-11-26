"""YOLO modellerini tek arayüzle çalıştıran sarmalayıcı.

Öncelik:
  1) ultralytics + .pt dosyası (GPU/CPU, en kolay yol)
  2) onnxruntime + .onnx dosyası (ultralytics/torch kurulu değilse CPU'da hızlı)

Tüm ağır kütüphaneler TEMBEL (lazy) ve try/except içinde yüklenir; böylece
model ya da kütüphane yokken de servis açılabilir.

predict() çıktısı: N×6 numpy dizisi [x1, y1, x2, y2, güven, sınıf] (orijinal görüntü pikselleri).
"""
from __future__ import annotations

import ast
import logging
import shutil
import threading
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple

import cv2
import numpy as np

log = logging.getLogger(__name__)


# ----------------------------------------------------------------------
# Saf yardımcılar (testlerde kullanılır)
# ----------------------------------------------------------------------
def letterbox(img: np.ndarray, size: int | Tuple[int, int] = 640, color=(114, 114, 114)):
    """Oranı koruyarak yeniden boyutlandırıp kenarları doldurur.
    Dönüş: (yeni görüntü, ölçek, (sol_pay, üst_pay))."""
    if isinstance(size, int):
        size = (size, size)
    th, tw = size
    h, w = img.shape[:2]
    r = min(th / h, tw / w)
    nw, nh = int(round(w * r)), int(round(h * r))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR) if (nw, nh) != (w, h) else img
    pad_w, pad_h = tw - nw, th - nh
    left, top = pad_w // 2, pad_h // 2
    out = cv2.copyMakeBorder(resized, top, pad_h - top, left, pad_w - left, cv2.BORDER_CONSTANT, value=color)
    return out, r, (left, top)


def nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45) -> np.ndarray:
    """Basit numpy NMS; tutulan indeksleri döndürür (skora göre azalan)."""
    if len(boxes) == 0:
        return np.zeros((0,), dtype=int)
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        union = areas[i] + areas[order[1:]] - inter
        ious = np.where(union > 0, inter / np.maximum(union, 1e-9), 0)
        order = order[1:][ious <= iou_threshold]
    return np.array(keep, dtype=int)


def decode_yolov8_output(
    output: np.ndarray,
    conf_threshold: float,
    iou_threshold: float,
    scale: float,
    pad: Tuple[int, int],
    orig_shape: Tuple[int, int],
    classes: Optional[Sequence[int]] = None,
    agnostic: bool = False,
    max_det: int = 300,
) -> np.ndarray:
    """YOLOv8 ONNX çıktısını ([1, 4+nc, N]) N×6 tespite çevirir."""
    pred = np.asarray(output)
    if pred.ndim == 3:
        pred = pred[0]
    pred = pred.T  # ultralytics ONNX çıktısı her zaman [4+nc, N] -> [N, 4+nc]
    boxes_cxcywh = pred[:, :4]
    cls_scores = pred[:, 4:]
    if cls_scores.shape[1] == 0:
        return np.zeros((0, 6), dtype=np.float32)
    cls_ids = cls_scores.argmax(axis=1)
    scores = cls_scores[np.arange(len(cls_ids)), cls_ids]
    mask = scores >= conf_threshold
    if classes is not None:
        mask &= np.isin(cls_ids, np.asarray(list(classes)))
    if not mask.any():
        return np.zeros((0, 6), dtype=np.float32)
    b = boxes_cxcywh[mask]
    s = scores[mask]
    c = cls_ids[mask]
    xyxy = np.empty_like(b)
    xyxy[:, 0] = b[:, 0] - b[:, 2] / 2
    xyxy[:, 1] = b[:, 1] - b[:, 3] / 2
    xyxy[:, 2] = b[:, 0] + b[:, 2] / 2
    xyxy[:, 3] = b[:, 1] + b[:, 3] / 2
    # Sınıf bazlı NMS: sınıfları kaydırarak tek seferde
    offset = 0 if agnostic else c[:, None].astype(np.float32) * 10000.0
    keep = nms(xyxy + offset, s, iou_threshold)[:max_det]
    xyxy, s, c = xyxy[keep], s[keep], c[keep]
    # Letterbox'ı geri al
    xyxy[:, [0, 2]] -= pad[0]
    xyxy[:, [1, 3]] -= pad[1]
    xyxy /= scale
    h, w = orig_shape
    xyxy[:, [0, 2]] = xyxy[:, [0, 2]].clip(0, w)
    xyxy[:, [1, 3]] = xyxy[:, [1, 3]].clip(0, h)
    return np.concatenate([xyxy, s[:, None], c[:, None].astype(np.float32)], axis=1).astype(np.float32)


# ----------------------------------------------------------------------
class YoloModel:
    """ultralytics veya onnxruntime ile çalışan YOLOv8 tespit modeli."""

    def __init__(self, name: str):
        self.name = name
        self.backend: Optional[str] = None  # "ultralytics" | "onnx"
        self.path: Optional[Path] = None
        self.names: Dict[int, str] = {}
        self.error: Optional[str] = None
        self.device: Optional[str] = None
        self._model = None
        self._session = None
        self._input_name = None
        self._input_size: Optional[Tuple[int, int]] = None
        self._lock = threading.Lock()  # modeller iş parçacığı güvenli değildir

    @property
    def ready(self) -> bool:
        return self.backend is not None

    # ------------------------------------------------------------------
    def load(
        self,
        pt_path: Optional[Path] = None,
        onnx_path: Optional[Path] = None,
        prefer_onnx: bool = False,
        allow_download_name: Optional[str] = None,
        device: Optional[str] = None,
    ) -> bool:
        """Modeli yükler. allow_download_name verilirse (ör. "yolov8n.pt") ve .pt yoksa
        ultralytics modeli ilk çalıştırmada internetten indirir."""
        self.device = device or None
        attempts = []
        if prefer_onnx:
            attempts = [("onnx", onnx_path), ("ultralytics", pt_path)]
        else:
            attempts = [("ultralytics", pt_path), ("onnx", onnx_path)]
        errors = []
        for backend, path in attempts:
            if backend == "ultralytics":
                target = None
                if path is not None and Path(path).exists():
                    target = str(path)
                elif allow_download_name:
                    target = allow_download_name
                if target is None:
                    continue
                ok, err = self._load_ultralytics(target)
                if ok and target == allow_download_name and path is not None:
                    self._keep_downloaded(Path(allow_download_name), Path(path))
            else:
                if path is None or not Path(path).exists():
                    continue
                ok, err = self._load_onnx(Path(path))
            if ok:
                self.error = None
                log.info("[%s] model yüklendi (%s): %s", self.name, self.backend, self.path)
                return True
            errors.append(f"{backend}: {err}")
        if not errors:
            errors.append(f"model dosyası bulunamadı ({pt_path} / {onnx_path})")
        self.error = "; ".join(errors)
        log.warning("[%s] model yüklenemedi: %s", self.name, self.error)
        return False

    def _load_ultralytics(self, target: str):
        try:
            from ultralytics import YOLO  # tembel import
        except Exception as exc:  # ImportError ya da torch DLL hataları
            return False, f"ultralytics içe aktarılamadı ({exc.__class__.__name__}: {exc})"
        try:
            model = YOLO(target)
            self._model = model
            self.names = {int(k): str(v) for k, v in dict(model.names).items()}
            self.backend = "ultralytics"
            self.path = Path(target)
            return True, None
        except Exception as exc:
            return False, f"{exc.__class__.__name__}: {exc}"

    @staticmethod
    def _keep_downloaded(downloaded: Path, dest: Path) -> None:
        """ultralytics modeli çalışma klasörüne indirir; bir sonraki açılış için models/ altına kopyalar."""
        try:
            if downloaded.exists() and not dest.exists() and downloaded.resolve() != dest.resolve():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(downloaded, dest)
                log.info("İndirilen model kopyalandı: %s", dest)
        except Exception as exc:
            log.debug("İndirilen model kopyalanamadı: %s", exc)

    def _load_onnx(self, path: Path):
        try:
            import onnxruntime as ort  # tembel import
        except Exception as exc:
            return False, f"onnxruntime içe aktarılamadı ({exc})"
        try:
            providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
            sess = ort.InferenceSession(str(path), providers=providers or None)
            inp = sess.get_inputs()[0]
            shape = inp.shape  # [1, 3, H, W]
            h = shape[2] if isinstance(shape[2], int) else 640
            w = shape[3] if isinstance(shape[3], int) else 640
            meta = sess.get_modelmeta().custom_metadata_map or {}
            names = {}
            if "names" in meta:
                try:
                    names = {int(k): str(v) for k, v in ast.literal_eval(meta["names"]).items()}
                except Exception:
                    names = {}
            self._session = sess
            self._input_name = inp.name
            self._input_size = (h, w)
            self.names = names
            self.backend = "onnx"
            self.path = path
            return True, None
        except Exception as exc:
            return False, f"{exc.__class__.__name__}: {exc}"

    # ------------------------------------------------------------------
    def predict(
        self,
        image: np.ndarray,
        conf: float = 0.25,
        iou: float = 0.45,
        imgsz: Optional[int] = None,
        classes: Optional[Sequence[int]] = None,
        agnostic: bool = False,
    ) -> np.ndarray:
        if not self.ready:
            raise RuntimeError(f"{self.name} modeli yüklü değil")
        if image is None or image.size == 0:
            return np.zeros((0, 6), dtype=np.float32)
        if image.ndim == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        with self._lock:
            if self.backend == "ultralytics":
                kwargs = dict(conf=conf, iou=iou, verbose=False, agnostic_nms=agnostic)
                if imgsz:
                    kwargs["imgsz"] = imgsz
                if classes is not None:
                    kwargs["classes"] = list(classes)
                if self.device:
                    kwargs["device"] = self.device
                res = self._model.predict(image, **kwargs)
                if not res or res[0].boxes is None or len(res[0].boxes) == 0:
                    return np.zeros((0, 6), dtype=np.float32)
                return res[0].boxes.data.cpu().numpy().astype(np.float32)
            # onnx
            size = self._input_size or (imgsz or 640, imgsz or 640)
            lb, scale, pad = letterbox(image, size)
            blob = cv2.cvtColor(lb, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)[None].astype(np.float32) / 255.0
            out = self._session.run(None, {self._input_name: np.ascontiguousarray(blob)})[0]
            return decode_yolov8_output(out, conf, iou, scale, pad, image.shape[:2], classes, agnostic)
