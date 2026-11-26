"""Bilgisayardaki kameraları bulur: hangi numara (0, 1, 2...) görüntü veriyor?

Kullanım:  python tools/kamera_bul.py
Çıkan numarayı config/cameras.yaml içinde ilgili kameranın `source` alanına yazın (ör. source: "1").
"""
from __future__ import annotations

import sys
import time

import cv2


def backends():
    out = []
    if sys.platform.startswith("win"):
        if hasattr(cv2, "CAP_DSHOW"):
            out.append(("DirectShow", cv2.CAP_DSHOW))
        if hasattr(cv2, "CAP_MSMF"):
            out.append(("Media Foundation", cv2.CAP_MSMF))
    out.append(("varsayılan", None))
    return out


def try_camera(index: int, api):
    cap = cv2.VideoCapture(index, api) if api is not None else cv2.VideoCapture(index)
    if not cap or not cap.isOpened():
        return None
    try:
        for _ in range(15):
            ok, frame = cap.read()
            if ok and frame is not None and frame.size > 0:
                h, w = frame.shape[:2]
                return w, h, float(frame.mean())
            time.sleep(0.05)
        return None
    finally:
        cap.release()


def main() -> int:
    print("Kameralar taranıyor (0-5)... Kamerayı kullanan Zoom/Teams/Kamera uygulamalarını kapatın.\n")
    found = []
    for index in range(6):
        for name, api in backends():
            res = try_camera(index, api)
            if res:
                w, h, mean = res
                note = "  (görüntü çok karanlık/siyah — kapak kapalı olabilir)" if mean < 8 else ""
                print(f"  ✔ source: \"{index}\"  ->  {w}x{h}  [{name}]{note}")
                found.append(index)
                break
        else:
            print(f"  ✘ {index}: görüntü yok")
    print()
    if found:
        print(f"Çalışan kamera numaraları: {sorted(set(found))}")
        print("Bu numarayı vision-service/config/cameras.yaml içindeki giris-1 -> source alanına yazın,")
        print("enabled: true yapın ve görüntü servisini yeniden başlatın.")
        return 0
    print("Hiç kamera bulunamadı. Kontrol edin:")
    print("  1) Windows Ayarlar > Gizlilik ve güvenlik > Kamera > 'Masaüstü uygulamalarının kameraya erişmesine izin ver' AÇIK")
    print("  2) Kamera başka bir uygulamada açık değil (Zoom, Teams, Kamera, tarayıcı sekmesi)")
    print("  3) Dizüstünde kamera kapağı / klavyedeki kamera kapatma tuşu (F-tuşları) açık")
    print("  4) Aygıt Yöneticisi > Kameralar altında kamera görünüyor ve hata işareti yok")
    return 1


if __name__ == "__main__":
    sys.exit(main())
