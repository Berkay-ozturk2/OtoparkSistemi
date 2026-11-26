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
    python tools/simulator.py --scenario full-demo            # adım adım, doğrulamalı uçtan uca senaryo
    python tools/simulator.py --scenario full-demo --lot HASTANE --step-delay 0
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

    def request(self, method: str, path: str, body: Optional[dict] = None, auth: bool = True,
                token: Optional[str] = None) -> Tuple[int, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("X-Api-Key", self.api_key)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
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


class FullDemoScenario:
    """Uçtan uca, DOĞRULAMALI demo senaryosu (--scenario full-demo).

    Görüntü servisinin yapacağı istekleri (plaka olayı, doluluk) gönderir; her adımın sonucunu backend'in
    operatör/herkese açık uç noktalarından KONTROL eder ve [OK]/[HATA] yazar. Böylece hem sunumda canlı
    gösterim hem de "kamera -> backend -> harita" zincirinin uçtan uca testi olarak kullanılır.
    Senaryo otoparkın ayarlarını geçici değiştirir (ücretsiz süre 0) ve bitince eski hâline döndürür.
    """

    def __init__(self, args):
        self.a = args
        self.http = Http(args.backend, args.api_key)
        self.lot = args.lot.upper()
        self.rng = random.Random(args.seed)
        self.ok = 0
        self.fail = 0
        self.op_token: Optional[str] = None
        self.admin_token: Optional[str] = None
        self.saved_settings: Optional[dict] = None
        self.parked: Dict[str, str] = {}   # plaka -> cep
        self.extra_slots: List[str] = []   # plakasız doldurulan cepler (ihlal senaryosu)

    # --- yardımcılar -------------------------------------------------------
    def log(self, msg: str) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

    def step(self, n: int, title: str) -> None:
        print(flush=True)
        self.log(f"===== ADIM {n}: {title} =====")
        if self.a.step_delay > 0:
            time.sleep(self.a.step_delay)

    def check(self, cond: bool, what: str, detail: Any = "") -> bool:
        if cond:
            self.ok += 1
            self.log(f"  [OK]   {what}")
        else:
            self.fail += 1
            self.log(f"  [HATA] {what}  ->  {detail}")
        return cond

    def login(self, email: str, password: str) -> Optional[str]:
        st, body = self.http.request("POST", "/api/auth/login", {"email": email, "password": password}, auth=False)
        return body.get("token") if st == 200 and isinstance(body, dict) else None

    def plate_event(self, gate: str, plate: str, conf: float = 0.93, valid: bool = True) -> dict:
        body = {"cameraId": f"senaryo-{'giris' if gate == 'Entry' else 'cikis'}", "lotCode": self.lot,
                "gate": gate, "plate": plate, "confidence": conf, "formatValid": valid, "timestamp": now_iso()}
        st, resp = self.http.request("POST", "/api/vision/plate-events", body)
        resp = resp if isinstance(resp, dict) else {"message": resp}
        resp["_status"] = st
        label = "GİRİŞ" if gate == "Entry" else "ÇIKIŞ"
        self.log(f"  {label} {format_display(plate):<12} güven={conf:.2f} -> {resp.get('decision')}: {resp.get('message')}")
        return resp

    def occupancy(self, changes: Dict[str, bool]) -> int:
        slots = [{"code": c, "occupied": o, "confidence": 0.95} for c, o in changes.items()]
        st, _ = self.http.request("POST", "/api/vision/occupancy", {"cameraId": "senaryo-doluluk", "lotCode": self.lot,
                                                                   "timestamp": now_iso(), "slots": slots})
        self.log("  DOLULUK " + ", ".join(f"{c}={'dolu' if o else 'boş'}" for c, o in changes.items()) + f" (HTTP {st})")
        return st

    def slots(self) -> Dict[str, dict]:
        st, body = self.http.request("GET", f"/api/parking/slots?lot={self.lot}", auth=False)
        return {s["code"]: s for s in body} if st == 200 and isinstance(body, list) else {}

    def active_plates(self) -> Dict[str, dict]:
        st, body = self.http.request("GET", f"/api/operator/sessions/active?lot={self.lot}", auth=False,
                                     token=self.op_token)
        return {s["plate"]: s for s in body} if st == 200 and isinstance(body, list) else {}

    def open_violations(self) -> List[dict]:
        st, body = self.http.request("GET", f"/api/operator/violations?lot={self.lot}&status=Open", auth=False,
                                     token=self.op_token)
        return body if st == 200 and isinstance(body, list) else []

    def new_plate(self) -> str:
        while True:
            p = f"{self.rng.choice(['06', '34', '35', '16'])}DMO{self.rng.randint(100, 999)}"
            if is_valid(p):
                return p

    def free_slot(self, slots: Dict[str, dict], prefer: Optional[str], slot_type: str = "Standard") -> Optional[str]:
        if prefer and prefer in slots and not slots[prefer]["isOccupied"]:
            return prefer
        for code, sl in slots.items():
            if sl.get("type", "Standard") == slot_type and not sl["isOccupied"] and sl.get("isActive", True) \
                    and not sl.get("isReserved"):
                return code
        return None

    def enter_and_park(self, plate: str, conf: float = 0.93) -> Optional[dict]:
        r = self.plate_event("Entry", plate, conf)
        if r.get("decision") != "Allowed":
            return r
        slot = self.free_slot(self.slots(), r.get("suggestedSlot"), r.get("slotType") or "Standard")
        if slot:
            self.occupancy({slot: True})
            self.parked[plate] = slot
        return r

    def leave(self, plate: str) -> None:
        slot = self.parked.pop(plate, None)
        if slot:
            self.occupancy({slot: False})

    # --- senaryo -----------------------------------------------------------
    def run(self) -> int:
        a = self.a
        self.log(f"UÇTAN UCA DEMO SENARYOSU -> {a.backend} (otopark {self.lot})")
        self.log("İpucu: tarayıcıda Operatör > Canlı İzleme'yi açıp otopark olarak "
                 f"{self.lot} seçin; adımlar canlı görünecek.")
        try:
            self._run_steps()
        except KeyboardInterrupt:
            self.log("Kullanıcı durdurdu.")
        finally:
            self._cleanup()
        print(flush=True)
        total = self.ok + self.fail
        if self.fail == 0:
            self.log(f"SONUÇ: TÜM KONTROLLER BAŞARILI ({self.ok}/{total})")
            return 0
        self.log(f"SONUÇ: {self.fail} KONTROL BAŞARISIZ ({self.ok}/{total} başarılı) — yukarıdaki [HATA] satırlarına bakın")
        return 1

    def _run_steps(self) -> None:
        a = self.a
        # 0) Hazırlık
        self.step(0, "Hazırlık: backend, giriş, ayarlar")
        st, summary = self.http.request("GET", f"/api/parking/summary?lot={self.lot}", auth=False)
        if not self.check(st == 200, f"backend'e ulaşıldı ve {self.lot} otoparkı var", f"HTTP {st}: {summary}"):
            raise KeyboardInterrupt
        self.op_token = self.login(a.operator_email, a.operator_password)
        self.check(bool(self.op_token), "operatör girişi")
        self.admin_token = self.login(a.admin_email, a.admin_password)
        self.check(bool(self.admin_token), "yönetici girişi (ücretsiz süreyi geçici kapatmak için)")
        st, agents = self.http.request("GET", f"/api/operator/agents?lot={self.lot}", auth=False, token=self.op_token)
        busy = [x.get("id") for x in (agents or []) if isinstance(x, dict) and x.get("type") == "Occupancy"
                and x.get("status") == "Running" and x.get("isOnline", True) and not str(x.get("id", "")).startswith("senaryo")]
        if busy:
            self.log(f"  UYARI: {self.lot} otoparkında çalışan doluluk kamerası var ({', '.join(busy)}); cepleri "
                     f"değiştirip kontrolleri bozabilir. Gerekirse --lot HASTANE ile çalıştırın.")
        if self.admin_token:
            st, cur = self.http.request("GET", "/api/admin/settings", auth=False, token=self.admin_token)
            if st == 200 and isinstance(cur, dict):
                self.saved_settings = {"freeMinutes": cur.get("freeMinutes"), "gracePeriodMinutes": cur.get("gracePeriodMinutes")}
                st, _ = self.http.request("PUT", "/api/admin/settings", {"freeMinutes": 0}, auth=False, token=self.admin_token)
                self.check(st == 200, "ücretsiz süre demo için geçici olarak 0 dk yapıldı (sonunda geri alınır)")

        p1, p2, p3 = self.new_plate(), self.new_plate(), self.new_plate()
        while len({p1, p2, p3}) < 3:
            p3 = self.new_plate()

        # 1) Plakayla giriş
        self.step(1, f"Plakayla giriş: {format_display(p1)} (bariyer açılır, aktif araç kaydı)")
        r = self.enter_and_park(p1)
        self.check(r and r.get("decision") == "Allowed", "giriş onaylandı (bariyer AÇIK)", r)
        self.check(p1 in self.active_plates(), "aktif araçlar listesinde")
        self.check(bool(r and r.get("suggestedSlot")), f"önerilen cep: {r.get('suggestedSlot') if r else '-'}")

        # 2) Doluluk -> harita
        self.step(2, "Doluluk kamerası: araç cebe park etti -> harita güncellenir")
        slot1 = self.parked.get(p1)
        sl = self.slots().get(slot1 or "", {})
        self.check(bool(slot1) and sl.get("isOccupied") is True, f"{slot1} haritada DOLU", sl)

        # 3) İkinci araç
        self.step(3, f"İkinci araç: {format_display(p2)}")
        r = self.enter_and_park(p2)
        self.check(r and r.get("decision") == "Allowed", "giriş onaylandı", r)

        # 4) Düşük güvenli okuma -> onay kuyruğu -> operatör düzeltir
        self.step(4, f"Düşük güvenli okuma: {format_display(p3)} kamera tarafından hatalı okunur")
        bad = garble(p3, self.rng)
        r = self.plate_event("Entry", bad, conf=0.45, valid=is_valid(bad))
        self.check(r.get("decision") == "PendingReview", "okuma operatör onay kuyruğuna düştü", r)
        st, queue = self.http.request("GET", f"/api/operator/review-queue?lot={self.lot}", auth=False, token=self.op_token)
        item = next((q for q in (queue or []) if isinstance(q, dict) and q.get("plateRead") == bad), None) \
            or next((q for q in (queue or []) if isinstance(q, dict)), None)
        self.check(item is not None, "onay kuyruğunda görünüyor", queue)
        if item:
            st, res = self.http.request("POST", f"/api/operator/review-queue/{item['id']}/resolve",
                                        {"correctedPlate": p3, "approve": True}, auth=False, token=self.op_token)
            self.log(f"  OPERATÖR plakayı {format_display(p3)} olarak düzeltip onayladı -> "
                     f"{(res or {}).get('decision') if isinstance(res, dict) else res}")
            ok = st == 200 and isinstance(res, dict) and res.get("decision") == "Allowed"
            self.check(ok, "düzeltilen plaka ile giriş onaylandı", res)
            if ok:
                slot = self.free_slot(self.slots(), res.get("suggestedSlot"))
                if slot:
                    self.occupancy({slot: True})
                    self.parked[p3] = slot

        # 5) Ödemesiz çıkış reddi
        self.step(5, f"Ödeme yapmadan çıkış denemesi: {format_display(p1)}")
        time.sleep(1.5)
        r = self.plate_event("Exit", p1)
        self.check(r.get("decision") == "Denied" and float(r.get("fee") or 0) > 0,
                   f"çıkış REDDEDİLDİ, ücret {r.get('fee')} TL (bariyer KAPALI)", r)

        # 6) Kartla ödeme + çıkış
        self.step(6, f"Kartla ödeme (sanal POS test kartı) ve çıkış: {format_display(p1)}")
        st, quote = self.http.request("GET", f"/api/payments/quote/{p1}", auth=False)
        self.check(st == 200 and float((quote or {}).get("amount") or 0) > 0, f"ücret sorgulandı: {(quote or {}).get('amount')} TL", quote)
        if st == 200 and isinstance(quote, dict):
            st, pay = self.http.request("POST", "/api/payments/pay",
                                        {"sessionId": quote.get("sessionId"), "reservationId": None, "card": TEST_CARD},
                                        auth=False)
            self.check(st == 200 and (pay or {}).get("status") == "Success", f"ödeme başarılı ({(pay or {}).get('amount')} TL)", pay)
        r = self.plate_event("Exit", p1)
        self.check(r.get("decision") == "Allowed", "ödeme sonrası çıkış onaylandı (bariyer AÇIK)", r)
        self.leave(p1)
        self.check(p1 not in self.active_plates(), "araç aktif listeden düştü")
        self.check(self.slots().get(slot1 or "", {}).get("isOccupied") is False, f"{slot1} haritada tekrar BOŞ")

        # 7) Gişede nakit ödeme + çıkış
        self.step(7, f"Gişede nakit ödeme ve çıkış: {format_display(p2)}")
        sess = self.active_plates().get(p2)
        if self.check(sess is not None, "aktif oturum bulundu"):
            st, cash = self.http.request("POST", f"/api/operator/sessions/{sess['id']}/cash-payment", {}, auth=False,
                                         token=self.op_token)
            self.check(st == 200 and (cash or {}).get("status") == "Success", f"nakit ödeme alındı ({(cash or {}).get('amount')} TL)", cash)
        r = self.plate_event("Exit", p2)
        self.check(r.get("decision") == "Allowed", "çıkış onaylandı", r)
        self.leave(p2)

        # 8) Engelli izinli araç
        permit = a.permit_plate
        self.step(8, f"Engelli izinli araç: {format_display(permit)} -> engelli cebe yönlendirilir")
        if permit in self.active_plates():
            self.log("  (araç zaten içeride; bu adım atlandı)")
        else:
            r = self.enter_and_park(permit)
            self.check(r and r.get("decision") == "Allowed" and r.get("isDisabledPermit") is True,
                       "izinli araç girişi (♿)", r)
            self.check(bool(r) and r.get("slotType") == "Disabled", f"engelli cep önerildi: {r.get('suggestedSlot') if r else '-'}")
            self.check(not any(v.get("slotCode") == self.parked.get(permit) for v in self.open_violations()),
                       "izinli araç engelli cebe park etti -> ihlal YOK")

        # 9) İhlal: izinsiz araç engelli cebe park eder
        self.step(9, "İhlal: plakası okunmayan izinsiz bir araç engelli cebe park eder")
        slots = self.slots()
        target = self.free_slot(slots, None, "Disabled")
        if not target:
            self.log("  (boş engelli cep yok; ihlal adımı atlandı)")
        else:
            self.occupancy({target: True})
            self.extra_slots.append(target)
            time.sleep(0.5)
            v = next((x for x in self.open_violations() if x.get("slotCode") == target), None)
            self.check(v is not None, f"{target} için İHLAL açıldı (operatör ekranında uyarı)", self.open_violations())
            self.step(10, "İzinsiz araç ayrılır -> ihlal kendiliğinden kapanır")
            self.occupancy({target: False})
            self.extra_slots.remove(target)
            time.sleep(0.5)
            self.check(not any(x.get("slotCode") == target for x in self.open_violations()), f"{target} ihlali kapandı")

    def _cleanup(self) -> None:
        self.log("Temizlik: senaryo araçları çıkarılıyor, ayarlar geri alınıyor...")
        for slot in list(self.extra_slots):
            self.occupancy({slot: False})
        active = self.active_plates() if self.op_token else {}
        for plate in list(self.parked):
            sess = active.get(plate)
            if sess and self.op_token:
                self.http.request("POST", f"/api/operator/sessions/{sess['id']}/cash-payment", {}, auth=False,
                                  token=self.op_token)
                self.http.request("POST", "/api/operator/manual-exit", {"plate": plate, "lotCode": self.lot},
                                  auth=False, token=self.op_token)
            self.leave(plate)
        if self.saved_settings and self.admin_token:
            body = {k: v for k, v in self.saved_settings.items() if v is not None}
            st, _ = self.http.request("PUT", "/api/admin/settings", body, auth=False, token=self.admin_token)
            self.log(f"  ayarlar geri alındı: {body} (HTTP {st})")


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
    ap.add_argument("--scenario", choices=["random", "full-demo"], default="random",
                    help="random: sürekli rastgele trafik (vars.) | full-demo: adım adım, doğrulamalı uçtan uca senaryo")
    ap.add_argument("--lot", default="GAZI", help="full-demo için otopark kodu (vars. GAZI)")
    ap.add_argument("--step-delay", type=float, default=2.0, help="full-demo adımları arası bekleme, sn (vars. 2)")
    ap.add_argument("--permit-plate", default=PERMIT_PLATE, help="Engelli izinli plaka (seed: 06ENG061)")
    ap.add_argument("--operator-email", default="operator@otopark.local")
    ap.add_argument("--operator-password", default="Operator123!")
    ap.add_argument("--admin-email", default="admin@otopark.local")
    ap.add_argument("--admin-password", default="Admin123!")
    return ap.parse_args(argv)


if __name__ == "__main__":
    _args = parse_args()
    if _args.scenario == "full-demo":
        sys.exit(FullDemoScenario(_args).run())
    Simulator(_args).run()
