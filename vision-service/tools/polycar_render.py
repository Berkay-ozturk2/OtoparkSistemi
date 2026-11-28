"""polycars araç modellerini (GLB) kamera videoları için önden/arkadan görünüşte çizer.

Modeller frontend/scripts/convert-polycars.mjs ile frontend/public/models/polycars altına üretilir.
Klasör yoksa available() False döner ve demo_uret.py eski düz çizim araçlarla devam eder.

Yalnızca numpy + OpenCV kullanır (OpenGL gerekmez): küçük bir z-tamponlu yazılım çizici.
"""
from __future__ import annotations

import json
import math
import struct
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

MODEL_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "models" / "polycars"

# Modelin hangi ucu aracın önü (+1: +Z, -1: -Z). Dönüştürücü uzun kenarı Z'ye çevirir ama yönü korur.
FRONT_SIGN: Dict[str, int] = {}

# Kapıdan geçen sıradan araçlar daha sık, gösterişli modeller arada bir
WEIGHTS = {"smarty": 3, "multiplx": 3, "toro86": 3, "tois08-gt": 3, "beatall": 2, "stuttgart996": 2,
           "landyroamer": 2, "doclorean": 1, "tristar-racer": 1, "toyoyo-highlight": 1}

# Gövde boyaları (BGR, sRGB) — Türkiye trafiğine yakın dağılım
PAINTS_BGR = [((241, 238, 236), 6), ((183, 175, 169), 4), ((110, 101, 95), 3), ((45, 39, 36), 3),
              ((31, 27, 142), 2), ((120, 63, 31), 2), ((176, 111, 63), 1), ((150, 183, 199), 1),
              ((69, 90, 47), 1), ((28, 88, 168), 1), ((33, 165, 217), 1)]

PLATE_Y = 0.11       # plaka merkezinin yerden yüksekliği (araç boyu = 1)
# Modelin kendi ön plakası farklı yükseklikteyse, bizimki onu örtsün diye oraya konur
FRONT_PLATE_Y = {"toro86": 0.072, "toyoyo-highlight": 0.17, "smarty": 0.14, "beatall": 0.09, "multiplx": 0.12}


def available() -> bool:
    return (MODEL_DIR / "manifest.json").exists()


def _srgb_to_lin(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lin_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


@lru_cache(maxsize=None)
def manifest() -> List[dict]:
    return json.loads((MODEL_DIR / "manifest.json").read_text(encoding="utf-8"))["cars"]


@lru_cache(maxsize=None)
def load_model(model_id: str) -> Dict[str, Tuple[np.ndarray, np.ndarray]]:
    """{'paint'|'detail': (üçgenler Nx3x3, renkler Nx3 doğrusal)}"""
    b = (MODEL_DIR / f"{model_id}.glb").read_bytes()
    jl = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + jl])
    bo = 20 + jl + 8
    parts = {}
    for mesh in j["meshes"]:
        at = mesh["primitives"][0]["attributes"]
        a = j["accessors"][at["POSITION"]]
        v = j["bufferViews"][a["bufferView"]]
        pos = np.frombuffer(b, np.float32, a["count"] * 3, bo + v.get("byteOffset", 0)).reshape(-1, 3, 3)
        a = j["accessors"][at["COLOR_0"]]
        v = j["bufferViews"][a["bufferView"]]
        col = np.frombuffer(b, np.uint8, a["count"] * 4, bo + v.get("byteOffset", 0)).reshape(-1, 3, 4)
        col = col[:, :, :3].mean(axis=1) / 255.0
        parts[mesh["name"]] = (pos.astype(np.float64), col)
    return parts


def pick_car(rng) -> Tuple[str, Tuple[int, int, int]]:
    ids = [m["id"] for m in manifest()]
    model = rng.choices(ids, weights=[WEIGHTS.get(i, 2) for i in ids])[0]
    paint = rng.choices([p for p, _ in PAINTS_BGR], weights=[w for _, w in PAINTS_BGR])[0]
    return model, paint


