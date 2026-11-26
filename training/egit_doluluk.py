"""(İsteğe bağlı) Doluluk kamerası için araç tespit modeli ince ayarı.

VARSAYILAN YAKLAŞIM EĞİTİM GEREKTİRMEZ: görüntü servisi COCO ile eğitilmiş yolov8n.pt ile araçları bulur ve
config/slots.json'daki cep poligonlarıyla kesiştirir. Aşağıdaki durumlarda ince ayar düşünülebilir:
  * kamera çok yüksekten/tepeden bakıyor ve COCO modeli araçları kaçırıyor
  * gece/yağmur koşullarında tespit oranı düşük

Önerilen açık veri setleri (Roboflow Universe'te YOLOv8 biçiminde de bulunur):
  * PKLot  (Almeida vd., 2015)  — 12.416 görüntü, ~695 bin cep etiketi; sınıflar: space-empty / space-occupied
  * CNRPark+EXT (Amato vd., 2017) — 164 cep, farklı hava/ışık koşulları, cep kırpıntıları (sınıflandırma)
  Lisans ve atıf koşullarını rapora ekleyin.

İki seçenek:
  A) "Araç" tek sınıflı dedektör (önerilen): PKLot'ta yalnızca space-occupied kutularını "car" (0) olarak kullanın
     ya da kendi pilot çekimlerinizi etiketleyin. Eğitimden sonra vision-service/.env:
        VEHICLE_MODEL=vehicle_tr.pt
        VEHICLE_CLASSES=0
  B) Doğrudan "dolu/boş cep" dedektörü: poligon kesişimine gerek kalmaz ama servis bu kipte çalışacak
     şekilde yazılmadı (sınıf 1 = dolu kutularını araç gibi kullanmak için VEHICLE_CLASSES=1 verilebilir).

Örnek:
  python egit_doluluk.py --data data/pklot/data.yaml --sadece-sinif space-occupied --epochs 50
  python egit_doluluk.py --data data/pilot_arac/data.yaml --model ../vision-service/models/yolov8n.pt --kopyala
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from ortak import TRAINING_DIR, copy_to_vision, find_split_dir, load_yaml, names_list, save_yaml


def make_single_class(data_yaml: Path, keep: str, out_dir: Path) -> Path:
    """Çok sınıflı veri setinden yalnızca 'keep' sınıfını 0 numaralı 'car' sınıfı olarak tutan kopya üretir."""
    data = load_yaml(data_yaml)
    names = names_list(data.get("names"))
    if keep not in names:
        sys.exit(f"'{keep}' sınıfı bulunamadı. Mevcut sınıflar: {names}")
    keep_id = names.index(keep)
    root = Path(data.get("path") or data_yaml.parent)
    for split in ("train", "valid", "test"):
        src = find_split_dir(root, split)
        if src is None:
            continue
        dst_img = out_dir / split / "images"
        dst_lbl = out_dir / split / "labels"
        dst_img.mkdir(parents=True, exist_ok=True)
        dst_lbl.mkdir(parents=True, exist_ok=True)
        for img in src.iterdir():
            if not img.is_file():
                continue
            shutil.copy2(img, dst_img / img.name)
            lbl = src.parent / "labels" / (img.stem + ".txt")
            lines = []
            if lbl.exists():
                for ln in lbl.read_text().splitlines():
                    parts = ln.split()
                    if parts and int(parts[0]) == keep_id:
                        lines.append("0 " + " ".join(parts[1:]))
            (dst_lbl / (img.stem + ".txt")).write_text("\n".join(lines), encoding="utf-8")
    out_yaml = out_dir / "data.yaml"
    cfg = {"path": str(out_dir.resolve()), "train": "train/images", "val": "valid/images"}
    if (out_dir / "test" / "images").exists():
        cfg["test"] = "test/images"
    cfg.update({"nc": 1, "names": ["car"]})
    save_yaml(out_yaml, cfg)
    print(f"Tek sınıflı veri seti hazır: {out_yaml}")
    return out_yaml


def main():
    ap = argparse.ArgumentParser(description="(İsteğe bağlı) doluluk/araç tespiti ince ayarı")
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="yolov8n.pt")
    ap.add_argument("--sadece-sinif", help="Yalnızca bu sınıfı 'car' olarak tut (ör. space-occupied)")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--patience", type=int, default=20)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--name", default="vehicle-tr")
    ap.add_argument("--kopyala", action="store_true", help="best.pt'yi vision-service/models/vehicle_tr.pt olarak kopyala")
    args = ap.parse_args()

    data_yaml = Path(args.data)
    if args.sadece_sinif:
        data_yaml = make_single_class(data_yaml, args.sadece_sinif, TRAINING_DIR / "data" / "arac_tek_sinif")
    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics kurulu değil: pip install ultralytics")
    model = YOLO(args.model)
    model.train(data=str(data_yaml), epochs=args.epochs, patience=args.patience, imgsz=args.imgsz,
                batch=args.batch, device=args.device, workers=args.workers, name=args.name,
                project=str(TRAINING_DIR / "runs" / "detect"), exist_ok=True)
    best = Path(model.trainer.save_dir) / "weights" / "best.pt"
    print(f"En iyi ağırlıklar: {best}")
    if args.kopyala:
        dst = copy_to_vision(best, "vehicle_tr.pt", overwrite=True)
        print(f"Kopyalandı: {dst}\n.env: VEHICLE_MODEL={dst.name}  VEHICLE_CLASSES=0")


if __name__ == "__main__":
    main()
