"""Loopback-only callback proxy for a Cloudflared tunnel. Backend validates grants."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

ALLOWED = {'/api/v2/internal/tools', '/api/v2/internal/invocation-status'}
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # Never log grants or evidence.
    def do_GET(self): self.send_error(404)
    def do_POST(self):
        if self.path not in ALLOWED:
            self.send_error(404); return
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or len(auth) > 8192:
            self.send_error(401); return
        try: length = int(self.headers.get('Content-Length', '-1'))
        except ValueError: length = -1
        if self.headers.get('Transfer-Encoding') or not 0 <= length <= 1048576:
            self.send_error(413); return
        self.connection.settimeout(15)
        try:
            payload = self.rfile.read(length)
            if len(payload) != length: raise ValueError('incomplete body')
            req = Request('http://127.0.0.1:3030'+self.path, data=payload,
                          headers={'Authorization':auth, 'Content-Type':'application/json'}, method='POST')
            try: response = build_opener(NoRedirect).open(req, timeout=15)
            except HTTPError as error: response = error
            with response:
                body = response.read(2097153)
                if len(body) > 2097152: raise ValueError('response too large')
                self.send_response(response.code)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers(); self.wfile.write(body)
        except Exception:
            self.send_error(502)
if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1',3035),Handler).serve_forever()
