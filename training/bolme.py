"""YOLO veri setini %70 eğitim / %20 doğrulama / %10 test olarak böler.

Kaynak şu biçimlerden biri olabilir:
  a) Roboflow çıktısı:  kaynak/train|valid|test/images + labels   (hepsi birleştirilip yeniden bölünür)
  b) Düz klasör:        kaynak/images + kaynak/labels              (ör. kendi pilot çekimleriniz)
  c) Karışık:           kaynak/*.jpg + aynı adlı *.txt etiketleri

Örnek:
  python bolme.py --kaynak data/plaka_tespit --hedef data/plaka_tespit_bolunmus
  python bolme.py --kaynak pilot_cekim --hedef data/pilot --oranlar 0.7 0.2 0.1 --siniflar plaka
Etiketi olmayan resimler "arka plan" (negatif örnek) olarak boş etiketle eklenir (--etiketsiz-atla ile atlanır).
"""
from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from ortak import IMAGE_EXT, load_yaml, names_list, save_yaml


def label_for(img: Path) -> Optional[Path]:
    """Resmin YOLO etiket dosyasını bulur (.../images/x.jpg -> .../labels/x.txt ya da yanındaki x.txt)."""
    parts = list(img.parts)
    if "images" in parts:
        i = len(parts) - 1 - parts[::-1].index("images")
        cand = Path(*parts[:i], "labels", *parts[i + 1:]).with_suffix(".txt")
        if cand.exists():
            return cand
    cand = img.with_suffix(".txt")
    return cand if cand.exists() else None


def collect(src: Path) -> List[Tuple[Path, Optional[Path]]]:
    imgs = sorted(p for p in src.rglob("*") if p.suffix.lower() in IMAGE_EXT)
    return [(p, label_for(p)) for p in imgs]


def split_items(items: Sequence, ratios: Sequence[float], seed: int = 42):
    """Öğeleri oranlara göre karıştırıp böler (tekrarlanabilir)."""
    if abs(sum(ratios) - 1.0) > 1e-6:
        raise ValueError("Oranların toplamı 1 olmalı")
    items = list(items)
    random.Random(seed).shuffle(items)
    n = len(items)
    n_train = int(round(n * ratios[0]))
    n_val = int(round(n * ratios[1]))
    if n >= 3:  # her kümede en az bir örnek olsun
        n_train = max(1, min(n_train, n - 2))
        n_val = max(1, min(n_val, n - n_train - 1))
    return items[:n_train], items[n_train:n_train + n_val], items[n_train + n_val:]


def main():
    ap = argparse.ArgumentParser(description="YOLO veri setini %70/20/10 böl")
    ap.add_argument("--kaynak", required=True)
    ap.add_argument("--hedef", required=True)
    ap.add_argument("--oranlar", nargs=3, type=float, default=[0.7, 0.2, 0.1], metavar=("EGITIM", "DOGRULAMA", "TEST"))
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--siniflar", nargs="*", help="Sınıf adları (kaynakta data.yaml yoksa), ör. plaka")
    ap.add_argument("--tasi", action="store_true", help="Kopyalamak yerine taşı")
    ap.add_argument("--etiketsiz-atla", action="store_true", help="Etiketi olmayan resimleri dahil etme")
    args = ap.parse_args()

    src, dst = Path(args.kaynak), Path(args.hedef)
    if dst.resolve() == src.resolve():
        raise SystemExit("Hedef kaynakla aynı olamaz")
    items = collect(src)
    if args.etiketsiz_atla:
        items = [it for it in items if it[1] is not None]
    if not items:
        raise SystemExit(f"Resim bulunamadı: {src}")
    names = args.siniflar or (names_list(load_yaml(src / "data.yaml").get("names")) if (src / "data.yaml").exists() else [])
    if not names:
        raise SystemExit("Sınıf adları yok: kaynakta data.yaml bulunmuyor; --siniflar ile verin")

    parts = dict(zip(("train", "valid", "test"), split_items(items, args.oranlar, args.seed)))
    op = shutil.move if args.tasi else shutil.copy2
    used = set()
    for split, group in parts.items():
        (dst / split / "images").mkdir(parents=True, exist_ok=True)
        (dst / split / "labels").mkdir(parents=True, exist_ok=True)
        for img, lbl in group:
            stem = img.stem
            k = 1
            while stem in used:  # farklı klasörlerdeki aynı adlı dosyalar çakışmasın
                stem = f"{img.stem}_{k}"
                k += 1
            used.add(stem)
            op(str(img), str(dst / split / "images" / (stem + img.suffix.lower())))
            out_lbl = dst / split / "labels" / (stem + ".txt")
            if lbl is not None:
                op(str(lbl), str(out_lbl))
            else:
                out_lbl.write_text("", encoding="utf-8")
        print(f"{split:<5}: {len(group)} resim")
    save_yaml(dst / "data.yaml", {"path": str(dst.resolve()), "train": "train/images", "val": "valid/images",
                                  "test": "test/images", "nc": len(names), "names": names})
    print(f"OK data.yaml yazıldı: {dst / 'data.yaml'}")


if __name__ == "__main__":
    main()
