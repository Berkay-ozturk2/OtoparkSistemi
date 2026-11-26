"""Tek resim (ya da klasör) üzerinde görüntü işleme hattını çalıştıran komut satırı aracı.

Servisi açmadan modelleri denemek için:
    python tools/test_image.py samples/arac.jpg
    python tools/test_image.py samples/arac.jpg --out sonuc.jpg --show
    python tools/test_image.py samples/otopark.jpg --mode occupancy
    python tools/test_image.py samples/ --mode plate             (klasördeki tüm resimler)
    python tools/test_image.py samples/arac.jpg --forward --gate Entry   (backend'e de gönder)
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2  # noqa: E402

from app.backend_client import BackendClient, utc_now_iso  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.model_registry import ModelRegistry  # noqa: E402
from app.pipeline import tr_plate  # noqa: E402
from app.pipeline.occupancy import draw_layout, evaluate_slots, load_layout  # noqa: E402
from app.pipeline.recognizer import annotate_plates, best_result, to_base64_jpeg  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main():
    ap = argparse.ArgumentParser(description="Resim üzerinde plaka tanıma / doluluk analizi")
    ap.add_argument("path", help="Resim dosyası ya da klasör")
    ap.add_argument("--mode", choices=["plate", "occupancy", "both"], default="plate")
    ap.add_argument("--out", help="Çizimli çıktı dosyası (klasör girişinde çıktı klasörü)")
    ap.add_argument("--show", action="store_true", help="Sonucu pencerede göster")
    ap.add_argument("--forward", action="store_true", help="En iyi plakayı backend'e plaka olayı olarak gönder")
    ap.add_argument("--gate", choices=["Entry", "Exit"], default="Entry")
    ap.add_argument("--camera-id", default="cli-test")
    args = ap.parse_args()

    settings = get_settings()
    if args.mode == "plate":
        settings.LOAD_VEHICLE_DETECTOR = False
    reg = ModelRegistry(settings)
    print("Modeller yükleniyor...")
    reg.load_all()
    print(f"Durum: {reg.health()}  hatalar: {reg.errors or '-'}")

    p = Path(args.path)
    files = sorted(f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXT) if p.is_dir() else [p]
    if not files:
        sys.exit("Resim bulunamadı")
    backend = BackendClient(settings.BACKEND_URL, settings.VISION_API_KEY, settings.BACKEND_TIMEOUT, 1) if args.forward else None

    for f in files:
        img = cv2.imread(str(f))
        if img is None:
            print(f"! okunamadı: {f}")
            continue
        annotated = img
        print(f"\n=== {f.name} ({img.shape[1]}x{img.shape[0]}) ===")
        if args.mode in ("plate", "both"):
            reason = reg.unavailable_reason(["plate"])
            if reason:
                sys.exit(reason)
            t0 = time.perf_counter()
            results = reg.recognizer.recognize(img)
            ms = (time.perf_counter() - t0) * 1000
            if not results:
                print(f"Plaka bulunamadı ({ms:.0f} ms)")
            for r in results:
                print(f"  {tr_plate.format_display(r.plate) or '?':<12} ham='{r.raw_text}' geçerli={r.format_valid} "
                      f"güven={r.confidence:.2f} (tespit {r.detection_confidence:.2f} × ocr {r.ocr_confidence:.2f}) "
                      f"kutu={r.bbox}")
            print(f"  süre: {ms:.0f} ms, ocr: {reg.ocr.name}")
            annotated = annotate_plates(annotated, results)
            if backend:
                best = best_result(results)
                if best:
                    ok, body = backend.send_plate_event(args.camera_id, args.gate, best.plate, best.confidence,
                                                        best.format_valid, to_base64_jpeg(best.crop, 85, 400), utc_now_iso())
                    print(f"  backend: {'OK' if ok else 'HATA'} -> {body}")
        if args.mode in ("occupancy", "both"):
            reason = reg.unavailable_reason(["vehicle"])
            if reason:
                sys.exit(reason)
            layout = load_layout(settings.slots_file).scaled(img.shape[1], img.shape[0])
            t0 = time.perf_counter()
            vehicles = reg.vehicle_detector.detect(img, conf=settings.VEHICLE_CONFIDENCE)
            obs = evaluate_slots(layout, [v.bbox for v in vehicles], [v.confidence for v in vehicles],
                                 settings.OCCUPANCY_THRESHOLD, settings.OCCUPANCY_FOOTPRINT)
            ms = (time.perf_counter() - t0) * 1000
            occ = [o.code for o in obs if o.occupied]
            print(f"  araç: {len(vehicles)}, dolu cep: {len(occ)}/{len(obs)} -> {', '.join(occ) or '-'} ({ms:.0f} ms)")
            annotated = draw_layout(annotated, layout, {o.code: o.occupied for o in obs})
            for v in vehicles:
                x1, y1, x2, y2 = [int(a) for a in v.bbox]
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 160, 0), 2)

        if args.out:
            out = Path(args.out)
            if p.is_dir():
                out.mkdir(parents=True, exist_ok=True)
                out = out / f"{f.stem}_sonuc.jpg"
            cv2.imwrite(str(out), annotated)
            print(f"  kaydedildi: {out}")
        if args.show:
            cv2.imshow("Sonuc (bir tusa basin)", annotated)
            if (cv2.waitKey(0) & 0xFF) in (ord("q"), 27):
                break
    if args.show:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
