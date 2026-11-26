"""YOLOv8 .pt modelini ONNX'e aktarır (CPU'da torch olmadan, onnxruntime ile hızlı çıkarım).

Örnek:
  python onnx_aktar.py --model ../vision-service/models/plate_detector_tr.pt
  python onnx_aktar.py --model ../vision-service/models/char_reader.pt --imgsz 320
  python onnx_aktar.py --model yolov8n.pt --hedef ../vision-service/models     (araç modeli)

Çıktı .pt dosyasının yanına (ya da --hedef klasörüne) aynı adla .onnx olarak yazılır.
Görüntü servisi .pt yoksa ya da .env'de PREFER_ONNX=true ise .onnx'i kullanır.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path


def verify(onnx_path: Path, imgsz: int) -> None:
    """onnxruntime ile yüklenip çalıştığını ve süresini kontrol eder."""
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        print("onnxruntime kurulu değil; doğrulama atlandı (pip install onnxruntime)")
        return
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    x = np.random.rand(1, 3, imgsz, imgsz).astype(np.float32)
    sess.run(None, {inp.name: x})
    t0 = time.perf_counter()
    for _ in range(5):
        out = sess.run(None, {inp.name: x})
    ms = (time.perf_counter() - t0) / 5 * 1000
    print(f"Doğrulandı: giriş {inp.shape}, çıkış {out[0].shape}, CPU'da ~{ms:.0f} ms/kare")


def main():
    ap = argparse.ArgumentParser(description=".pt -> ONNX dışa aktarım")
    ap.add_argument("--model", required=True, help=".pt dosyası (ya da ultralytics'in indireceği ad, ör. yolov8n.pt)")
    ap.add_argument("--imgsz", type=int, default=640, help="Giriş boyutu (karakter okuyucu için 320)")
    ap.add_argument("--opset", type=int, default=12)
    ap.add_argument("--no-simplify", action="store_true", help="onnxslim/onnxsim sadeleştirmesini kapat")
    ap.add_argument("--half", action="store_true", help="FP16 (yalnızca GPU'da anlamlı)")
    ap.add_argument("--hedef", help="Çıktının kopyalanacağı klasör")
    args = ap.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics kurulu değil: pip install ultralytics")

    model = YOLO(args.model)
    out = model.export(format="onnx", imgsz=args.imgsz, opset=args.opset, simplify=not args.no_simplify,
                       dynamic=False, half=args.half)
    out = Path(out)
    print(f"ONNX yazıldı: {out}")
    if args.hedef:
        dst = Path(args.hedef) / out.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.resolve() != out.resolve():
            shutil.copy2(out, dst)
            print(f"Kopyalandı: {dst}")
            out = dst
    verify(out, args.imgsz)


if __name__ == "__main__":
    main()
