"""Cep poligonu çizim aracı (OpenCV penceresi).

Doluluk kamerasının bir karesi üzerinde fareyle cepleri çizip config/slots.json üretir.

Kullanım:
    python tools/slot_editor.py --image samples/otopark.jpg
    python tools/slot_editor.py --video samples/otopark.mp4 --frame 50
    python tools/slot_editor.py --camera 0
    python tools/slot_editor.py --image samples/otopark.jpg --load config/slots.json   (düzenleme)

Tuşlar / fare:
    sol tık        nokta ekle
    sağ tık/Enter  cebi kapat (en az 3 nokta) — kod otomatik verilir (A01, A02, ... A10, B01 ...)
    c              sıradaki cep kodunu klavyeden yaz (konsoldan)
    u              son noktayı geri al (çizim yoksa son cebi sil)
    r              sıra harfini değiştir (A -> B -> C ...), numara 01'den başlar
    s              kaydet (--out, vars. config/slots.json)
    h              yardımı göster
    q / Esc        çık (kaydetmeden)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

BASE = Path(__file__).resolve().parents[1]
WINDOW = "Cep Editoru (s: kaydet, q: cik, h: yardim)"


def load_frame(args) -> np.ndarray:
    if args.image:
        img = cv2.imread(args.image)
        if img is None:
            sys.exit(f"Resim açılamadı: {args.image}")
        return img
    source = int(args.camera) if args.camera is not None else args.video
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        sys.exit(f"Kaynak açılamadı: {source}")
    if args.video and args.frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    frame = None
    for _ in range(10 if args.camera is not None else 1):  # webcam pozlaması otursun
        ok, f = cap.read()
        if ok:
            frame = f
    cap.release()
    if frame is None:
        sys.exit("Kare okunamadı")
    return frame


class Editor:
    def __init__(self, frame: np.ndarray, out: Path, row: str = "A"):
        self.frame = frame
        self.out = out
        self.slots: List[dict] = []
        self.current: List[Tuple[int, int]] = []
        self.row = row
        self.mouse = (0, 0)
        self.forced_code: Optional[str] = None

    def next_code(self) -> str:
        if self.forced_code:
            return self.forced_code
        used = {s["code"] for s in self.slots}
        n = 1
        while f"{self.row}{n:02d}" in used:
            n += 1
        return f"{self.row}{n:02d}"

    def on_mouse(self, event, x, y, flags, _param):
        self.mouse = (x, y)
        if event == cv2.EVENT_LBUTTONDOWN:
            self.current.append((x, y))
        elif event == cv2.EVENT_RBUTTONDOWN:
            self.close_polygon()

    def close_polygon(self):
        if len(self.current) < 3:
            print("En az 3 nokta gerekli.")
            return
        code = self.next_code()
        self.slots = [s for s in self.slots if s["code"] != code]
        self.slots.append({"code": code, "polygon": [list(p) for p in self.current]})
        print(f"Cep eklendi: {code} ({len(self.current)} nokta)")
        self.current = []
        self.forced_code = None

    def draw(self) -> np.ndarray:
        img = self.frame.copy()
        overlay = img.copy()
        for s in self.slots:
            pts = np.array(s["polygon"], np.int32)
            cv2.fillPoly(overlay, [pts], (0, 180, 0))
        img = cv2.addWeighted(overlay, 0.25, img, 0.75, 0)
        for s in self.slots:
            pts = np.array(s["polygon"], np.int32)
            cv2.polylines(img, [pts], True, (0, 220, 0), 2)
            cx, cy = pts.mean(axis=0).astype(int)
            cv2.putText(img, s["code"], (int(cx) - 18, int(cy) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        if self.current:
            pts = np.array(self.current + [self.mouse], np.int32)
            cv2.polylines(img, [pts], False, (0, 200, 255), 2)
            for p in self.current:
                cv2.circle(img, p, 4, (0, 200, 255), -1)
        info = f"Siradaki: {self.next_code()}  |  cep sayisi: {len(self.slots)}  |  sol tik: nokta, sag tik/Enter: kapat, s: kaydet"
        cv2.rectangle(img, (0, 0), (img.shape[1], 28), (40, 40, 40), -1)
        cv2.putText(img, info, (8, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        return img

    def save(self):
        h, w = self.frame.shape[:2]
        data = {"imageWidth": w, "imageHeight": h,
                "slots": sorted(self.slots, key=lambda s: (s["code"][0], s["code"][1:].zfill(3)))}
        self.out.parent.mkdir(parents=True, exist_ok=True)
        lines = ["{", f'  "imageWidth": {w},', f'  "imageHeight": {h},', '  "slots": [']
        for i, s in enumerate(data["slots"]):
            lines.append("    " + json.dumps(s) + ("," if i < len(data["slots"]) - 1 else ""))
        lines += ["  ]", "}"]
        self.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"Kaydedildi: {self.out} ({len(self.slots)} cep, {w}x{h})")

    def run(self):
        cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(WINDOW, min(1400, self.frame.shape[1]), min(850, self.frame.shape[0]))
        cv2.setMouseCallback(WINDOW, self.on_mouse)
        print(__doc__)
        while True:
            cv2.imshow(WINDOW, self.draw())
            key = cv2.waitKey(30) & 0xFF
            if key in (ord("q"), 27):
                break
            if key in (13, 10):
                self.close_polygon()
            elif key == ord("u"):
                if self.current:
                    self.current.pop()
                elif self.slots:
                    print(f"Silindi: {self.slots.pop()['code']}")
            elif key == ord("r"):
                self.row = chr(ord(self.row) + 1) if self.row < "Z" else "A"
                print(f"Sıra harfi: {self.row}")
            elif key == ord("c"):
                code = input("Sıradaki cep kodu (ör. B07): ").strip().upper()
                self.forced_code = code or None
            elif key == ord("s"):
                self.save()
            elif key == ord("h"):
                print(__doc__)
            if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                break
        cv2.destroyAllWindows()


def main():
    ap = argparse.ArgumentParser(description="Doluluk kamerası için cep poligonu çizim aracı")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--image", help="Resim dosyası")
    src.add_argument("--video", help="Video dosyası")
    src.add_argument("--camera", help="Webcam indeksi (ör. 0)")
    ap.add_argument("--frame", type=int, default=0, help="Videodan alınacak kare numarası")
    ap.add_argument("--out", default=str(BASE / "config" / "slots.json"), help="Çıktı dosyası")
    ap.add_argument("--load", help="Var olan slots.json'u yükleyip düzenle")
    ap.add_argument("--row", default="A", help="Başlangıç sıra harfi (vars. A)")
    args = ap.parse_args()

    frame = load_frame(args)
    editor = Editor(frame, Path(args.out), args.row.upper()[:1])
    if args.load:
        data = json.loads(Path(args.load).read_text(encoding="utf-8"))
        sx = frame.shape[1] / float(data.get("imageWidth", frame.shape[1]))
        sy = frame.shape[0] / float(data.get("imageHeight", frame.shape[0]))
        for s in data.get("slots", []):
            editor.slots.append({"code": s["code"], "polygon": [[int(x * sx), int(y * sy)] for x, y in s["polygon"]]})
        print(f"{len(editor.slots)} cep yüklendi: {args.load}")
    editor.run()


if __name__ == "__main__":
    main()
