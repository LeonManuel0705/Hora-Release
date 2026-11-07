#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Serve a web app build under /pwa/ with the header rules the website host applies.

    python scripts/serve_web_app.py [--build flutter_app/build/web] [--port 5085]

Like the host, every HTML response carries an injected comment, so the offline
worker is tested against bodies that differ from the build files."""

import argparse
import email.utils
import fnmatch
import hashlib
import http.server
import mimetypes
import posixpath
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
MOUNT = '/pwa/'
TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.css': 'text/css; charset=UTF-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=UTF-8',
}
INJECTED = b'\n<!-- injected by the local host, like the website host does -->'


def header_rules(path):
    rules = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if not line[0].isspace():
            rules.append((line.strip(), []))
        elif rules and ':' in line:
            name, value = line.strip().split(':', 1)
            rules[-1][1].append((name.strip(), value.strip()))
    return rules


def headers_for(rules, path):
    chosen = {}
    for pattern, headers in rules:
        if fnmatch.fnmatchcase(path, pattern):
            for name, value in headers:
                chosen[name.lower()] = (name, value)
    return list(chosen.values())


def with_comment(body):
    lower = body.lower()
    start = lower.find(b'<meta charset')
    if start < 0:
        start = lower.find(b'<head')
    end = body.find(b'>', start) if start >= 0 else -1
    return body if end < 0 else body[: end + 1] + INJECTED + body[end + 1:]


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'LocalHost/1'
    build = Path('.')
    rules = []

    def log_message(self, format, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), format % args))

    def do_HEAD(self):
        self.answer(head=True)

    def do_GET(self):
        self.answer(head=False)

    def answer(self, head):
        raw = urlsplit(self.path).path
        if raw == MOUNT.rstrip('/'):
            return self.reply(301, extra=[('Location', MOUNT)])
        path = posixpath.normpath(unquote(raw))
        if raw.endswith('/'):
            path = path.rstrip('/') + '/index.html'
        if not path.startswith(MOUNT):
            return self.reply(404)
        file = (self.build / path[len(MOUNT):]).resolve()
        if self.build not in file.parents or not file.is_file():
            return self.reply(404)
        body = file.read_bytes()
        kind = TYPES.get(file.suffix.lower()) or mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        if kind.startswith('text/html'):
            body = with_comment(body)
        tag = '"%s"' % hashlib.sha1(body).hexdigest()
        if tag in [value.strip() for value in self.headers.get('If-None-Match', '').split(',')]:
            return self.reply(304, extra=[('ETag', tag)], url=path)
        extra = [
            ('Content-Type', kind),
            ('Cache-Control', 'public,max-age=0,must-revalidate'),
            ('ETag', tag),
            ('Last-Modified', email.utils.formatdate(file.stat().st_mtime, usegmt=True)),
        ]
        self.reply(200, extra=extra, body=None if head else body, length=len(body), url=path)

    def reply(self, status, extra=(), body=None, length=0, url=None):
        self.send_response(status)
        for name, value in headers_for(self.rules, url or urlsplit(self.path).path):
            self.send_header(name, value)
        for name, value in extra:
            self.send_header(name, value)
        self.send_header('Content-Length', str(length if status == 200 else 0))
        self.end_headers()
        if body:
            self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--build', default=str(ROOT / 'flutter_app' / 'build' / 'web'))
    parser.add_argument('--headers', default=str(ROOT / 'landing-page' / 'public' / '_headers'))
    parser.add_argument('--port', type=int, default=5085)
    parser.add_argument('--bind', default='127.0.0.1')
    args = parser.parse_args()
    Handler.build = Path(args.build).resolve()
    Handler.rules = header_rules(args.headers)
    if not (Handler.build / 'index.html').is_file():
        sys.exit(f'no web build in {Handler.build}')
    server = http.server.ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f'serving {Handler.build} at http://{args.bind}:{args.port}{MOUNT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
