"""Plaka okuma değerlendirmesi.

Başarı ölçütü B1: gündüz koşullarında plaka okuma doğruluğu ≥ %90
(doğru = plakanın TÜM karakterleri doğru okunmuş).

Kipler:
 1) Uçtan uca (görüntü servisinin tüm hattı: tespit + OCR + TR düzeltme):
      python degerlendir.py --csv etiketler.csv --resimler test_resimleri
    CSV: dosya,plaka[,kosul]   (başlık satırı isteğe bağlı; kosul ör. gunduz / gece / yagmur)
      arac001.jpg,34ABC123,gunduz
      arac002.jpg,06 AB 1234,gece
 2) Karakter okuyucu test kümesi (etiketlerden gerçek plaka metni üretilir):
      python degerlendir.py --karakter-test data/karakter --model ../vision-service/models/char_reader.pt
 3) Plaka tespit modeli mAP (ultralytics val):
      python degerlendir.py --tespit-test data/plaka_tespit/data.yaml --model ../vision-service/models/plate_detector_tr.pt

Sonuçlar --cikti ile CSV olarak kaydedilir (satır bazında tahmin, doğru/yanlış, süre).
"""
from __future__ import annotations

import argparse
import csv
import statistics
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from ortak import VISION_DIR, find_split_dir, list_images

sys.path.insert(0, str(VISION_DIR))

DAY_LABELS = {"gunduz", "gündüz", "day", "gun", "gün"}


def char_accuracy(pred: str, gt: str) -> float:
    from app.pipeline.tr_plate import levenshtein
    if not gt:
        return 0.0
    return max(0.0, 1.0 - levenshtein(pred, gt) / len(gt))


def summarize(rows: List[Dict], b1_threshold: float = 0.90) -> Dict:
    """Satır listesinden (gt, pred, ms, kosul, detected, valid) özet metrikler üretir."""
    def stats(sub: List[Dict]) -> Dict:
        n = len(sub)
        if n == 0:
            return {"n": 0}
        times = sorted(r["ms"] for r in sub)
        return {
            "n": n,
            "dogruluk": sum(r["pred"] == r["gt"] for r in sub) / n,
            "karakter_dogrulugu": sum(char_accuracy(r["pred"], r["gt"]) for r in sub) / n,
            "tespit_orani": sum(bool(r.get("detected", True)) for r in sub) / n,
            "gecerli_bicim_orani": sum(bool(r.get("valid")) for r in sub) / n,
            "ort_ms": statistics.mean(times),
            "medyan_ms": statistics.median(times),
            "p95_ms": times[min(n - 1, int(round(0.95 * (n - 1))))],
        }

    out = {"genel": stats(rows)}
    kosullar = sorted({r.get("kosul") or "" for r in rows} - {""})
    for k in kosullar:
        out[k] = stats([r for r in rows if r.get("kosul") == k])
    day = [r for r in rows if (r.get("kosul") or "").lower() in DAY_LABELS] if kosullar else rows
    day_stats = stats(day)
    out["B1"] = {
        "kume": "gündüz" if kosullar else "tümü (kosul sütunu yok)",
        "n": day_stats.get("n", 0),
        "dogruluk": day_stats.get("dogruluk"),
        "esik": b1_threshold,
        "sonuc": (day_stats.get("dogruluk") or 0) >= b1_threshold if day_stats.get("n") else None,
    }
    return out


def print_summary(s: Dict) -> None:
    print("\n================ DEĞERLENDİRME ================")
    for key, st in s.items():
        if key == "B1" or not st.get("n"):
            continue
        print(f"[{key}] n={st['n']}  plaka doğruluğu=%{st['dogruluk'] * 100:.1f}  "
              f"karakter=%{st['karakter_dogrulugu'] * 100:.1f}  tespit=%{st['tespit_orani'] * 100:.1f}  "
              f"geçerli biçim=%{st['gecerli_bicim_orani'] * 100:.1f}  süre ort/medyan/p95 = "
              f"{st['ort_ms']:.0f}/{st['medyan_ms']:.0f}/{st['p95_ms']:.0f} ms")
    b1 = s["B1"]
    if b1["n"]:
        verdict = "GEÇTİ" if b1["sonuc"] else "KALDI"
        print(f"\nB1 ölçütü ({b1['kume']}, n={b1['n']}): doğruluk %{b1['dogruluk'] * 100:.1f} "
              f"(eşik %{b1['esik'] * 100:.0f}) -> {verdict}")
    print("================================================")


def read_label_csv(path: Path) -> List[Dict]:
    from app.pipeline.tr_plate import normalize
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(2048)
        f.seek(0)
        delim = ";" if sample.count(";") > sample.count(",") else ","
        reader = csv.reader(f, delimiter=delim)
        for i, rec in enumerate(reader):
            if not rec or not rec[0].strip():
                continue
            if i == 0 and rec[0].strip().lower() in ("dosya", "file", "filename"):
                continue
            rows.append({"dosya": rec[0].strip(), "gt": normalize(rec[1] if len(rec) > 1 else ""),
                         "kosul": (rec[2].strip().lower() if len(rec) > 2 else "")})
    return rows


