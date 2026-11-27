"""Backend'deki otopark krokilerinden doluluk kamerası cep yerleşimleri üretir (config/slots/*.json).

Üretilen yerleşim, krokinin ÜSTTEN görünüşüdür: kamera otoparkı tam tepeden görüyormuş gibi cepler
kroki koordinatlarıyla birebir çizilir. Kamera Testi'ndeki "örnek görüntü" ve demo için idealdir.
Gerçek bir kamerada cepler farklı açıyla göründüğünden, kamera kurulunca yerleşimi
`tools/slot_editor.py --load config/slots/<KİMLİK>.json --out config/slots/<KİMLİK>.json` ile
gerçek görüntü üzerinde yeniden çizin (cep kodları aynı kalmalıdır).

Çok katlı otoparklarda her kat ayrı bir kameradır: MERKEZ-B1, MERKEZ-Z, MERKEZ-K1 ...
GAZI varsayılan olarak atlanır (config/slots.json gerçek kamera açısıyla çizilmiştir).

Kullanım (backend açıkken):
    python tools/kroki_to_slots.py
    python tools/kroki_to_slots.py --lots AVM,HASTANE --backend http://localhost:5080
    python tools/kroki_to_slots.py --layout-json kroki.json    (GET /api/parking/lots/{kod}/layout çıktıları)
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Sequence

BASE = Path(__file__).resolve().parents[1]
MARGIN = 30


def floor_tag(floor: int) -> str:
    """-1 -> B1 (bodrum), 0 -> Z (zemin), 1 -> K1 (kat)."""
    if floor < 0:
        return f"B{-floor}"
    return "Z" if floor == 0 else f"K{floor}"


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=10) as r:  # noqa: S310 (yerel backend)
        return json.loads(r.read().decode("utf-8"))


def build_layouts(layout: dict, margin: int = MARGIN) -> List[dict]:
    """Bir otoparkın kroki yanıtından (lot + slots) kat başına yerleşim üretir."""
    lot = layout["lot"]
    code = str(lot["code"]).upper()
    floors = {int(f["floor"]): f.get("name") for f in (lot.get("floors") or [])}
    by_floor: Dict[int, List[dict]] = {}
    for s in layout.get("slots", []):
        if s.get("isActive", True) is False:
            continue
        by_floor.setdefault(int(s.get("floor", 0)), []).append(s)
    multi = len(by_floor) > 1
    out = []
    for floor in sorted(by_floor):
        slots = sorted(by_floor[floor], key=lambda s: s["code"])
        x0 = max(0, min(s["mapX"] for s in slots) - margin)
        y0 = max(0, min(s["mapY"] for s in slots) - margin)
        x1 = max(s["mapX"] + s["mapW"] for s in slots) + margin
        y1 = max(s["mapY"] + s["mapH"] for s in slots) + margin
        layout_id = f"{code}-{floor_tag(floor)}" if multi else code
        name = lot.get("name") or code
        if multi:
            name = f"{name} – {floors.get(floor) or floor_tag(floor)}"
        items = []
        for s in slots:
            x, y, w, h = s["mapX"] - x0, s["mapY"] - y0, s["mapW"], s["mapH"]
            item = {"code": str(s["code"]).upper(), "polygon": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]}
            if str(s.get("type")) in ("Disabled", "1"):
                item["disabled"] = True
            items.append(item)
        out.append({
            "id": layout_id,
            "lotCode": code,
            "name": f"{name} · krokiden üstten görünüş",
            "floor": floor,
            "imageWidth": int(x1 - x0),
            "imageHeight": int(y1 - y0),
            "slots": items,
        })
    return out


def write_layout(data: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{data['id']}.json"
    head = {k: v for k, v in data.items() if k != "slots"}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},")
    lines.append('  "slots": [')
    for i, s in enumerate(data["slots"]):
        lines.append("    " + json.dumps(s, ensure_ascii=False) + ("," if i < len(data["slots"]) - 1 else ""))
    lines.append("  ]")
    lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def parse_args(argv: Optional[Sequence[str]] = None):
    ap = argparse.ArgumentParser(description="Krokiden doluluk kamerası cep yerleşimi üret")
    ap.add_argument("--backend", default="http://localhost:5080", help="Backend adresi")
    ap.add_argument("--layout-json", help="Backend yerine kroki yanıtlarını içeren JSON dosyası (liste)")
    ap.add_argument("--lots", help="Yalnızca bu otoparklar (virgülle, ör. AVM,HASTANE)")
    ap.add_argument("--include-gazi", action="store_true", help="GAZI için de üret (config/slots/GAZI.json)")
    ap.add_argument("--out", default=str(BASE / "config" / "slots"), help="Çıktı klasörü")
    return ap.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    a = parse_args(argv)
    wanted = {c.strip().upper() for c in a.lots.split(",")} if a.lots else None
    if a.layout_json:
        layouts = json.loads(Path(a.layout_json).read_text(encoding="utf-8"))
    else:
        base = a.backend.rstrip("/")
        try:
            lots = fetch_json(f"{base}/api/parking/lots")
            layouts = [fetch_json(f"{base}/api/parking/lots/{l['code']}/layout") for l in lots]
        except Exception as exc:
            print(f"Backend'e ulaşılamadı ({base}): {exc}\nÖnce sistemi başlatın (scripts\\2_baslat.bat).")
            return 1
    count = 0
    for layout in layouts:
        code = str(layout["lot"]["code"]).upper()
        if wanted and code not in wanted:
            continue
        if code == "GAZI" and not a.include_gazi and not wanted:
            print("  - GAZI atlandı (config/slots.json kullanılıyor; --include-gazi ile üretilebilir)")
            continue
        for data in build_layouts(layout):
            p = write_layout(data, Path(a.out))
            count += 1
            print(f"  ✔ {p.name}: {len(data['slots'])} cep, {data['imageWidth']}x{data['imageHeight']}")
    print(f"{count} yerleşim yazıldı -> {a.out}")
    return 0 if count else 1


if __name__ == "__main__":
    sys.exit(main())
