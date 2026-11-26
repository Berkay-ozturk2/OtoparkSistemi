"""Plaka okuma (OCR) stratejisi.

Sıra (OCR_ENGINE=auto):
  1) models/char_reader.pt (veya .onnx) varsa YOLO karakter okuyucu ("yolo-char"):
     her karakter ayrı bir nesne olarak tespit edilir, satırlara gruplanıp x'e göre sıralanır.
     Sınıf sırası models/char_classes.txt'den (yoksa modelin names alanından, o da yoksa
     "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") okunur.
  2) EasyOCR (['en'], allowlist A-Z0-9) ("easyocr")
  3) Hiçbiri yoksa "none" — tespit çalışır, metin boş döner.

Ön işleme: gri, yeniden boyutlandırma, CLAHE, adaptif eşik, Otsu. Her varyant okunur,
TR biçimine göre düzeltilir (tr_plate.correct) ve en yüksek skorlu geçerli sonuç seçilir.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from app.pipeline import tr_plate
from app.pipeline.yolo_backend import YoloModel, nms

log = logging.getLogger(__name__)

DEFAULT_CHAR_CLASSES = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
ALLOWLIST = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


@dataclass
class OcrResult:
    text: str            # düzeltilmiş plaka (geçerliyse) ya da normalize edilmiş ham metin
    raw: str             # OCR'ın ürettiği ham metin
    confidence: float    # 0..1
    valid: bool
    engine: str
    variant: str = ""
    changes: float = 0.0

    @staticmethod
    def empty(engine: str = "none") -> "OcrResult":
        return OcrResult("", "", 0.0, False, engine)


# ----------------------------------------------------------------------
# Saf yardımcılar
# ----------------------------------------------------------------------
def load_char_classes(path: Optional[Path], model_names: Optional[Dict[int, str]] = None) -> List[str]:
    """Karakter sınıf sırasını belirler: char_classes.txt > model names > varsayılan."""
    if path is not None and Path(path).exists():
        lines = [ln.strip() for ln in Path(path).read_text(encoding="utf-8").splitlines()]
        classes = [ln for ln in lines if ln and not ln.startswith("#")]
        if classes:
            return [c.upper() for c in classes]
    if model_names:
        names = [str(model_names[k]) for k in sorted(model_names)]
        if all(len(n) == 1 for n in names):
            return [n.upper() for n in names]
    return list(DEFAULT_CHAR_CLASSES)


def group_lines(items: Sequence[Tuple[float, float, float, float]]) -> List[List[int]]:
    """Kutuları (x1,y1,x2,y2) satırlara ayırır; satır listesi (yukarıdan aşağı, her satır
    soldan sağa indeks listesi) döndürür. İki satırlı (kare) plakalar için kullanılır."""
    if not items:
        return []
    arr = np.asarray(items, dtype=np.float64)
    yc = (arr[:, 1] + arr[:, 3]) / 2
    xc = (arr[:, 0] + arr[:, 2]) / 2
    heights = np.maximum(1.0, arr[:, 3] - arr[:, 1])
    hm = float(np.median(heights))
    order = np.argsort(yc)
    lines: List[List[int]] = [[int(order[0])]]
    if len(order) > 1 and (yc.max() - yc.min()) > 0.6 * hm:
        sorted_y = yc[order]
        gaps = np.diff(sorted_y)
        split = int(np.argmax(gaps))
        if gaps[split] > 0.45 * hm:
            lines = [[int(i) for i in order[: split + 1]], [int(i) for i in order[split + 1:]]]
        else:
            lines = [[int(i) for i in order]]
    else:
        lines = [[int(i) for i in order]]
    return [sorted(line, key=lambda i: xc[i]) for line in lines]


def assemble_characters(dets: np.ndarray, classes: Sequence[str], min_conf: float = 0.25,
                        dup_iou: float = 0.6) -> Tuple[str, float]:
    """YOLO karakter tespitlerinden (N×6) metin ve ortalama güven üretir."""
    if dets is None or len(dets) == 0:
        return "", 0.0
    dets = np.asarray(dets, dtype=np.float32)
    dets = dets[dets[:, 4] >= min_conf]
    if len(dets) == 0:
        return "", 0.0
    # Aynı yere farklı sınıfla düşen kopyaları ele (sınıftan bağımsız NMS)
    keep = nms(dets[:, :4], dets[:, 4], dup_iou)
    dets = dets[keep]
    lines = group_lines([tuple(d[:4]) for d in dets])
    chars, confs = [], []
    for line in lines:
        for i in line:
            cls = int(dets[i, 5])
            if 0 <= cls < len(classes):
                chars.append(classes[cls])
                confs.append(float(dets[i, 4]))
    if not chars:
        return "", 0.0
    return "".join(chars), float(np.mean(confs))


def score_candidate(valid: bool, confidence: float, changes: float) -> float:
    """Aday sıralama skoru: geçerli biçim büyük avantaj, her düzeltme küçük ceza."""
    return (1.0 if valid else 0.0) + confidence - 0.05 * changes


def choose_best(candidates: Sequence[Tuple[str, float, str]], engine: str) -> OcrResult:
    """(ham metin, güven, varyant) adaylarından en iyisini seçer."""
    best: Optional[OcrResult] = None
    best_score = -1e9
    for raw, conf, variant in candidates:
        corr = tr_plate.correct(raw)
        if not corr.plate:
            continue
        s = score_candidate(corr.valid, conf, corr.changes)
        if s > best_score:
            best_score = s
            # Her düzeltme güveni biraz düşürür
            adj_conf = max(0.0, min(1.0, conf * (1.0 - 0.05 * corr.changes)))
            best = OcrResult(corr.plate, raw, round(adj_conf, 4), corr.valid, engine, variant, corr.changes)
    return best or OcrResult.empty(engine)


def preprocess_variants(crop: np.ndarray, names: Sequence[str] = ("color", "gray", "clahe", "adaptive", "otsu"),
                        target_height: int = 96) -> List[Tuple[str, np.ndarray]]:
    """Plaka kırpıntısının ön işleme varyantları."""
    if crop is None or crop.size == 0:
        return []
    h, w = crop.shape[:2]
    scale = target_height / float(max(1, h))
    if abs(scale - 1.0) > 0.05:
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        resized = cv2.resize(crop, (max(1, int(w * scale)), target_height), interpolation=interp)
    else:
        resized = crop
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY) if resized.ndim == 3 else resized
    out: List[Tuple[str, np.ndarray]] = []
    cache: Dict[str, np.ndarray] = {}
    for name in names:
        if name == "color":
            img = resized if resized.ndim == 3 else cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
        elif name == "gray":
            img = gray
        elif name == "clahe":
            img = cache.setdefault("clahe", cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 8)).apply(gray))
        elif name == "adaptive":
            base = cache.setdefault("clahe", cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 8)).apply(gray))
            blur = cv2.GaussianBlur(base, (3, 3), 0)
            block = max(11, (target_height // 3) | 1)
            img = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 9)
        elif name == "otsu":
            blur = cv2.GaussianBlur(gray, (3, 3), 0)
            _, img = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        else:
            continue
        out.append((name, img))
    return out


# ----------------------------------------------------------------------
# Motorlar
# ----------------------------------------------------------------------
class BaseOcr:
    name = "none"

    def __init__(self, variants: Sequence[str] = ("color", "gray", "clahe", "adaptive"), early_stop_conf: float = 0.85):
        self.variants = list(variants)
        self.early_stop_conf = early_stop_conf
        self.fast_count = 1  # canlı kamerada (fast=True) denenecek varyant sayısı

    @property
    def ready(self) -> bool:
        return False

    def _read_variant(self, img: np.ndarray) -> List[Tuple[str, float]]:  # pragma: no cover - soyut
        return []

    def read(self, crop: np.ndarray, fast: bool = False) -> OcrResult:
        """Kırpıntıyı okur. fast=True ise yalnızca ilk fast_count varyant denenir (canlı kamera)."""
        if not self.ready or crop is None or crop.size == 0:
            return OcrResult.empty(self.name)
        names = self.variants[:max(1, getattr(self, "fast_count", 1))] if fast else self.variants
        candidates: List[Tuple[str, float, str]] = []
        for vname, img in preprocess_variants(crop, names):
            try:
                for text, conf in self._read_variant(img):
                    candidates.append((text, conf, vname))
            except Exception as exc:
                log.debug("OCR varyantı başarısız (%s): %s", vname, exc)
                continue
            best = choose_best(candidates, self.name)
            if best.valid and best.confidence >= self.early_stop_conf:
                return best  # yeterince iyi; diğer varyantlara gerek yok
        return choose_best(candidates, self.name)


class NullOcr(BaseOcr):
    name = "none"


class YoloCharOcr(BaseOcr):
    """trplate yaklaşımı: her karakter bir YOLO sınıfı (36 sınıf 0-9A-Z)."""

    name = "yolo-char"

    def __init__(self, pt_path: Path, classes_path: Optional[Path] = None, prefer_onnx: bool = False,
                 device: Optional[str] = None, imgsz: int = 320, char_conf: float = 0.25, **kw):
        super().__init__(variants=kw.pop("variants", ("color", "clahe", "gray")), **kw)
        self.model = YoloModel("karakter-okuyucu")
        self.pt_path = pt_path
        self.onnx_path = pt_path.with_suffix(".onnx")
        self.classes_path = classes_path
        self.prefer_onnx = prefer_onnx
        self.device = device
        self.imgsz = imgsz
        self.char_conf = char_conf
        self.classes: List[str] = list(DEFAULT_CHAR_CLASSES)

    @staticmethod
    def available(pt_path: Path) -> bool:
        return pt_path.exists() or pt_path.with_suffix(".onnx").exists()

    def load(self) -> bool:
        ok = self.model.load(self.pt_path, self.onnx_path, prefer_onnx=self.prefer_onnx, device=self.device)
        if ok:
            self.classes = load_char_classes(self.classes_path, self.model.names)
            log.info("Karakter sınıfları (%d): %s", len(self.classes), "".join(self.classes))
        return ok

    @property
    def ready(self) -> bool:
        return self.model.ready

    @property
    def error(self) -> Optional[str]:
        return self.model.error

    def _read_variant(self, img: np.ndarray) -> List[Tuple[str, float]]:
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        dets = self.model.predict(img, conf=self.char_conf, iou=0.5, imgsz=self.imgsz)
        text, conf = assemble_characters(dets, self.classes, self.char_conf)
        return [(text, conf)] if text else []


class EasyOcrEngine(BaseOcr):
    name = "easyocr"

    def __init__(self, gpu: bool = False, model_dir: Optional[Path] = None, **kw):
        super().__init__(**kw)
        self.gpu = gpu
        self.model_dir = model_dir
        self._reader = None
        self.error: Optional[str] = None
        self._lock = threading.Lock()

    def load(self) -> bool:
        try:
            import easyocr  # tembel import (torch gerektirir)
        except Exception as exc:
            self.error = f"easyocr içe aktarılamadı ({exc.__class__.__name__}: {exc})"
            log.warning(self.error)
            return False
        try:
            kwargs = {"gpu": self.gpu, "verbose": False}
            if self.model_dir:
                kwargs["model_storage_directory"] = str(self.model_dir)
            self._reader = easyocr.Reader(["en"], **kwargs)
            log.info("EasyOCR yüklendi (gpu=%s)", self.gpu)
            return True
        except Exception as exc:
            self.error = f"EasyOCR başlatılamadı: {exc}"
            log.warning(self.error)
            return False

    @property
    def ready(self) -> bool:
        return self._reader is not None

    def _read_variant(self, img: np.ndarray) -> List[Tuple[str, float]]:
        with self._lock:
            res = self._reader.readtext(img, allowlist=ALLOWLIST, detail=1, paragraph=False)
        if not res:
            return []
        boxes, texts, confs = [], [], []
        for pts, text, conf in res:
            t = tr_plate.normalize(text) if text else ""
            # "TR" bandını ve tek karakterlik gürültüyü atla
            if not t or t == "TR" or len(t) == 1 and not t.isdigit():
                continue
            p = np.asarray(pts, dtype=np.float64)
            boxes.append((p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()))
            texts.append(t)
            confs.append(float(conf))
        if not texts:
            return []
        out: List[Tuple[str, float]] = []
        lines = group_lines(boxes)
        order = [i for line in lines for i in line]
        joined = "".join(texts[i] for i in order)
        # Uzunluk ağırlıklı ortalama güven
        total_len = sum(len(texts[i]) for i in order)
        joined_conf = sum(confs[i] * len(texts[i]) for i in order) / max(1, total_len)
        out.append((joined, joined_conf))
        if len(texts) > 1:
            for t, c in zip(texts, confs):
                out.append((t, c))
        return out


def build_ocr(engine: str, char_model: Path, char_classes: Path, gpu: bool, device: Optional[str],
              prefer_onnx: bool, variants: Sequence[str]) -> Tuple[BaseOcr, List[str]]:
    """Ayara göre OCR motorunu oluşturup yükler; başarısızsa bir sonrakine geçer.
    Dönüş: (motor, hata mesajları)."""
    engine = (engine or "auto").lower()
    errors: List[str] = []
    order: List[str]
    if engine == "auto":
        order = ["yolo-char", "easyocr"]
    elif engine in ("yolo-char", "easyocr"):
        order = [engine]
    else:
        return NullOcr(), []
    for name in order:
        if name == "yolo-char":
            if not YoloCharOcr.available(char_model):
                log.info("Karakter okuyucu modeli yok (%s); EasyOCR denenecek.", char_model)
                continue
            ocr: BaseOcr = YoloCharOcr(char_model, char_classes, prefer_onnx=prefer_onnx, device=device)
        else:
            ocr = EasyOcrEngine(gpu=gpu, variants=variants)
        if ocr.load():  # type: ignore[attr-defined]
            return ocr, errors
        errors.append(f"{name}: {getattr(ocr, 'error', None)}")
    log.warning("Hiçbir OCR motoru yüklenemedi; ocr='none' (yalnızca plaka tespiti yapılacak).")
    if not errors:
        errors.append("OCR motoru bulunamadı (char_reader.pt yok, easyocr kurulu değil)")
    return NullOcr(), errors


OcrFactory = Callable[[], BaseOcr]
