"""Çoklu kroki (otopark / kat başına cep yerleşimi) testleri: kayıt, krokiden üretim, örnek görüntü,
renk dedektörüyle doğruluk, doluluk ajanının kroki değiştirmesi ve API uçları."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import cv2

from app.agents.manager import AgentManager
from app.agents.occupancy_agent import OccupancyAgent
from app.config import BASE_DIR, Settings
from app.pipeline.demo_detector import ColorVehicleDetector
from app.pipeline.layouts import LayoutNotFound, LayoutRegistry
from app.pipeline.occupancy import evaluate_slots
from app.pipeline.sample_scene import ascii_text, render_sample

SLOTS = BASE_DIR / "config" / "slots.json"
SLOTS_DIR = BASE_DIR / "config" / "slots"
EXPECTED = {  # DbSeeder ile aynı cep sayıları (sözleşme 11.6)
    "GAZI": ("GAZI", 28), "MERKEZ-B1": ("MERKEZ", 32), "MERKEZ-Z": ("MERKEZ", 32), "MERKEZ-K1": ("MERKEZ", 32),
    "AVM": ("AVM", 144), "HASTANE": ("HASTANE", 60),
}


def _tool():
    spec = importlib.util.spec_from_file_location("kroki_to_slots", BASE_DIR / "tools" / "kroki_to_slots.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _detect(layout, img):
    h, w = img.shape[:2]
    lay = layout.scaled(w, h)
    det = ColorVehicleDetector.for_layout(lay, w, h)
    v = det.detect(img)
    obs = evaluate_slots(lay, [x.bbox for x in v], [x.confidence for x in v], 0.35, 1.0)
    return {o.code for o in obs if o.occupied}


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.reg = LayoutRegistry(SLOTS, SLOTS_DIR)

    def test_all_lots_have_layouts(self):
        got = {e.id: (e.lot_code, len(e.layout.slots)) for e in self.reg.entries()}
        self.assertEqual(got, EXPECTED)

    def test_codes_unique_and_prefixed_per_floor(self):
        for e in self.reg.entries():
            codes = [s.code for s in e.layout.slots]
            self.assertEqual(len(codes), len(set(codes)), e.id)
        for tag in ("B1", "Z", "K1"):
            e = self.reg.get(f"MERKEZ-{tag}")
            prefix = {"B1": "B1-", "Z": "ZM-", "K1": "K1-"}[tag]
            self.assertTrue(all(s.code.startswith(prefix) for s in e.layout.slots), tag)

    def test_resolve_rules(self):
        self.assertEqual(self.reg.resolve().id, "GAZI")                       # varsayılan
        self.assertEqual(self.reg.resolve(lot_code="merkez").id, "MERKEZ-B1")  # en alt kat
        self.assertEqual(self.reg.resolve("merkez-k1").id, "MERKEZ-K1")
        self.assertEqual(self.reg.resolve("AVM", "AVM").id, "AVM")
        with self.assertRaises(ValueError):                                    # otopark uyuşmuyor
            self.reg.resolve("AVM", "GAZI")
        with self.assertRaises(LayoutNotFound):
            self.reg.resolve("YOK")
        with self.assertRaises(LayoutNotFound):
            self.reg.resolve(lot_code="YOK")

    def test_disabled_flags(self):
        gazi = self.reg.get("GAZI").layout
        self.assertEqual({s.code for s in gazi.slots if s.disabled}, {"A01", "A02"})
        self.assertTrue(any(s.disabled for s in self.reg.get("AVM").layout.slots))

    def test_reload_and_lot_from_filename(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            reg = LayoutRegistry(SLOTS, d)
            self.assertEqual([e.id for e in reg.entries()], ["GAZI"])
            # lotCode alanı olmayan, slot_editor ile çizilmiş dosya: otopark kodu dosya adından gelir
            (d / "HASTANE-ACIL.json").write_text(json.dumps({"imageWidth": 100, "imageHeight": 100, "slots": [
                {"code": "A01", "polygon": [[0, 0], [50, 0], [50, 50], [0, 50]]}]}), encoding="utf-8")
            (d / "bozuk.json").write_text("{", encoding="utf-8")          # diğerlerini engellememeli
            ids = {e.id: e.lot_code for e in reg.entries()}
            self.assertEqual(ids, {"GAZI": "GAZI", "HASTANE-ACIL": "HASTANE"})


class KrokiToolTests(unittest.TestCase):
    def test_build_multi_floor_and_crop(self):
        tool = _tool()
        layout = {"lot": {"code": "X", "name": "Test", "floors": [{"floor": -1, "name": "B1"}, {"floor": 0, "name": "Zemin"}]},
                  "slots": [
                      {"code": "B1-01", "floor": -1, "type": "Disabled", "mapX": 100, "mapY": 200, "mapW": 50, "mapH": 80},
                      {"code": "B1-02", "floor": -1, "type": "Standard", "mapX": 156, "mapY": 200, "mapW": 50, "mapH": 80},
                      {"code": "ZM-01", "floor": 0, "type": "Standard", "mapX": 10, "mapY": 10, "mapW": 50, "mapH": 80},
                      {"code": "ZM-02", "floor": 0, "type": "Standard", "mapX": 70, "mapY": 10, "mapW": 50, "mapH": 80,
                       "isActive": False},
                  ]}
        out = {o["id"]: o for o in tool.build_layouts(layout, margin=10)}
        self.assertEqual(set(out), {"X-B1", "X-Z"})
        b1 = out["X-B1"]
        self.assertEqual((b1["lotCode"], b1["floor"], b1["imageWidth"], b1["imageHeight"]), ("X", -1, 126, 100))
        self.assertEqual(b1["slots"][0]["polygon"][0], [10, 10])            # kırpılmış koordinat
        self.assertTrue(b1["slots"][0]["disabled"])
        self.assertNotIn("disabled", b1["slots"][1])
        self.assertEqual([s["code"] for s in out["X-Z"]["slots"]], ["ZM-01"])  # pasif cep atlanır
        single = tool.build_layouts({"lot": {"code": "Y", "name": "Y"}, "slots": layout["slots"][:1]})
        self.assertEqual(single[0]["id"], "Y")                              # tek katlıda kat eki yok

    def test_written_file_loads(self):
        tool = _tool()
        with tempfile.TemporaryDirectory() as d:
            data = tool.build_layouts({"lot": {"code": "Q", "name": "Çarşı"}, "slots": [
                {"code": "A-01", "floor": 0, "type": "Standard", "mapX": 0, "mapY": 0, "mapW": 40, "mapH": 80}]})[0]
            p = tool.write_layout(data, Path(d))
            e = LayoutRegistry(SLOTS, Path(d)).get("Q")
            self.assertEqual((e.lot_code, [s.code for s in e.layout.slots]), ("Q", ["A-01"]))
            self.assertIn("Çarşı", p.read_text(encoding="utf-8"))


class SampleSceneTests(unittest.TestCase):
    def test_every_layout_detected_exactly(self):
        reg = LayoutRegistry(SLOTS, SLOTS_DIR)
        for e in reg.entries():
            for seed in (1, 2):
                img, occupied = render_sample(e.layout, 0.5, seed, title=e.layout.name)
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
                img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                with self.subTest(layout=e.id, seed=seed):
                    self.assertEqual(img.shape[:2], (e.layout.image_height, e.layout.image_width))
                    self.assertEqual(_detect(e.layout, img), occupied)

    def test_explicit_and_bounds(self):
        layout = LayoutRegistry(SLOTS, SLOTS_DIR).get("HASTANE").layout
        _, occ = render_sample(layout, occupied=["p01", "Z28", "YOK"])
        self.assertEqual(occ, {"P01", "Z28"})
        self.assertEqual(len(render_sample(layout, 0)[1]), 0)
        self.assertEqual(len(render_sample(layout, 1)[1]), 60)
        self.assertEqual(render_sample(layout, 0.3, seed=5)[1], render_sample(layout, 0.3, seed=5)[1])

    def test_ascii_title(self):
        self.assertEqual(ascii_text("Çarşı AVM – Şehir"), "Carsi AVM - Sehir")


class AgentAssignTests(unittest.TestCase):
    def test_occupancy_agent_switches_layout_and_lot(self):
        reg = LayoutRegistry(SLOTS, SLOTS_DIR)
        mgr = AgentManager(Settings.load(environ={}), registry=SimpleNamespace(), backend=None)
        agent = OccupancyAgent("doluluk-1", "0", registry=SimpleNamespace(), backend=None, slots_file=SLOTS)
        mgr.agents[agent.id] = agent
        self.assertEqual((agent.info()["layout"], agent.lot_code), ("GAZI", "GAZI"))
        entry = reg.get("MERKEZ-K1")
        mgr.assign(agent.id, entry.lot_code, entry)
        self.assertEqual((agent.info()["layout"], agent.info()["lotCode"]), ("MERKEZ-K1", "MERKEZ"))
        agent.on_start()
        self.assertEqual(len(agent.layout.slots), 32)
        self.assertTrue(all(s.code.startswith("K1-") for s in agent.layout.slots))
        self.assertFalse(agent.running)  # duran ajan başlatılmaz

    def test_gate_agent_switches_lot(self):
        settings = Settings.load(environ={})
        mgr = AgentManager(settings, registry=SimpleNamespace(), backend=None)
        agent = mgr.build_agent({"id": "giris-1", "type": "Gate", "gate": "Entry", "source": "0"})
        mgr.agents[agent.id] = agent
        mgr.assign("giris-1", "hastane")
        self.assertEqual(agent.lot_code, "HASTANE")
        self.assertIsNone(mgr.assign("yok", "AVM"))


try:  # API testleri yalnızca fastapi kuruluysa (servis ortamı)
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover
    TestClient = None


@unittest.skipIf(TestClient is None, "fastapi kurulu değil")
class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app.main as main
        cls.main = main
        cls.client = TestClient(main.app)  # lifespan çalışmaz: modeller yüklenmez (renk dedektörü yeterli)

    def test_layouts_endpoint(self):
        r = self.client.get("/config/layouts")
        self.assertEqual(r.status_code, 200)
        self.assertEqual({x["id"] for x in r.json()}, set(EXPECTED))
        r = self.client.get("/config/layouts", params={"lot": "MERKEZ"})
        self.assertEqual([x["id"] for x in r.json()], ["MERKEZ-B1", "MERKEZ-Z", "MERKEZ-K1"])
        r = self.client.get("/config/slots", params={"layout": "AVM"})
        self.assertEqual((r.json()["lotCode"], len(r.json()["slots"])), ("AVM", 144))
        self.assertEqual(self.client.get("/config/slots").json()["id"], "GAZI")
        self.assertEqual(self.client.get("/config/slots", params={"layout": "YOK"}).status_code, 404)

    def test_sample_then_analyze_each_layout(self):
        from tests.mock_backend import MockBackend
        from app.backend_client import BackendClient
        with MockBackend() as mb:
            old = self.main.backend
            self.main.backend = BackendClient(mb.url, "dev-vision-key", timeout=2, retries=1)
            try:
                for layout_id, (lot, count) in EXPECTED.items():
                    s = self.client.get("/occupancy/sample", params={"layout": layout_id, "ratio": 0.4, "seed": 3})
                    self.assertEqual(s.status_code, 200)
                    self.assertEqual(s.headers["content-type"], "image/jpeg")
                    expected = int(s.headers["x-occupied-count"])
                    r = self.client.post("/occupancy/analyze",
                                         params={"layout": layout_id, "detector": "color", "forward": "true"},
                                         files={"file": ("ornek.jpg", s.content, "image/jpeg")})
                    self.assertEqual(r.status_code, 200, r.text)
                    body = r.json()
                    with self.subTest(layout=layout_id):
                        self.assertEqual((body["layout"], body["lotCode"], len(body["slots"])), (layout_id, lot, count))
                        self.assertEqual(sum(1 for x in body["slots"] if x["occupied"]), expected)
                        self.assertTrue(body["backendResponse"]["sent"])
                        path, payload, _ = mb.requests[-1]
                        self.assertEqual((path, payload["lotCode"]), ("/api/vision/occupancy", lot))
            finally:
                self.main.backend = old

    def test_analyze_errors(self):
        s = self.client.get("/occupancy/sample", params={"layout": "AVM"}).content
        r = self.client.post("/occupancy/analyze", params={"layout": "AVM", "lot": "GAZI", "detector": "color"},
                             files={"file": ("x.jpg", s, "image/jpeg")})
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/occupancy/analyze", params={"layout": "YOK", "detector": "color"},
                             files={"file": ("x.jpg", s, "image/jpeg")})
        self.assertEqual(r.status_code, 404)

    def test_assign_endpoint(self):
        agent = OccupancyAgent("test-doluluk", "0", registry=SimpleNamespace(), backend=None, slots_file=SLOTS)
        self.main.manager.agents[agent.id] = agent
        try:
            r = self.client.post("/agents/test-doluluk/assign", params={"layout": "HASTANE"})
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual((r.json()["layout"], r.json()["lotCode"]), ("HASTANE", "HASTANE"))
            r = self.client.post("/agents/test-doluluk/assign", params={"lot": "MERKEZ"})
            self.assertEqual(r.json()["layout"], "MERKEZ-B1")
            self.assertEqual(self.client.post("/agents/test-doluluk/assign", params={"layout": "YOK"}).status_code, 404)
        finally:
            self.main.manager.agents.pop("test-doluluk", None)
