"""Backend istemcisi testleri (sahte HTTP sunucusu ile; ağ gerektirmez)."""
import unittest

from app.backend_client import BackendClient, build_plate_event
from tests.mock_backend import MockBackend


class BackendClientTests(unittest.TestCase):
    def test_plate_event_payload_and_header(self):
        with MockBackend() as mb:
            c = BackendClient(mb.url, "dev-vision-key", timeout=2, retries=1)
            ok, body = c.send_plate_event("giris-1", "Entry", "34ABC123", 0.87, True, "QUJD", "2026-11-25T08:30:00Z")
            self.assertTrue(ok)
            self.assertEqual(body["decision"], "Allowed")
            path, sent, headers = mb.requests[0]
            self.assertEqual(path, "/api/vision/plate-events")
            self.assertEqual(headers.get("X-Api-Key"), "dev-vision-key")
            self.assertEqual(sent, {"cameraId": "giris-1", "gate": "Entry", "plate": "34ABC123", "confidence": 0.87,
                                    "formatValid": True, "timestamp": "2026-11-25T08:30:00Z", "imageBase64": "QUJD"})
            c.close()

    def test_occupancy_and_heartbeat_204(self):
        with MockBackend() as mb:
            c = BackendClient(mb.url, "dev-vision-key", timeout=2, retries=1)
            self.assertTrue(c.send_occupancy("doluluk-1", [{"code": "A01", "occupied": True, "confidence": 0.93}]))
            self.assertTrue(c.send_heartbeat([{"id": "giris-1", "type": "Gate", "status": "Running", "fps": 4.2, "lastError": None}]))
            self.assertEqual([r[0] for r in mb.requests], ["/api/vision/occupancy", "/api/vision/heartbeat"])
            occ = mb.requests[0][1]
            self.assertEqual(set(occ), {"cameraId", "timestamp", "slots"})
            self.assertTrue(occ["timestamp"].endswith("Z"))
            c.close()

    def test_retry_on_5xx(self):
        with MockBackend(fail_first=1) as mb:
            c = BackendClient(mb.url, "dev-vision-key", timeout=2, retries=3, backoff=0.01)
            ok, _ = c.send_plate_event("giris-1", "Entry", "34ABC123", 0.9, True)
            self.assertTrue(ok)
            self.assertEqual(len(mb.requests), 2)
            c.close()

    def test_no_retry_on_401(self):
        with MockBackend() as mb:
            c = BackendClient(mb.url, "yanlis-anahtar", timeout=2, retries=3, backoff=0.01)
            ok, body = c.send_plate_event("giris-1", "Entry", "34ABC123", 0.9, True)
            self.assertFalse(ok)
            self.assertEqual(body["message"], "Geçersiz API anahtarı")
            self.assertEqual(len(mb.requests), 1)
            c.close()

    def test_unreachable_backend_does_not_raise(self):
        c = BackendClient("http://127.0.0.1:9", "k", timeout=0.5, retries=2, backoff=0.01)
        ok, body = c.send_plate_event("giris-1", "Entry", "34ABC123", 0.9, True)
        self.assertFalse(ok)
        self.assertIsNone(body)
        self.assertIsNotNone(c.last_error)
        self.assertFalse(c.send_heartbeat([]))
        c.close()

    def test_confidence_clamped_and_image_optional(self):
        p = build_plate_event("c", "Exit", "34ABC123", 1.7, False)
        self.assertEqual(p["confidence"], 1.0)
        self.assertNotIn("imageBase64", p)


if __name__ == "__main__":
    unittest.main()
