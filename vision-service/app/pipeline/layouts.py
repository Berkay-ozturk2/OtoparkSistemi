"""Doluluk kamerası görüş alanları (cep poligonu yerleşimleri) kaydı.

Her otopark (çok katlıysa her kat) için ayrı bir yerleşim dosyası bulunur:

    config/slots.json            GAZI pilot alanı (gerçek kamera açısıyla çizilmiş, varsayılan)
    config/slots/AVM.json        Çarşı AVM
    config/slots/HASTANE.json    Şehir Hastanesi
    config/slots/MERKEZ-B1.json  Merkez Katlı Otopark, B1 katı (her kat ayrı kamera)
    ...

Dosyalar `tools/kroki_to_slots.py` ile backend'deki krokiden üretilir (üstten görünüş) ya da gerçek
kamera görüntüsü üzerinde `tools/slot_editor.py --out config/slots/<KİMLİK>.json` ile çizilir.
Dosyada lotCode yoksa dosya adının ilk parçası (MERKEZ-B1 -> MERKEZ) otopark kodu sayılır.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from app.pipeline.occupancy import SlotLayout, load_layout

log = logging.getLogger(__name__)

DEFAULT_LOT = "GAZI"


class LayoutNotFound(LookupError):
    pass


@dataclass
class LayoutEntry:
    id: str
    path: Path
    layout: SlotLayout

    @property
    def lot_code(self) -> str:
        return (self.layout.lot_code or DEFAULT_LOT).upper()

    @property
    def floor(self) -> int:
        return self.layout.floor if self.layout.floor is not None else 0

    def summary(self) -> dict:
        return {
            "id": self.id,
            "lotCode": self.lot_code,
            "floor": self.floor,
            "name": self.layout.name or self.id,
            "slotCount": len(self.layout.slots),
            "imageWidth": self.layout.image_width,
            "imageHeight": self.layout.image_height,
            "file": self.path.name,
        }


def _lot_from_id(layout_id: str) -> str:
    return layout_id.replace("_", "-").split("-")[0].upper() or DEFAULT_LOT


class LayoutRegistry:
    """Yerleşim dosyalarını okur; dosyalar değişirse (mtime) bir sonraki çağrıda yeniden yükler."""

    def __init__(self, default_file: Path, layouts_dir: Path):
        self.default_file = Path(default_file)
        self.layouts_dir = Path(layouts_dir)
        self._lock = threading.Lock()
        self._stamp: Optional[tuple] = None
        self._entries: Dict[str, LayoutEntry] = {}

    # ------------------------------------------------------------------
    def _files(self) -> List[Path]:
        files = []
        if self.default_file.exists():
            files.append(self.default_file)
        if self.layouts_dir.is_dir():
            files.extend(sorted(p for p in self.layouts_dir.glob("*.json") if p.is_file()))
        return files

    def _reload_if_needed(self) -> None:
        files = self._files()
        stamp = tuple((str(p), p.stat().st_mtime_ns) for p in files)
        if stamp == self._stamp:
            return
        entries: Dict[str, LayoutEntry] = {}
        for path in files:
            try:
                layout = load_layout(path)
            except Exception as exc:  # bozuk bir dosya diğerlerini engellemesin
                log.error("Cep yerleşimi okunamadı (%s): %s", path.name, exc)
                continue
            is_default = path == self.default_file
            layout_id = (layout.layout_id or (DEFAULT_LOT if is_default else path.stem)).upper()
            if not layout.lot_code:
                layout.lot_code = DEFAULT_LOT if is_default else _lot_from_id(layout_id)
            layout.layout_id = layout_id
            if layout_id in entries:
                log.warning("Yinelenen yerleşim kimliği %s (%s) atlandı", layout_id, path.name)
                continue
            entries[layout_id] = LayoutEntry(layout_id, path, layout)
        self._entries = entries
        self._stamp = stamp

    def entries(self) -> List[LayoutEntry]:
        with self._lock:
            self._reload_if_needed()
            return sorted(self._entries.values(), key=lambda e: (e.lot_code != DEFAULT_LOT, e.lot_code, e.floor, e.id))

    def list(self) -> List[dict]:
        return [e.summary() for e in self.entries()]

    def get(self, layout_id: str) -> LayoutEntry:
        key = (layout_id or "").strip().upper()
        for e in self.entries():
            if e.id == key:
                return e
        raise LayoutNotFound(f"Cep yerleşimi bulunamadı: {layout_id}")

    def for_lot(self, lot_code: str) -> List[LayoutEntry]:
        lot = (lot_code or "").strip().upper()
        return [e for e in self.entries() if e.lot_code == lot]

    def resolve(self, layout_id: Optional[str] = None, lot_code: Optional[str] = None) -> LayoutEntry:
        """Kimlik verilmişse o yerleşim (otopark verilmişse uyumlu olmalı); yalnızca otopark verilmişse
        o otoparkın ilk (en alt kat) yerleşimi; hiçbiri yoksa varsayılan (GAZI)."""
        if layout_id:
            entry = self.get(layout_id)
            if lot_code and entry.lot_code != lot_code.strip().upper():
                raise ValueError(f"{entry.id} yerleşimi {entry.lot_code} otoparkına ait, {lot_code.upper()} değil")
            return entry
        if lot_code:
            found = self.for_lot(lot_code)
            if not found:
                raise LayoutNotFound(f"{lot_code.upper()} otoparkı için cep yerleşimi yok "
                                     f"(tools/kroki_to_slots.py ile üretebilirsiniz)")
            return found[0]
        found = self.for_lot(DEFAULT_LOT) or self.entries()
        if not found:
            raise LayoutNotFound("Hiç cep yerleşimi tanımlı değil (config/slots.json)")
        return found[0]
