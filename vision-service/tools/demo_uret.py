"""Gerçek kamera ve otopark OLMADAN uçtan uca test için sentetik demo içeriği üretir.

Üretilenler (varsayılan: vision-service/samples/demo/):
  doluluk.mp4   Üstten görünüşlü GAZI otoparkı. Cepler config/slots.json geometrisiyle BİREBİR çizilir,
                araçlar zamanla park edip ayrılır. Engelli cebe (A02) izinsiz araç park eder -> ihlal demosu.
                cameras.demo.yaml'da `detector: color` ile okunur (demo renk dedektörü).
  giris.mp4     Bariyere yaklaşan, Türk plakalı araçlar (önden görünüş) -> giriş kamerası
  cikis.mp4     Aynı araçlar çıkışta -> çıkış kamerası
  plaka_*.jpg   Tek araç fotoğrafları -> Operatör > Kamera Testi'ne yüklemek için
  plakalar.txt  Videolardaki plakaların listesi

Videolar döngüsel oynatılır (bitince başa sarar), böylece sürekli canlı kamera gibi davranır.

Kullanım:
    python tools/demo_uret.py
    python tools/demo_uret.py --seconds 120 --plates 34DMO101,06DMO202
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from app.pipeline.sample_scene import ASPHALT, CAR_COLORS, draw_car_top  # noqa: E402,F401 (ortak çizim)
from app.pipeline.tr_plate import format_display, is_valid, normalize  # noqa: E402

DEFAULT_PLATES = ["34DMO101", "06ENG061", "06DMO202", "35DMO303", "16DMO404", "07DMO505"]
DISABLED_SLOTS = {"A01", "A02"}           # DbSeeder: GAZI'de girişe en yakın iki engelli cep


# ----------------------------------------------------------------------------- yazı tipi / plaka
def _font(size: int):
    from PIL import ImageFont
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf",
                 "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return None


def render_plate(plate: str, width: int = 520) -> np.ndarray:
    """Türk plakası görünümünde görüntü (BGR): beyaz zemin, sol mavi TR şeridi, siyah yazı."""
    h = int(width * 0.215)
    img = np.full((h, width, 3), 255, np.uint8)
    strip = int(width * 0.085)
    cv2.rectangle(img, (0, 0), (strip, h), (160, 60, 0), -1)          # mavi şerit (BGR)
    cv2.rectangle(img, (0, 0), (width - 1, h - 1), (20, 20, 20), max(2, width // 130))
    text = format_display(plate)
    font = _font(int(h * 0.62))
    if font is not None:
        from PIL import Image, ImageDraw
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(pil)
        # Yazıyı plakaya sığdır (şerit hariç genişliğin ~%88'i)
        size = int(h * 0.62)
        while size > 10 and d.textlength(text, font=font) > (width - strip) * 0.88:
            size -= 2
            font = _font(size)
        small = _font(max(8, int(strip * 0.42)))
        if small is not None:
            d.text((strip // 2, int(h * 0.78)), "TR", font=small, fill=(255, 255, 255), anchor="mm")
        d.text((strip + (width - strip) // 2, h // 2), text, font=font, fill=(10, 10, 10), anchor="mm")
        img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    else:  # Pillow/yazı tipi yoksa OpenCV yazısı
        cv2.putText(img, "TR", (int(strip * 0.15), int(h * 0.85)), cv2.FONT_HERSHEY_SIMPLEX, h / 110, (255, 255, 255), 2)
        scale = h / 38
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, 3)
        cv2.putText(img, text, (strip + (width - strip - tw) // 2, (h + th) // 2), cv2.FONT_HERSHEY_DUPLEX,
                    scale, (10, 10, 10), 3, cv2.LINE_AA)
    return img


# ----------------------------------------------------------------------------- giriş/çıkış sahnesi
def draw_car_front(canvas: np.ndarray, cx: int, bottom: int, scale: float, color, plate_img: np.ndarray) -> None:
    """Önden görünüşlü basit araç çizer; plaka tamponun ortasında."""
    w = int(620 * scale)
    h = int(380 * scale)
    x1, y1 = cx - w // 2, bottom - h
    x2, y2 = cx + w // 2, bottom
    shade = tuple(int(c * 0.6) for c in color)
    # gövde ve tavan
    cv2.rectangle(canvas, (x1, y1 + int(h * 0.30)), (x2, y2), color, -1)
    cv2.rectangle(canvas, (x1 + int(w * 0.14), y1), (x2 - int(w * 0.14), y1 + int(h * 0.34)), color, -1)
    # ön cam
    cv2.rectangle(canvas, (x1 + int(w * 0.18), y1 + int(h * 0.05)), (x2 - int(w * 0.18), y1 + int(h * 0.30)),
                  (70, 50, 40), -1)
    # farlar, ızgara, tampon, tekerlekler
    for fx in (x1 + int(w * 0.04), x2 - int(w * 0.20)):
        cv2.rectangle(canvas, (fx, y1 + int(h * 0.42)), (fx + int(w * 0.16), y1 + int(h * 0.54)), (210, 240, 250), -1)
    cv2.rectangle(canvas, (x1 + int(w * 0.30), y1 + int(h * 0.44)), (x2 - int(w * 0.30), y1 + int(h * 0.56)), shade, -1)
    cv2.rectangle(canvas, (x1, y1 + int(h * 0.62)), (x2, y1 + int(h * 0.90)), (45, 45, 45), -1)
    for wx in (x1 + int(w * 0.02), x2 - int(w * 0.16)):
        cv2.rectangle(canvas, (wx, y2 - int(h * 0.10)), (wx + int(w * 0.14), y2), (20, 20, 20), -1)
    # plaka
    pw = int(w * 0.42)
    if pw >= 24:
        p = cv2.resize(plate_img, (pw, int(pw * plate_img.shape[0] / plate_img.shape[1])), interpolation=cv2.INTER_AREA)
        px, py = cx - pw // 2, y1 + int(h * 0.66)
        H, W = canvas.shape[:2]
        if 0 <= px and px + p.shape[1] <= W and 0 <= py and py + p.shape[0] <= H:
            canvas[py:py + p.shape[0], px:px + p.shape[1]] = p


def gate_background(w: int, h: int, label: str) -> np.ndarray:
    bg = np.zeros((h, w, 3), np.uint8)
    bg[:] = (150, 135, 120)                                   # duvar
    cv2.rectangle(bg, (0, int(h * 0.55)), (w, h), (80, 80, 80), -1)   # yol
    for x in range(0, w, 120):
        cv2.rectangle(bg, (x, int(h * 0.92)), (x + 60, int(h * 0.94)), (230, 230, 230), -1)
    cv2.rectangle(bg, (int(w * 0.86), int(h * 0.30)), (int(w * 0.89), int(h * 0.80)), (40, 40, 40), -1)  # bariyer direği
    cv2.putText(bg, f"DEMO - {label} kamerasi (sentetik)", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    return bg


def make_gate_video(path: Path, plates: Sequence[str], label: str, fps: int, size=(1280, 720), seed: int = 1,
                    lead_cars: int = 0) -> Path:
    """lead_cars>0: video başında o kadar araçlık boşluk bırakılır (çıkış videosunda araçlar önce girsin)."""
    w, h = size
    rng = random.Random(seed)
    bg = gate_background(w, h, label)
    writer, path = _writer(path, fps, size)
    approach, hold, leave, gap = int(2.0 * fps), int(2.5 * fps), int(0.8 * fps), int(1.0 * fps)
    for _ in range(lead_cars * (approach + hold + leave + gap)):
        writer.write(bg)
    for plate in plates:
        color = rng.choice(CAR_COLORS)
        plate_img = render_plate(plate)
        for i in range(approach + hold + leave):
            frame = bg.copy()
            if i < approach:
                t = i / approach
                scale, bottom = 0.45 + 0.55 * t, int(h * (0.70 + 0.22 * t))
            elif i < approach + hold:
                scale, bottom = 1.0, int(h * 0.92)
            else:
                t = (i - approach - hold) / leave
                scale, bottom = 1.0 + 0.6 * t, int(h * (0.92 + 0.6 * t))
            draw_car_front(frame, w // 2 - 60, bottom, scale, color, plate_img)
            cv2.putText(frame, f"{label}: {format_display(plate)}", (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (255, 255, 255), 1)
            writer.write(frame)
        for _ in range(gap):
            writer.write(bg)
    writer.release()
    return path


def make_plate_photos(out: Path, plates: Sequence[str], seed: int = 2) -> List[Path]:
    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, plate in enumerate(plates, 1):
        img = gate_background(1280, 720, "ornek")
        draw_car_front(img, 580, int(720 * 0.92), 1.0, rng.choice(CAR_COLORS), render_plate(plate))
        p = out / f"plaka_{i:02d}_{plate}.jpg"
        cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        paths.append(p)
    return paths


# ----------------------------------------------------------------------------- doluluk sahnesi
def load_slots(path: Path) -> Tuple[int, int, List[Tuple[str, np.ndarray]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    slots = [(s["code"], np.array(s["polygon"], np.int32)) for s in data["slots"]]
    return int(data.get("imageWidth", 1280)), int(data.get("imageHeight", 720)), slots


def lot_background(w: int, h: int, slots, disabled: set) -> np.ndarray:
    bg = np.zeros((h, w, 3), np.uint8)
    bg[:] = ASPHALT
    rng = np.random.default_rng(3)
    noise = rng.integers(-6, 7, size=(h, w, 1), dtype=np.int16)
    bg = np.clip(bg.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    for code, poly in slots:
        cv2.polylines(bg, [poly], True, (235, 235, 235), 2)
        x, y, bw, bh = cv2.boundingRect(poly)
        cv2.putText(bg, code, (x + 6, y + bh - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
        if code in disabled:   # ince mavi işaret (dedektör büyük doygun blok aradığı için araç sayılmaz)
            cv2.rectangle(bg, (x + 4, y + 4), (x + bw - 4, y + bh - 4), (200, 110, 20), 1)
            cv2.putText(bg, "ENGELLI", (x + 8, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 110, 20), 1, cv2.LINE_AA)
    cv2.putText(bg, "DEMO - Doluluk kamerasi (sentetik, GAZI)", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                (255, 255, 255), 2)
    return bg


def build_schedule(codes: Sequence[str], frames: int, fps: int, rng: random.Random) -> Dict[str, List[Tuple[int, int, int]]]:
    """Her cep için (başlangıç, bitiş, renk) aralıkları. Engelli cepler özel senaryo izler."""
    sched: Dict[str, List[Tuple[int, int, int]]] = {}
    for code in codes:
        if code in DISABLED_SLOTS:
            continue
        items = []
        t = 0 if rng.random() < 0.35 else rng.randint(0, frames // 3)
        while t < frames:
            dur = rng.randint(int(frames * 0.15), int(frames * 0.55))
            items.append((t, min(frames - 1, t + dur), rng.randrange(len(CAR_COLORS))))
            t += dur + rng.randint(int(frames * 0.05), int(frames * 0.35))
        sched[code] = items
    # Engelli cepler: A01 izinli araç gibi (simülatör/LPR ile girer), A02 İZİNSİZ park -> ihlal, sonra ayrılır
    if "A01" in codes:
        sched["A01"] = [(int(frames * 0.20), int(frames * 0.55), 6)]
    if "A02" in codes:
        sched["A02"] = [(int(frames * 0.45), int(frames * 0.75), 0)]
    return sched


def make_occupancy_video(path: Path, slots_file: Path, seconds: int, fps: int, seed: int = 7) -> Path:
    w, h, slots = load_slots(slots_file)
    frames = seconds * fps
    rng = random.Random(seed)
    sched = build_schedule([c for c, _ in slots], frames, fps, rng)
    bg = lot_background(w, h, slots, DISABLED_SLOTS)
    writer, path = _writer(path, fps, (w, h))
    slide_frames = max(1, int(1.2 * fps))
    for f in range(frames):
        frame = bg.copy()
        for code, poly in slots:
            for start, end, ci in sched.get(code, []):
                if start <= f <= end:
                    if f - start < slide_frames:
                        alpha = (f - start + 1) / slide_frames         # park ediyor
                    elif end - f < slide_frames:
                        alpha = (end - f + 1) / slide_frames           # ayrılıyor
                    else:
                        alpha = 1.0
                    draw_car_top(frame, poly, CAR_COLORS[ci], alpha)
        cv2.putText(frame, f"t={f / fps:5.1f}s", (w - 160, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        writer.write(frame)
    writer.release()
    return path


# ----------------------------------------------------------------------------- yardımcılar
def _writer(path: Path, fps: int, size: Tuple[int, int]):
    path.parent.mkdir(parents=True, exist_ok=True)
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if w.isOpened():
        return w, path
    alt = path.with_suffix(".avi")   # mp4 kodlayıcısı yoksa
    w = cv2.VideoWriter(str(alt), cv2.VideoWriter_fourcc(*"MJPG"), fps, size)
    if not w.isOpened():
        raise RuntimeError(f"Video yazılamadı: {path}")
    print(f"  ! mp4 kodlayıcısı yok, {alt.name} olarak yazılıyor (cameras.demo.yaml'da uzantıyı değiştirin)")
    return w, alt


def parse_args(argv: Optional[Sequence[str]] = None):
    ap = argparse.ArgumentParser(description="Sentetik demo videoları ve plaka fotoğrafları üretir")
    ap.add_argument("--out", default=str(BASE / "samples" / "demo"), help="Çıktı klasörü")
    ap.add_argument("--slots", default=str(BASE / "config" / "slots.json"), help="Cep poligonları")
    ap.add_argument("--seconds", type=int, default=90, help="Doluluk videosu süresi (sn)")
    ap.add_argument("--fps", type=int, default=10, help="Doluluk videosu FPS")
    ap.add_argument("--gate-fps", type=int, default=15, help="Giriş/çıkış videosu FPS")
    ap.add_argument("--plates", default=",".join(DEFAULT_PLATES), help="Virgülle plakalar")
    ap.add_argument("--only", choices=["doluluk", "giris", "cikis", "foto"], help="Yalnızca birini üret")
    return ap.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    a = parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    plates = [normalize(p) for p in a.plates.split(",") if p.strip()]
    bad = [p for p in plates if not is_valid(p)]
    if bad:
        print(f"Geçersiz TR plaka biçimi: {bad}")
        return 2
    print(f"Demo içeriği üretiliyor -> {out}")
    if a.only in (None, "doluluk"):
        p = make_occupancy_video(out / "doluluk.mp4", Path(a.slots), a.seconds, a.fps)
        print(f"  ✔ {p.name}  ({a.seconds} sn, slots.json ile birebir cepler)")
    if a.only in (None, "giris"):
        p = make_gate_video(out / "giris.mp4", plates, "GIRIS", a.gate_fps, seed=1)
        print(f"  ✔ {p.name}  ({len(plates)} araç)")
    if a.only in (None, "cikis"):
        p = make_gate_video(out / "cikis.mp4", plates, "CIKIS", a.gate_fps, seed=1, lead_cars=2)
        print(f"  ✔ {p.name}  ({len(plates)} araç; girişten 2 araç sonra başlar)")
    if a.only in (None, "foto"):
        for p in make_plate_photos(out, plates):
            print(f"  ✔ {p.name}")
    (out / "plakalar.txt").write_text("\n".join(format_display(p) for p in plates) + "\n", encoding="utf-8")
    print("Bitti. Demo kameraları için: scripts\\6_demo_baslat.bat (CAMERAS_FILE=config/cameras.demo.yaml)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
