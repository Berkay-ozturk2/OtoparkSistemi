"""Plaka tespit modeli eğitimi (YOLOv8n, tek sınıf).

Örnek:
  python egit_plaka_tespit.py --data data/plaka_tespit/data.yaml
  python egit_plaka_tespit.py --data data/plaka_tespit/data.yaml --epochs 50 --batch 8 --device cpu
  python egit_plaka_tespit.py --data data/pilot/data.yaml --model ../vision-service/models/plate_detector_tr.pt --epochs 30
      (hazır Türk plaka modelini kendi pilot çekimlerinizle ince ayar)

Çıktı: runs/detect/<name>/weights/best.pt  -> --kopyala ile vision-service/models/plate_detector_tr.pt
(var olan model korunur, _yeni ekiyle kopyalanır; üzerine yazmak için --uzerine-yaz).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ortak import TRAINING_DIR, copy_to_vision


def main():
    ap = argparse.ArgumentParser(description="YOLOv8 plaka tespit eğitimi")
    ap.add_argument("--data", required=True, help="data.yaml yolu")
    ap.add_argument("--model", default="yolov8n.pt", help="Başlangıç ağırlıkları (vars. yolov8n.pt, COCO)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--patience", type=int, default=30, help="Erken durdurma sabrı")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16, help="-1: GPU belleğine göre otomatik")
    ap.add_argument("--device", default=None, help='"0" (GPU), "cpu"; boş: otomatik')
    ap.add_argument("--workers", type=int, default=4, help="Windows'ta sorun olursa 0 yapın")
    ap.add_argument("--name", default="plate-detector-tr")
    ap.add_argument("--project", default=str(TRAINING_DIR / "runs" / "detect"))
    ap.add_argument("--resume", action="store_true", help="Yarım kalan eğitimi sürdür (last.pt)")
    ap.add_argument("--kopyala", action="store_true", help="best.pt'yi vision-service/models'e kopyala")
    ap.add_argument("--uzerine-yaz", action="store_true", help="Var olan plate_detector_tr.pt üzerine yaz")
    args = ap.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics kurulu değil: pip install ultralytics")

    if args.resume:
        last = Path(args.project) / args.name / "weights" / "last.pt"
        model = YOLO(str(last))
        model.train(resume=True)
    else:
        model = YOLO(args.model)
        model.train(
            data=args.data, epochs=args.epochs, patience=args.patience, imgsz=args.imgsz, batch=args.batch,
            device=args.device, workers=args.workers, name=args.name, project=args.project, exist_ok=True,
            single_cls=True, plots=True,
        )
    best = Path(model.trainer.save_dir) / "weights" / "best.pt"
    print(f"\nEn iyi ağırlıklar: {best}")

    # Test kümesi varsa (yoksa doğrulama kümesi) üzerinde ölç
    metrics = YOLO(str(best)).val(data=args.data, split="test", imgsz=args.imgsz, device=args.device, plots=False) \
        if _has_test(args.data) else YOLO(str(best)).val(data=args.data, imgsz=args.imgsz, device=args.device, plots=False)
    b = metrics.box
    print(f"Precision={b.mp:.3f}  Recall={b.mr:.3f}  mAP50={b.map50:.3f}  mAP50-95={b.map:.3f}")

    if args.kopyala:
        dst = copy_to_vision(best, "plate_detector_tr.pt", args.uzerine_yaz)
        print(f"Kopyalandı: {dst}")
        if dst.name != "plate_detector_tr.pt":
            print("Servisin bu modeli kullanması için .env içinde PLATE_MODEL=" + dst.name + " yazın.")


def _has_test(data_yaml: str) -> bool:
    try:
        from ortak import load_yaml
        return bool(load_yaml(Path(data_yaml)).get("test"))
    except Exception:
        return False


if __name__ == "__main__":
    main()