def run_end_to_end(args) -> List[Dict]:
    import cv2
    from app.config import get_settings
    from app.model_registry import ModelRegistry
    from app.pipeline.recognizer import best_result

    settings = get_settings()
    settings.LOAD_VEHICLE_DETECTOR = False
    if args.model:
        settings.PLATE_MODEL = str(Path(args.model).resolve())
    if args.ocr:
        settings.OCR_ENGINE = args.ocr
    reg = ModelRegistry(settings)
    reg.load_all()
    reason = reg.unavailable_reason(["plate"])
    if reason:
        sys.exit(reason)
    print(f"Modeller: {reg.health()}")
    labels = read_label_csv(Path(args.csv))
    base = Path(args.resimler) if args.resimler else Path(args.csv).parent
    rows = []
    for i, lab in enumerate(labels):
        img = cv2.imread(str(base / lab["dosya"]))
        if img is None:
            print(f"! okunamadı: {lab['dosya']}")
            continue
        if i == 0:
            reg.recognizer.recognize(img)  # ısınma (ilk çağrı yavaştır, süreye katılmaz)
        t0 = time.perf_counter()
        results = reg.recognizer.recognize(img, fast=args.hizli)
        ms = (time.perf_counter() - t0) * 1000
        best = best_result(results)
        pred = best.plate if best else ""
        rows.append({**lab, "pred": pred, "ms": ms, "detected": bool(results),
                     "valid": bool(best and best.format_valid), "conf": round(best.confidence, 3) if best else 0})
        mark = "OK " if pred == lab["gt"] else "X  "
        print(f"{mark}{lab['dosya']:<30} gerçek={lab['gt']:<10} tahmin={pred:<10} {ms:6.0f} ms")
    return rows


def run_char_test(args) -> List[Dict]:
    """Karakter veri setinin test kümesinde plaka bazında doğruluk."""
    import cv2
    import numpy as np
    from app.pipeline.ocr import YoloCharOcr, assemble_characters, load_char_classes

    root = Path(args.karakter_test)
    img_dir = find_split_dir(root, "test") or find_split_dir(root, "valid")
    if img_dir is None:
        sys.exit(f"{root} içinde test/ ya da valid/ bulunamadı")
    model_path = Path(args.model or (VISION_DIR / "models" / "char_reader.pt"))
    classes_path = Path(args.siniflar) if args.siniflar else model_path.with_name("char_classes.txt")
    ocr = YoloCharOcr(model_path, classes_path)
    if not ocr.load():
        sys.exit(f"Karakter modeli yüklenemedi: {ocr.error}")
    classes = load_char_classes(classes_path, ocr.model.names)
    rows = []
    for p in list_images(img_dir):
        lbl = p.parent.parent / "labels" / (p.stem + ".txt")
        img = cv2.imread(str(p))
        if img is None or not lbl.exists():
            continue
        h, w = img.shape[:2]
        dets = []
        for line in lbl.read_text().split("\n"):
            parts = line.split()
            if len(parts) >= 5:
                c, xc, yc, bw, bh = int(parts[0]), *map(float, parts[1:5])
                dets.append([(xc - bw / 2) * w, (yc - bh / 2) * h, (xc + bw / 2) * w, (yc + bh / 2) * h, 1.0, c])
        gt, _ = assemble_characters(np.array(dets, dtype=np.float32), classes, 0.0)
        from app.pipeline.tr_plate import normalize
        gt = normalize(gt)
        t0 = time.perf_counter()
        res = ocr.read(img, fast=args.hizli)
        ms = (time.perf_counter() - t0) * 1000
        rows.append({"dosya": p.name, "gt": gt, "pred": res.text, "ms": ms, "detected": bool(res.text),
                     "valid": res.valid, "kosul": ""})
    return rows


def run_detection_test(args) -> None:
    from ultralytics import YOLO
    model = YOLO(args.model or str(VISION_DIR / "models" / "plate_detector_tr.pt"))
    m = model.val(data=args.tespit_test, split="test", plots=False)
    b = m.box
    print(f"Precision={b.mp:.3f} Recall={b.mr:.3f} mAP50={b.map50:.3f} mAP50-95={b.map:.3f}")
    print(f"Hız (ms/resim): {m.speed}")


def main():
    ap = argparse.ArgumentParser(description="Plaka okuma doğruluğu değerlendirmesi (B1 ölçütü)")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--csv", help="Etiket CSV'si (dosya,plaka[,kosul])")
    mode.add_argument("--karakter-test", help="Karakter veri seti klasörü (test/ içerir)")
    mode.add_argument("--tespit-test", help="Plaka tespit data.yaml yolu")
    ap.add_argument("--resimler", help="Resim klasörü (vars. CSV'nin klasörü)")
    ap.add_argument("--model", help="Model yolu (kipe göre plaka ya da karakter modeli)")
    ap.add_argument("--siniflar", help="char_classes.txt yolu")
    ap.add_argument("--ocr", choices=["auto", "yolo-char", "easyocr"], help="OCR motorunu zorla")
    ap.add_argument("--hizli", action="store_true", help="Canlı kameradaki gibi az ön işleme varyantı")
    ap.add_argument("--esik", type=float, default=0.90, help="B1 eşiği (vars. 0.90)")
    ap.add_argument("--cikti", help="Satır bazında sonuç CSV'si")
    args = ap.parse_args()

    if args.tespit_test:
        return run_detection_test(args)
    rows = run_end_to_end(args) if args.csv else run_char_test(args)
    if not rows:
        sys.exit("Değerlendirilecek örnek yok")
    print_summary(summarize(rows, args.esik))
    if args.cikti:
        with open(args.cikti, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["dosya", "kosul", "gercek", "tahmin", "dogru", "karakter_dogrulugu", "gecerli_bicim", "ms"])
            for r in rows:
                w.writerow([r["dosya"], r.get("kosul", ""), r["gt"], r["pred"], int(r["pred"] == r["gt"]),
                            round(char_accuracy(r["pred"], r["gt"]), 3), int(bool(r.get("valid"))), round(r["ms"], 1)])
        print(f"Sonuçlar yazıldı: {args.cikti}")


if __name__ == "__main__":
    main()