def render(model_id: str, paint_bgr=(240, 240, 240), width: int = 900, front: bool = True,
           yaw_deg: float = 0.0, front_sign: Optional[int] = None):
    """Aracı önden (front=True) ya da arkadan çizer.

    Dönüş: (BGRA görüntü, plaka merkezi (x, y), plaka için önerilen genişlik px)
    """
    parts = load_model(model_id)
    sign = front_sign if front_sign is not None else FRONT_SIGN.get(model_id, 1)
    facing = sign if front else -sign                       # kameraya bakan uç (+Z ya da -Z)
    tris, cols = [], []
    paint_lin = _srgb_to_lin(np.array(paint_bgr[::-1], np.float64) / 255.0)
    for name, (p, c) in parts.items():
        tris.append(p)
        cols.append(c * paint_lin if name == "paint" else c)
    tri = np.concatenate(tris)
    col = np.concatenate(cols)

    # Kamerayı aracın baktığı uca yerleştir: ucu +Z'ye çevir, hafif yan açı ver
    yaw = math.radians(yaw_deg) + (0.0 if facing > 0 else math.pi)
    cy, sy = math.cos(yaw), math.sin(yaw)
    rot = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    world = tri @ rot.T
    eye = np.array([0.0, 0.62, 2.35])
    target = np.array([0.0, 0.17, 0.0])
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    view = np.stack([r, u, -f])
    cam = (world - eye) @ view.T                            # kamera uzayı (−z ileri)
    fov = math.radians(30)
    fl = 1 / math.tan(fov / 2)

    def project(pts):
        z = -pts[..., 2]
        return np.stack([pts[..., 0] * fl / z, pts[..., 1] * fl / z], axis=-1), z

    ndc, depth = project(cam)
    # Görüntü sınırları: aracı kenar boşluğuyla sığdır
    mn = ndc.reshape(-1, 2).min(0)
    mx = ndc.reshape(-1, 2).max(0)
    pad = 0.03 * (mx[0] - mn[0])
    mn -= pad
    mx += pad
    k = width / (mx[0] - mn[0])
    height = int(math.ceil((mx[1] - mn[1]) * k))
    sx = (ndc[..., 0] - mn[0]) * k
    syy = (mx[1] - ndc[..., 1]) * k

    # Işık: düz gölgeleme (normal · ışık) + ortam
    n = np.cross(world[:, 1] - world[:, 0], world[:, 2] - world[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    light = np.array([-0.35, 0.8, 0.5])
    light /= np.linalg.norm(light)
    diff = np.abs(n @ light)
    up = np.clip(n[:, 1], 0, 1)
    shade = 0.28 + 0.62 * diff + 0.18 * up
    lin = col * shade[:, None]
    rgb = (_lin_to_srgb(lin) * 255).astype(np.uint8)

    img = np.zeros((height, width, 4), np.uint8)
    zbuf = np.full((height, width), np.inf)
    order = np.argsort(-depth.mean(1))                      # uzaktan yakına (z-tamponu da var)
    ys, xs = np.mgrid[0:height, 0:width]
    for i in order:
        x0, y0 = sx[i], syy[i]
        bx0, bx1 = max(0, int(x0.min())), min(width - 1, int(math.ceil(x0.max())))
        by0, by1 = max(0, int(y0.min())), min(height - 1, int(math.ceil(y0.max())))
        if bx1 < bx0 or by1 < by0:
            continue
        px = xs[by0:by1 + 1, bx0:bx1 + 1] + 0.5
        py = ys[by0:by1 + 1, bx0:bx1 + 1] + 0.5
        (ax, bx, cx), (ay, by, cy_) = x0, y0
        den = (by - cy_) * (ax - cx) + (cx - bx) * (ay - cy_)
        if abs(den) < 1e-9:
            continue
        w0 = ((by - cy_) * (px - cx) + (cx - bx) * (py - cy_)) / den
        w1 = ((cy_ - ay) * (px - cx) + (ax - cx) * (py - cy_)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        z = w0 * depth[i, 0] + w1 * depth[i, 1] + w2 * depth[i, 2]
        zb = zbuf[by0:by1 + 1, bx0:bx1 + 1]
        m = inside & (z < zb)
        zb[m] = z[m]
        tile = img[by0:by1 + 1, bx0:bx1 + 1]
        tile[m, 0] = rgb[i, 2]
        tile[m, 1] = rgb[i, 1]
        tile[m, 2] = rgb[i, 0]
        tile[m, 3] = 255

    # Plaka konumu: kameraya bakan uçta; modelin kendi plakası varsa tam onun yerinde
    zmax = world[..., 2].max()
    plate_y = FRONT_PLATE_Y.get(model_id, PLATE_Y) if front else PLATE_Y
    pc, _ = project(((np.array([0.0, plate_y, zmax]) - eye) @ view.T)[None])
    plate_xy = ((pc[0, 0] - mn[0]) * k, (mx[1] - pc[0, 1]) * k)
    left, _ = project(((np.array([-0.5, PLATE_Y, zmax]) - eye) @ view.T)[None])
    right, _ = project(((np.array([0.5, PLATE_Y, zmax]) - eye) @ view.T)[None])
    unit = (right[0, 0] - left[0, 0]) * k                    # 1 birimin (araç boyu) pikseli
    return img, plate_xy, unit
