"""Eğitim scriptlerinin ortak yardımcıları (yalnızca standart kütüphane + pyyaml)."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Dict, List, Optional

TRAINING_DIR = Path(__file__).resolve().parent
PROJECT_DIR = TRAINING_DIR.parent
VISION_DIR = PROJECT_DIR / "vision-service"
VISION_MODELS = VISION_DIR / "models"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# Roboflow / YOLO klasör adları (valid ve val ikisi de görülür)
SPLIT_ALIASES = {"train": ["train"], "valid": ["valid", "val"], "test": ["test"]}


def load_yaml(path: Path) -> dict:
    import yaml
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_yaml(path: Path, data: dict) -> None:
    import yaml
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)


def names_list(names) -> List[str]:
    """data.yaml 'names' alanı liste ya da {indeks: ad} sözlüğü olabilir -> sıralı liste."""
    if isinstance(names, dict):
        return [str(names[k]) for k in sorted(names, key=lambda x: int(x))]
    return [str(n) for n in (names or [])]


def find_split_dir(root: Path, split: str) -> Optional[Path]:
    for alias in SPLIT_ALIASES[split]:
        d = root / alias / "images"
        if d.is_dir():
            return d
    return None


def fix_data_yaml(root: Path, names: Optional[List[str]] = None) -> Path:
    """Roboflow'un göreli yollarını (../train/images) düzeltip mutlak 'path' içeren data.yaml yazar."""
    root = root.resolve()
    yml = root / "data.yaml"
    data = load_yaml(yml) if yml.exists() else {}
    names = names or names_list(data.get("names"))
    if not names:
        raise SystemExit(f"Sınıf adları bulunamadı: {yml}")
    out: Dict[str, object] = {"path": str(root)}
    for split, key in (("train", "train"), ("valid", "val"), ("test", "test")):
        d = find_split_dir(root, split)
        if d is not None:
            out[key] = str(d.relative_to(root)).replace("\\", "/")
    if "train" not in out or "val" not in out:
        raise SystemExit(f"{root} içinde train/images ve valid/images klasörleri bulunamadı. "
                         "Gerekirse önce bolme.py ile %70/20/10 bölün.")
    out["nc"] = len(names)
    out["names"] = names
    save_yaml(yml, out)
    return yml


def copy_to_vision(src: Path, dst_name: str, overwrite: bool) -> Path:
    """Eğitilen modeli vision-service/models altına kopyalar (var olanı korumak için _yeni eki)."""
    VISION_MODELS.mkdir(parents=True, exist_ok=True)
    dst = VISION_MODELS / dst_name
    if dst.exists() and not overwrite:
        dst = dst.with_name(dst.stem + "_yeni" + dst.suffix)
    shutil.copy2(src, dst)
    return dst


def list_images(folder: Path) -> List[Path]:
    return sorted(p for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXT)
