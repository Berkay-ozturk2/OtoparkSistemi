"""Testler ve elle deneme için küçük sahte backend (yalnızca standart kütüphane).

Elle kullanım:  python -m tests.mock_backend --port 5080
"""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class MockBackend:
    def __init__(self, port: int = 0, api_key: str = "dev-vision-key", fail_first: int = 0):
        self.api_key = api_key
        self.requests = []          # (yol, gövde, başlıklar)
        self.fail_first = fail_first
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                outer.requests.append((self.path, body, dict(self.headers)))
                if self.headers.get("X-Api-Key") != outer.api_key:
                    return self._json(401, {"message": "Geçersiz API anahtarı"})
                if outer.fail_first > 0:
                    outer.fail_first -= 1
                    return self._json(503, {"message": "geçici hata"})
                if self.path == "/api/vision/plate-events":
                    review = body.get("confidence", 0) < 0.6 or not body.get("formatValid")
                    return self._json(200, {"eventId": len(outer.requests), "sessionId": 1, "fee": 0,
                                            "decision": "PendingReview" if review else "Allowed",
                                            "message": "Operatör onayı bekleniyor" if review else "Hoş geldiniz. Önerilen bölge: A",
                                            "suggestedZone": None if review else "A"})
                if self.path in ("/api/vision/occupancy", "/api/vision/heartbeat"):
                    self.send_response(204)
                    self.end_headers()
                    return
                return self._json(404, {"message": "bulunamadı"})

            def _json(self, code, data):
                raw = json.dumps(data).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Sahte backend: gelen istekleri ekrana yazar")
    ap.add_argument("--port", type=int, default=5080)
    args = ap.parse_args()
    with MockBackend(args.port) as mb:
        print(f"Sahte backend dinliyor: {mb.url}  (Ctrl+C ile çıkın)")
        import time
        seen = 0
        try:
            while True:
                time.sleep(0.5)
                for path, body, _ in mb.requests[seen:]:
                    if "imageBase64" in body:
                        body = {**body, "imageBase64": f"<{len(body['imageBase64'])} karakter>"}
                    print(path, json.dumps(body, ensure_ascii=False))
                seen = len(mb.requests)
        except KeyboardInterrupt:
            pass
