"""Plaka karakter okuyucu eğitimi (YOLOv8n, 36 sınıf 0-9A-Z, imgsz=320).

Her karakter ayrı bir nesne olarak etiketlenmiştir (Roboflow "metehan-yasar/plaka-cript").
Görüntü servisi (app/pipeline/ocr.py) bu modeli EasyOCR yerine kullanır: karakterleri satırlara
gruplar, x'e göre sıralar ve TR plaka biçimine göre düzeltir.

Örnek:
  python egit_karakter_okuyucu.py --data data/karakter/data.yaml --kopyala
  python egit_karakter_okuyucu.py --data data/karakter/data.yaml --epochs 60 --batch 32 --device 0 --kopyala

Çıktılar:
  runs/detect/char-reader/weights/best.pt  -> vision-service/models/char_reader.pt   (--kopyala)
  char_classes.txt (data.yaml sınıf sırası)  -> vision-service/models/char_classes.txt
ÖNEMLİ: Karakterlerde yatay çevirme (fliplr) anlamı bozar; bu yüzden fliplr=0 ile eğitilir.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ortak import TRAINING_DIR, VISION_MODELS, copy_to_vision, load_yaml, names_list

EXPECTED = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def write_classes(data_yaml: Path, out: Path) -> list:
    names = [n.strip().upper() for n in names_list(load_yaml(data_yaml).get("names"))]
    if not names:
        sys.exit(f"data.yaml içinde 'names' yok: {data_yaml}")
    bad = [n for n in names if len(n) != 1]
    if bad:
        print(f"UYARI: tek karakter olmayan sınıf adları var: {bad} — OCR bu sınıfları olduğu gibi yazar.")
    if sorted(names) != sorted(EXPECTED):
        missing = sorted(set(EXPECTED) - set(names))
        extra = sorted(set(names) - set(EXPECTED))
        print(f"Bilgi: sınıf kümesi standart 36 karakterden farklı (eksik: {missing or '-'}, fazla: {extra or '-'}).")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("# Karakter okuyucu sınıf sırası (satır no = sınıf indeksi). egit_karakter_okuyucu.py üretti.\n"
                   + "\n".join(names) + "\n", encoding="utf-8")
    print(f"Sınıf sırası ({len(names)}): {''.join(names)} -> {out}")
    return names


def main():
    ap = argparse.ArgumentParser(description="YOLOv8 plaka karakter okuyucu eğitimi")
    ap.add_argument("--data", required=True, help="data.yaml yolu")
    ap.add_argument("--model", default="yolov8n.pt")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--patience", type=int, default=30)
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--device", default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--name", default="char-reader")
    ap.add_argument("--project", default=str(TRAINING_DIR / "runs" / "detect"))
    ap.add_argument("--kopyala", action="store_true", help="best.pt ve char_classes.txt'yi vision-service/models'e kopyala")
    ap.add_argument("--uzerine-yaz", action="store_true")
    ap.add_argument("--sadece-siniflar", action="store_true", help="Eğitmeden yalnızca char_classes.txt üret")
    args = ap.parse_args()

    data_yaml = Path(args.data)
    classes_out = TRAINING_DIR / "char_classes.txt"
    write_classes(data_yaml, classes_out)
    if args.sadece_siniflar:
        if args.kopyala:
            (VISION_MODELS / "char_classes.txt").write_text(classes_out.read_text(encoding="utf-8"), encoding="utf-8")
        return

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics kurulu değil: pip install ultralytics")

    model = YOLO(args.model)
    model.train(
        data=str(data_yaml), epochs=args.epochs, patience=args.patience, imgsz=args.imgsz, batch=args.batch,
        device=args.device, workers=args.workers, name=args.name, project=args.project, exist_ok=True,
        fliplr=0.0,        # karakterleri aynalamak (ör. "E" -> "Ǝ") etiketi bozar
        degrees=5.0,       # hafif eğim
        mosaic=0.5,
        plots=True,
    )
    best = Path(model.trainer.save_dir) / "weights" / "best.pt"
    metrics = YOLO(str(best)).val(data=str(data_yaml), imgsz=args.imgsz, device=args.device, plots=False)
    print(f"\nEn iyi ağırlıklar: {best}")
    print(f"Karakter mAP50={metrics.box.map50:.3f}  mAP50-95={metrics.box.map:.3f}")
    print("Plaka bazında doğruluk için: python degerlendir.py --karakter-test", data_yaml.parent)

    if args.kopyala:
        dst = copy_to_vision(best, "char_reader.pt", args.uzerine_yaz)
        cls_dst = dst.with_name("char_classes.txt")
        cls_dst.write_text(classes_out.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Kopyalandı: {dst}\n            {cls_dst}")
        if dst.name != "char_reader.pt":
            print("Servisin bu modeli kullanması için .env içinde CHAR_MODEL=" + dst.name + " yazın.")
        print("Servisi yeniden başlatın; /health -> ocr: \"yolo-char\" görünmeli.")


if __name__ == "__main__":
    main()
