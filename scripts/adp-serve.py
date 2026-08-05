#!/usr/bin/env python3
"""Serve ADP-Parser.html plus a live audit log for zero-click observability.

Usage: python3 adp-serve.py <audit-log-path> [port]

Serves this script's directory (parser, theme, background) over localhost and
exposes the audit log at /<its basename>, read fresh from disk on every request.
Prints one line, the URL to open, and then serves until interrupted. Port 0
(the default) picks any free port.
"""
import http.server
import os
import sys
import urllib.parse

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))


def main():
    if len(sys.argv) < 2:
        print("usage: adp-serve.py <audit-log-path> [port]", file=sys.stderr)
        sys.exit(2)
    log_path = os.path.abspath(sys.argv[1])
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    log_route = "/" + os.path.basename(log_path)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=SCRIPTS_DIR, **kwargs)

        def do_GET(self):
            if urllib.parse.urlparse(self.path).path == log_route:
                try:
                    with open(log_path, "rb") as f:
                        body = f.read()
                except OSError:
                    self.send_error(404, "audit log not found")
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/markdown; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def log_message(self, *args):
            pass  # We keep stdout to the one URL line, so a caller can read it and go.

    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        port = httpd.server_address[1]
        query = urllib.parse.quote(log_route)
        print(f"http://127.0.0.1:{port}/ADP-Parser.html?file={query}", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
