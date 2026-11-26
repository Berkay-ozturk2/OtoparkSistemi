"""Servis ayarları.

Değerler şu sırayla okunur (sonraki öncekini ezer):
  1) aşağıdaki varsayılanlar
  2) vision-service/.env dosyası (ANAHTAR=DEĞER satırları)
  3) ortam değişkenleri

Ek bağımlılık gerektirmemesi için standart kütüphane ile yazılmıştır.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parents[1]  # vision-service/


def _read_env_file(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        elif " #" in val:
            val = val.split(" #", 1)[0].rstrip()
        values[key] = val
    return values


def _to_bool(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on", "evet", "e")


@dataclass
class Settings:
    # Backend bağlantısı
    BACKEND_URL: str = "http://localhost:5080"
    VISION_API_KEY: str = "dev-vision-key"
    BACKEND_TIMEOUT: float = 5.0
    BACKEND_RETRIES: int = 3

    # Modeller
    MODELS_DIR: str = "models"
    PLATE_MODEL: str = "plate_detector_tr.pt"
    VEHICLE_MODEL: str = "yolov8n.pt"
    CHAR_MODEL: str = "char_reader.pt"
    CHAR_CLASSES: str = "char_classes.txt"
    PREFER_ONNX: bool = False           # true: .onnx dosyası varsa onu kullan (CPU'da hızlı)
    DEVICE: str = ""                    # "" otomatik, "cpu", "0" (ilk GPU)
    LOAD_VEHICLE_DETECTOR: bool = True
    ALLOW_MODEL_DOWNLOAD: bool = True   # yolov8n.pt yoksa ultralytics indirsin

    # OCR
    OCR_ENGINE: str = "auto"            # auto | yolo-char | easyocr | none
    OCR_GPU: bool = False
    OCR_VARIANTS: str = "gray,clahe,adaptive,otsu"
    LIVE_OCR_VARIANTS: int = 1          # canlı kamerada kare başına denenecek ön işleme sayısı (hız için 1)
    MIN_OCR_PLATE_WIDTH: int = 50       # bundan dar (uzaktaki) plakalarda OCR atlanır, araç yaklaşınca okunur

    # Eşikler
    CONFIDENCE: float = 0.40            # plaka tespit güven eşiği
    VEHICLE_CONFIDENCE: float = 0.35
    VEHICLE_CLASSES: str = "2,3,5,7"    # COCO: car, motorcycle, bus, truck (özel modelde ör. "0")
    OCCUPANCY_THRESHOLD: float = 0.35   # cep alanının en az bu oranı araçla kaplıysa dolu
    OCCUPANCY_FOOTPRINT: float = 1.0    # araç kutusunun alttan ne kadarı dikkate alınsın (eğik kamera için 0.5)
    OCCUPANCY_SMOOTHING: int = 5        # son N karede çoğunluk
    OCCUPANCY_FULL_REPORT_SECONDS: float = 60.0

    # Giriş/çıkış ajanı oylama
    VOTE_WINDOW_SECONDS: float = 1.5
    VOTE_MIN_READS: int = 3
    PLATE_COOLDOWN_SECONDS: float = 30.0
    INVALID_COOLDOWN_SECONDS: float = 15.0
    SEND_PLATE_CROP: bool = True        # KVKK: yalnızca plaka kırpıntısı gönderilir

    # Dosyalar
    CAMERAS_FILE: str = "config/cameras.yaml"
    SLOTS_FILE: str = "config/slots.json"

    # Diğer
    HEARTBEAT_INTERVAL: float = 10.0
    AUTOSTART_AGENTS: bool = True       # cameras.yaml'da enabled: true olanları açılışta başlat
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    LOG_LEVEL: str = "INFO"
    MAX_UPLOAD_MB: float = 15.0

    # ------------------------------------------------------------------
    @classmethod
    def load(cls, env_file: Optional[Path] = None, environ: Optional[Dict[str, str]] = None) -> "Settings":
        env_file = env_file or (BASE_DIR / ".env")
        merged = _read_env_file(env_file)
        environ = dict(os.environ) if environ is None else environ
        s = cls()
        for f in fields(cls):
            raw = environ.get(f.name, merged.get(f.name))
            if raw is None:
                continue
            default = getattr(s, f.name)
            try:
                if isinstance(default, bool):
                    val = _to_bool(raw)
                elif isinstance(default, int):
                    val = int(float(raw))
                elif isinstance(default, float):
                    val = float(raw)
                else:
                    val = str(raw)
            except ValueError:
                continue  # hatalı değer: varsayılan kalsın
            setattr(s, f.name, val)
        s.BACKEND_URL = s.BACKEND_URL.rstrip("/")
        return s

    # ------------------------------------------------------------------
    def path(self, value: str) -> Path:
        p = Path(value)
        return p if p.is_absolute() else (BASE_DIR / p)

    @property
    def models_dir(self) -> Path:
        return self.path(self.MODELS_DIR)

    def model_path(self, name: str) -> Path:
        p = Path(name)
        return p if p.is_absolute() else self.models_dir / p

    @property
    def cameras_file(self) -> Path:
        return self.path(self.CAMERAS_FILE)

    @property
    def slots_file(self) -> Path:
        return self.path(self.SLOTS_FILE)

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def ocr_variants(self) -> List[str]:
        return [v.strip() for v in self.OCR_VARIANTS.split(",") if v.strip()]

    @property
    def vehicle_class_ids(self) -> List[int]:
        out = []
        for v in self.VEHICLE_CLASSES.split(","):
            v = v.strip()
            if v.isdigit():
                out.append(int(v))
        return out or [2, 3, 5, 7]

    @property
    def device(self) -> Optional[str]:
        return self.DEVICE.strip() or None


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings.load()
    return _settings
