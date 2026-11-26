"""Kamera ve makine öğrenmesi OLMADAN canlı demo simülatörü.

Backend'e görüntü servisinin yapacağı istekleri birebir gönderir:
  * rastgele geçerli TR plakalarla giriş/çıkış olayları   (POST /api/vision/plate-events)
  * araç giriş/çıkışıyla tutarlı cep doluluk değişimleri   (POST /api/vision/occupancy)
  * 10 sn'de bir sahte ajan heartbeat'i                    (POST /api/vision/heartbeat)
  * tüm otoparklar (GET /api/parking/lots) ve engelli cepler; ara sıra engelli cep ihlali
  * isteğe bağlı: çıkıştan önce ödeme (GET /api/payments/quote, POST /api/payments/pay)

Yalnızca Python standart kütüphanesi kullanılır; numpy/opencv bile gerekmez.

Örnek:
    python tools/simulator.py
    python tools/simulator.py --backend http://localhost:5080 --interval 3 --low-confidence-rate 0.15
    python tools/simulator.py --count 20 --seed 42
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.tr_plate import PLATE_LETTERS, VALID_GROUPS, format_display, is_valid  # noqa: E402

ZONES = {"A": [f"A{i:02d}" for i in range(1, 11)],
         "B": [f"B{i:02d}" for i in range(1, 11)],
         "C": [f"C{i:02d}" for i in range(1, 9)]}
ALL_SLOTS = [c for codes in ZONES.values() for c in codes]
# Sık görülen il kodları biraz daha olası olsun (gerçekçi görünüm)
COMMON_CITIES = ["06", "06", "06", "34", "34", "35", "01", "07", "16", "42", "71", "18", "14"]
SEED_DRIVER_PLATE = "06ABC123"   # seed sürücüsünün aracı (sözleşme bölüm 2)
PERMIT_PLATE = "06ENG061"        # seed: onaylı engelli izni olan araç (sözleşme 11)
TEST_CARD = {"holderName": "Demo Surucu", "number": "5528790000000008", "expireMonth": "12",
             "expireYear": "2030", "cvc": "123"}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def random_plate(rng: random.Random) -> str:
    city = rng.choice(COMMON_CITIES) if rng.random() < 0.6 else f"{rng.randint(1, 81):02d}"
    n_letters, n_digits = rng.choice(VALID_GROUPS)
    letters = "".join(rng.choice(PLATE_LETTERS) for _ in range(n_letters))
    digits = "".join(rng.choice("0123456789") for _ in range(n_digits))
    if digits[0] == "0":
        digits = str(rng.randint(1, 9)) + digits[1:]
    plate = city + letters + digits
    assert is_valid(plate), plate
    return plate


def garble(plate: str, rng: random.Random) -> str:
    """Düşük kaliteli okuma taklidi: bir karakteri bozar ya da siler."""
    swaps = {"0": "O", "1": "I", "8": "B", "5": "S", "2": "Z", "6": "G", "B": "8", "O": "0"}
    chars = list(plate)
    i = rng.randrange(len(chars))
    if chars[i] in swaps and rng.random() < 0.6:
        chars[i] = swaps[chars[i]]
    elif rng.random() < 0.5:
        del chars[i]
    else:
        chars[i] = rng.choice("QWX")
    return "".join(chars)


class Http:
    def __init__(self, base: str, api_key: str, timeout: float = 5.0):
        self.base = base.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def request(self, method: str, path: str, body: Optional[dict] = None, auth: bool = True) -> Tuple[int, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("X-Api-Key", self.api_key)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except ValueError:
                return e.code, raw.decode("utf-8", "replace")[:200]
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            return 0, str(getattr(e, "reason", e))


class LotState:
    """Bir otoparkın simülasyon durumu (cepler, türleri, dolu/boş, içerideki araçlar)."""

    def __init__(self, code: str, zones: Dict[str, List[str]], disabled: Optional[set] = None):
        self.code = code
        self.zones = zones
        self.all_slots = [c for codes in zones.values() for c in codes]
        self.disabled = set(disabled or ())
        self.state: Dict[str, bool] = {c: False for c in self.all_slots}
        self.inside: Dict[str, Optional[str]] = {}  # plaka -> kapladığı cep

    def free(self, zone: Optional[str], disabled_ok: bool, only_disabled: bool = False) -> List[str]:
        def ok(c: str) -> bool:
            if self.state[c]:
                return False
            if only_disabled:
                return c in self.disabled
            return disabled_ok or c not in self.disabled
        in_zone = [c for c in self.zones.get(zone or "", []) if ok(c)]
        return in_zone or [c for c in self.all_slots if ok(c)]


class Simulator:
    def __init__(self, args):
        self.args = args
        self.rng = random.Random(args.seed)
        self.http = Http(args.backend, args.api_key)
        self.lots: Dict[str, LotState] = {}
        self.last_heartbeat = 0.0
        self.stats = {"Allowed": 0, "Denied": 0, "PendingReview": 0, "hata": 0, "ihlal": 0}

    # ------------------------------------------------------------------
    def log(self, msg: str) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

    def load_lots(self) -> None:
        """Otoparkları ve cepleri backend'den okur (sözleşme 11.3); olmazsa yalnızca GAZI ile çalışır."""
        wanted = [c.strip().upper() for c in (self.args.lots or "").split(",") if c.strip()]
        status, lots = self.http.request("GET", "/api/parking/lots", auth=False)
        codes = [l.get("code") for l in lots] if status == 200 and isinstance(lots, list) else []
        if wanted:
            codes = [c for c in codes if c in wanted] or wanted
        for code in codes:
            st, layout = self.http.request("GET", f"/api/parking/lots/{code}/layout", auth=False)
            if st != 200 or not isinstance(layout, dict):
                continue
            zones: Dict[str, List[str]] = {}
            disabled = set()
            for sl in layout.get("slots", []):
                if sl.get("isActive") is False:
                    continue
                zones.setdefault(sl.get("zoneCode") or "?", []).append(sl["code"])
                if sl.get("type") == "Disabled":
                    disabled.add(sl["code"])
            if zones:
                self.lots[code] = LotState(code, zones, disabled)
        if not self.lots:
            self.log("Otopark listesi alınamadı; yalnızca GAZI (A/B/C) kullanılacak.")
            self.lots["GAZI"] = LotState("GAZI", ZONES, {"A01", "A02"})
        desc = ", ".join(f"{c} ({len(l.all_slots)} cep, {len(l.disabled)} engelli)" for c, l in self.lots.items())
        self.log(f"Otoparklar: {desc}")

    def pick_lot(self) -> LotState:
        lots = list(self.lots.values())
        return self.rng.choices(lots, weights=[len(l.all_slots) for l in lots])[0]

    def send_plate(self, lot: LotState, gate: str, plate: str, low: bool) -> Optional[dict]:
        camera = f"{lot.code.lower()}-{'giris' if gate == 'Entry' else 'cikis'}"
        sent_plate, valid, conf = plate, True, round(self.rng.uniform(0.82, 0.98), 2)
        if low:
            if self.rng.random() < 0.5:
                sent_plate = garble(plate, self.rng)
                valid = is_valid(sent_plate)
            conf = round(self.rng.uniform(0.35, 0.65), 2)
        body = {"cameraId": camera, "lotCode": lot.code, "gate": gate, "plate": sent_plate, "confidence": conf,
                "formatValid": valid, "timestamp": now_iso()}
        status, resp = self.http.request("POST", "/api/vision/plate-events", body)
        label = "GİRİŞ" if gate == "Entry" else "ÇIKIŞ"
        if status == 200 and isinstance(resp, dict):
            decision = resp.get("decision", "?")
            self.stats[decision] = self.stats.get(decision, 0) + 1
            icon = " ♿" if resp.get("isDisabledPermit") else ""
            self.log(f"{lot.code:<8}{label:5} {format_display(sent_plate):<12}{icon} güven={conf:.2f} -> "
                     f"{decision}: {resp.get('message', '')}")
            return resp
        self.stats["hata"] += 1
        self.log(f"{lot.code:<8}{label:5} {sent_plate} gönderilemedi (HTTP {status}): {resp}")
        return None

    def send_slots(self, lot: LotState, codes: List[str]) -> None:
        if not codes or self.args.no_occupancy:
            return
        slots = [{"code": c, "occupied": lot.state[c], "confidence": round(self.rng.uniform(0.85, 0.99), 2)}
                 for c in codes]
        status, resp = self.http.request("POST", "/api/vision/occupancy",
                                         {"cameraId": f"{lot.code.lower()}-doluluk", "lotCode": lot.code,
                                          "timestamp": now_iso(), "slots": slots})
        if status in (200, 204):
            desc = ", ".join(f"{s['code']}={'dolu' if s['occupied'] else 'boş'}" for s in slots[:6])
            more = f" (+{len(slots) - 6})" if len(slots) > 6 else ""
            self.log(f"{lot.code:<8}DOLULUK {desc}{more}")
        else:
            self.log(f"{lot.code:<8}DOLULUK gönderilemedi (HTTP {status}): {resp}")

    def heartbeat(self, force: bool = False) -> None:
        if not force and time.monotonic() - self.last_heartbeat < 10:
            return
        self.last_heartbeat = time.monotonic()
        agents = []
        for code in self.lots:
            low = code.lower()
            agents += [
                {"id": f"{low}-giris", "type": "Gate", "lotCode": code, "status": "Running",
                 "fps": round(self.rng.uniform(8, 15), 1), "lastError": None},
                {"id": f"{low}-cikis", "type": "Gate", "lotCode": code, "status": "Running",
                 "fps": round(self.rng.uniform(8, 15), 1), "lastError": None},
                {"id": f"{low}-doluluk", "type": "Occupancy", "lotCode": code, "status": "Running",
                 "fps": 1.0, "lastError": None},
            ]
        status, resp = self.http.request("POST", "/api/vision/heartbeat", {"agents": agents})
        if status not in (200, 204):
            self.log(f"Heartbeat gönderilemedi (HTTP {status}): {resp}")

    # ------------------------------------------------------------------
    def occupy(self, lot: LotState, zone: Optional[str], permit: bool, preferred: Optional[str] = None) -> Optional[str]:
        if preferred and preferred in lot.state and not lot.state[preferred] and (permit or preferred not in lot.disabled):
            code = preferred
        else:
            free = (lot.free(zone, True, only_disabled=True) if permit else []) or lot.free(zone, permit)
            if not free:
                return None
            code = self.rng.choice(free)
        lot.state[code] = True
        return code

    def all_inside(self) -> Dict[str, LotState]:
        return {p: l for l in self.lots.values() for p in l.inside}

    def do_entry(self) -> None:
        lot = self.pick_lot()
        low = self.rng.random() < self.args.low_confidence_rate
        inside = self.all_inside()
        r = self.rng.random()
        if PERMIT_PLATE not in inside and r < 0.10:
            plate = PERMIT_PLATE           # seed: onaylı engelli izni olan araç
        elif SEED_DRIVER_PLATE not in inside and r < 0.16:
            plate = SEED_DRIVER_PLATE
        else:
            plate = random_plate(self.rng)
        resp = self.send_plate(lot, "Entry", plate, low)
        if resp and resp.get("decision") == "Allowed":
            permit = bool(resp.get("isDisabledPermit"))
            slot = self.occupy(lot, resp.get("suggestedZone"), permit, resp.get("suggestedSlot"))
            lot.inside[plate] = slot
            if slot:
                self.send_slots(lot, [slot])

    def do_exit(self) -> None:
        inside = self.all_inside()
        if not inside:
            return self.do_entry()
        plate = self.rng.choice(list(inside))
        lot = inside[plate]
        if self.rng.random() < self.args.pay_rate:
            self.pay(plate)
        low = self.rng.random() < self.args.low_confidence_rate
        resp = self.send_plate(lot, "Exit", plate, low)
        if resp and resp.get("decision") == "Allowed":
            slot = lot.inside.pop(plate, None)
            if slot:
                lot.state[slot] = False
                self.send_slots(lot, [slot])

    def pay(self, plate: str) -> None:
        status, quote = self.http.request("GET", f"/api/payments/quote/{plate}", auth=False)
        if status != 200 or not isinstance(quote, dict):
            return
        if quote.get("isPaid") or not quote.get("amount"):
            return
        status, resp = self.http.request("POST", "/api/payments/pay",
                                         {"sessionId": quote.get("sessionId"), "reservationId": None, "card": TEST_CARD},
                                         auth=False)
        if status == 200 and isinstance(resp, dict):
            self.log(f"ÖDEME   {format_display(plate):<12} {resp.get('amount')} TL -> {resp.get('status')}")

    def noise(self) -> None:
        """Plakası okunmamış araçların park etmesi/çıkması (yalnızca doluluk).
        Ara sıra izinsiz bir araç engelli cebe park eder -> backend ihlal açar (sözleşme 11.2/5)."""
        lot = self.pick_lot()
        occupied_by_known = set(lot.inside.values())
        if lot.disabled and self.rng.random() < self.args.violation_rate:
            free_dis = [c for c in lot.disabled if not lot.state[c]]
            if free_dis:
                code = self.rng.choice(free_dis)
                lot.state[code] = True
                self.stats["ihlal"] += 1
                self.log(f"{lot.code:<8}İHLAL DENEMESİ: izinsiz araç engelli cebe park etti ({code})")
                self.send_slots(lot, [code])
                return
        code = self.rng.choice(lot.all_slots)
        if code in occupied_by_known:
            return
        if code in lot.disabled and not lot.state[code]:
            return  # izinsiz rastgele dolumu yalnızca ihlal senaryosu yapar
        lot.state[code] = not lot.state[code]
        self.send_slots(lot, [code])

    # ------------------------------------------------------------------
    def run(self) -> None:
        a = self.args
        self.log(f"Simülatör başladı -> {a.backend} (aralık {a.interval} sn, düşük güven oranı {a.low_confidence_rate})")
        status, _ = self.http.request("GET", "/api/parking/summary", auth=False)
        if status == 0:
            self.log("UYARI: backend'e ulaşılamıyor; yine de denenmeye devam edilecek (Ctrl+C ile çıkın).")
        self.load_lots()
        self.heartbeat(force=True)
        if not a.no_occupancy:
            # Başlangıçta tüm cepleri gönder (rastgele başlangıç doluluğu; engelli cepler boş başlar)
            for lot in self.lots.values():
                for c in lot.all_slots:
                    lot.state[c] = c not in lot.disabled and self.rng.random() < a.initial_occupancy
                self.send_slots(lot, lot.all_slots)
        total_slots = sum(len(l.all_slots) for l in self.lots.values())
        n = 0
        try:
            while a.count <= 0 or n < a.count:
                n += 1
                r = self.rng.random()
                occupancy_ratio = len(self.all_inside()) / max(1, total_slots)
                exit_p = a.exit_rate + 0.3 * occupancy_ratio
                if r < exit_p and self.all_inside():
                    self.do_exit()
                elif r < 0.9:
                    self.do_entry()
                else:
                    self.noise()
                self.heartbeat()
                time.sleep(max(0.05, self.rng.uniform(0.6, 1.4) * a.interval))
        except KeyboardInterrupt:
            pass
        self.log(f"Bitti. Özet: {self.stats} — içeride {len(self.all_inside())} araç")


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Akıllı Otopark demo simülatörü (kamera/ML gerektirmez)")
    ap.add_argument("--backend", default="http://localhost:5080", help="Backend adresi (vars. http://localhost:5080)")
    ap.add_argument("--api-key", default="dev-vision-key", help="X-Api-Key değeri (vars. dev-vision-key)")
    ap.add_argument("--interval", type=float, default=4.0, help="Olaylar arası ortalama süre, sn (vars. 4)")
    ap.add_argument("--low-confidence-rate", type=float, default=0.1,
                    help="Düşük güvenli/bozuk okuma oranı -> PendingReview (vars. 0.1)")
    ap.add_argument("--exit-rate", type=float, default=0.3, help="Temel çıkış olasılığı (vars. 0.3)")
    ap.add_argument("--pay-rate", type=float, default=0.7, help="Çıkıştan önce ödeme yapma olasılığı (vars. 0.7)")
    ap.add_argument("--initial-occupancy", type=float, default=0.25, help="Başlangıçta dolu cep oranı (vars. 0.25)")
    ap.add_argument("--no-occupancy", action="store_true", help="Doluluk olaylarını gönderme")
    ap.add_argument("--lots", default="", help="Yalnızca bu otoparklar, virgülle (ör. GAZI,AVM). Boş = hepsi")
    ap.add_argument("--violation-rate", type=float, default=0.15,
                    help="Doluluk olaylarında izinsiz aracın engelli cebe park etme olasılığı (vars. 0.15)")
    ap.add_argument("--count", type=int, default=0, help="Gönderilecek olay sayısı (0 = sonsuz)")
    ap.add_argument("--seed", type=int, default=None, help="Tekrarlanabilir demo için rastgelelik tohumu")
    return ap.parse_args(argv)


if __name__ == "__main__":
    Simulator(parse_args()).run()
