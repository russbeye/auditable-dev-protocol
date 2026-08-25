#!/usr/bin/env python3
"""Serve ADP-Parser.html plus a live audit log for zero-click observability.

Usage: python3 adp-serve.py <audit-log-path> [port]

Serves this script's directory (parser, theme, background) over localhost and
exposes the audit log at /<its basename>, read fresh from disk on every request.
Also exposes the corpus that contains the log: /corpus.json lists every file
path under the .adp directory, and /corpus/<relpath> serves the raw file. The
shell builds its index in the browser from those, so no index is ever written
to disk here. Prints one line, the URL to open, and then serves until
interrupted. Port 0 (the default) picks any free port.
"""
import http.server
import json
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

    # The corpus is the .adp directory the served log lives in. When the log
    # sits elsewhere, we fall back to ./.adp so the corpus routes still work.
    parts = log_path.split(os.sep)
    if ".adp" in parts:
        corpus_root = os.path.realpath(os.sep.join(parts[:parts.index(".adp") + 1]))
    else:
        fallback = os.path.realpath(".adp")
        corpus_root = fallback if os.path.isdir(fallback) else None

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=SCRIPTS_DIR, **kwargs)

        def send_bytes(self, body, ctype):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            route = urllib.parse.urlparse(self.path).path
            if route == log_route:
                try:
                    with open(log_path, "rb") as f:
                        body = f.read()
                except OSError:
                    self.send_error(404, "audit log not found")
                    return
                self.send_bytes(body, "text/markdown; charset=utf-8")
                return
            if route == "/corpus.json":
                if corpus_root is None:
                    self.send_error(404, "no corpus directory")
                    return
                names = []
                for dirpath, dirnames, filenames in os.walk(corpus_root):
                    dirnames.sort()
                    for fn in filenames:
                        rel = os.path.relpath(os.path.join(dirpath, fn), corpus_root)
                        names.append(rel.replace(os.sep, "/"))
                names.sort()
                project = os.path.basename(os.path.dirname(corpus_root))
                body = json.dumps({"root": project, "files": names}).encode("utf-8")
                self.send_bytes(body, "application/json; charset=utf-8")
                return
            if route.startswith("/corpus/"):
                if corpus_root is None:
                    self.send_error(404, "no corpus directory")
                    return
                rel = urllib.parse.unquote(route[len("/corpus/"):])
                target = os.path.realpath(os.path.join(corpus_root, rel))
                # realpath collapses any ../ escape, so a target outside the
                # corpus root is a traversal attempt and gets a plain 404.
                if not target.startswith(corpus_root + os.sep) or not os.path.isfile(target):
                    self.send_error(404, "not in corpus")
                    return
                with open(target, "rb") as f:
                    body = f.read()
                self.send_bytes(body, "text/plain; charset=utf-8")
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
