# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

"""The icon a website declares for itself, fetched once and kept in the data directory.

The addresses come from bookmarks and from pages nobody here has read, so every request
is treated as hostile input: only http and https, never loopback or link-local, a private
network only for the bookmarked host itself, each connection made to exactly the address
that was checked, a cap on time and size, and nothing kept that is not an image.
"""

import hashlib
import html
import http.client
import ipaddress
import logging
import os
import re
import socket
import ssl
import threading
import time
import zlib
from collections import namedtuple
from urllib.parse import quote, urljoin, urlsplit

from . import brand
from .paths import DATA_DIR

ICON_DIR = DATA_DIR / 'bookmark_icons'
SUFFIXES = {
    'image/png': 'png', 'image/x-icon': 'ico', 'image/svg+xml': 'svg',
    'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
}
KINDS = {suffix: kind for kind, suffix in SUFFIXES.items()}
FRESH = 30 * 24 * 3600
RETRY = 6 * 3600
UNREACHABLE = 300
WAIT = 4.0
BUDGET = 12.0
TIMEOUT = 5.0
MAX_PAGE = 256 * 1024
MAX_ICON = 1024 * 1024
MAX_TAG = 2000
MAX_REDIRECTS = 5
MAX_DECLARED = 3
MAX_ADDRESSES = 3
MIN_SIDE = 8
MISSING = object()

Icon = namedtuple('Icon', 'path kind')

_Target = namedtuple('_Target', 'scheme host port path')
_Reply = namedtuple('_Reply', 'url status body')
_Declared = namedtuple('_Declared', 'url touch vector ico size')

_PORTS = {'http': 80, 'https': 443}
_REDIRECTS = (301, 302, 303, 307, 308)
_PATH_SAFE = "/%:@!$&'()*+,;=-._~"
_CONTROL = re.compile(r'[\x00-\x1f\x7f\\]')
_HOST = re.compile(r'[a-z0-9_.-]+|[0-9a-f:.]+')
# Python's idna codec follows the 2003 rules and turns these into other letters, which would send the request to a different domain than a browser.
_IDNA_DEVIATIONS = 'ßς‌‍'
_LOCAL = tuple(ipaddress.ip_network(net) for net in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7'))
_NAT64 = ipaddress.ip_network('64:ff9b::/96')
_HEADERS = {
    'User-Agent': f'Mozilla/5.0 (compatible; {brand.NAME}; +{brand.REPOSITORY})',
    'Accept-Encoding': 'gzip',
    'Accept-Language': 'de,en;q=0.8',
    'Connection': 'close',
}
_PAGE = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
_IMAGE = 'image/*,*/*;q=0.5'
_ATTRIBUTE = re.compile(r'''([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))''')
_SIZE = re.compile(r'(\d{1,5})x\d{1,5}', re.I)
_BRACE = re.compile(rb'[{}]')
_SVG = re.compile(rb'\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--.*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--.*?-->\s*)*<svg[\s>]', re.I | re.S)

_lock = threading.Lock()
_running = {}
_unreachable = {}
_slots = threading.BoundedSemaphore(4)
_tls_context = None


def _target(url):
    if not isinstance(url, str):
        return None
    url = url.strip().replace(' ', '%20')
    if _CONTROL.search(url):
        return None
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if parts.scheme not in _PORTS or not host or parts.username is not None or parts.password is not None:
        return None
    if any(letter in host for letter in _IDNA_DEVIATIONS):
        return None
    try:
        host = host.encode('idna').decode('ascii')
    except UnicodeError:
        return None
    if not _HOST.fullmatch(host):
        return None
    path = quote(parts.path or '/', safe=_PATH_SAFE)
    if parts.query:
        path += '?' + quote(parts.query, safe=_PATH_SAFE + '?')
    return _Target(parts.scheme, host, port or _PORTS[parts.scheme], path)


def _key(url):
    target = _target(url)
    if target is None:
        return None
    return hashlib.sha256('{}://{}:{}{}'.format(*target).encode()).hexdigest()[:32]


def _origin(url):
    target = _target(url)
    if target is None:
        return None
    host = f'[{target.host}]' if ':' in target.host else target.host
    return f'{target.scheme}://{host}:{target.port}'


def _resolve(host, port):
    found = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(ipaddress.ip_address(entry[4][0].partition('%')[0]) for entry in found))


def _reach(address):
    """'public' for the open internet, 'local' for a private network, None for what is never asked."""
    if address.version == 6:
        inner = address.ipv4_mapped or address.sixtofour
        if inner is None and address in _NAT64:
            inner = ipaddress.ip_address(int(address) & 0xFFFFFFFF)
        if inner is not None:
            address = inner
    if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified or address.is_reserved:
        return None
    if any(address in net for net in _LOCAL):
        return 'local'
    return 'public' if address.is_global else None


def _tls():
    global _tls_context
    with _lock:
        if _tls_context is None:
            context = ssl.create_default_context()
            try:
                # A packaged build has no system certificate paths; requests brings this bundle along.
                import certifi
                context.load_verify_locations(certifi.where())
            except Exception:
                pass
            _tls_context = context
        return _tls_context


def _open_socket(address, port, timeout):
    return socket.create_connection((str(address), port), timeout)


class _Pinned(http.client.HTTPConnection):
    """Connects to the address that was checked instead of resolving the name a second time."""

    address = None

    def connect(self):
        self.sock = _open_socket(self.address, self.port, self.timeout)


class _PinnedTLS(http.client.HTTPSConnection):
    address = None

    def connect(self):
        sock = _open_socket(self.address, self.port, self.timeout)
        try:
            self.sock = _tls().wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def _connect(target, addresses, deadline):
    for address in addresses[:MAX_ADDRESSES]:
        left = deadline - time.monotonic()
        if left <= 0:
            return None
        if target.scheme == 'https':
            connection = _PinnedTLS(target.host, target.port, timeout=min(TIMEOUT, left), context=_tls())
        else:
            connection = _Pinned(target.host, target.port, timeout=min(TIMEOUT, left))
        connection.address = address
        try:
            connection.connect()
            return connection
        except (OSError, ValueError):
            connection.close()
    return None


def _body(response, deadline, limit, whole):
    """The body up to the limit. A whole body that is longer or cut short is no body; a page is simply read as far as its head."""
    encoding = (response.getheader('Content-Encoding') or 'identity').strip().lower()
    if encoding in ('gzip', 'x-gzip'):
        inflate = zlib.decompressobj(zlib.MAX_WBITS | 16)
    elif encoding == 'identity':
        inflate = None
    else:
        return None
    announced = response.length
    if whole and announced is not None and announced > limit:
        return None
    parts, size, received = [], 0, 0
    while size <= limit:
        if time.monotonic() > deadline:
            return None
        raw = response.read1(16384)
        if not raw:
            break
        received += len(raw)
        chunk = inflate.decompress(raw, limit + 1 - size) if inflate else raw
        parts.append(chunk)
        size += len(chunk)
        if not whole and b'</head' in chunk.lower():
            break
    if not whole:
        return b''.join(parts)[:limit]
    if size > limit or (announced is not None and received < announced) or (inflate and not inflate.eof):
        return None
    return b''.join(parts)


def _fetch(url, allow, deadline, limit, accept, whole=True):
    """One GET, followed through its redirects hop by hop. None when the answer never came or was not allowed."""
    for _ in range(MAX_REDIRECTS + 1):
        target = _target(url)
        if target is None:
            return None
        try:
            addresses = _resolve(target.host, target.port)
        except (OSError, ValueError):
            return None
        if not addresses or not all(allow(target.host, address) for address in addresses):
            return None
        connection = _connect(target, addresses, deadline)
        if connection is None:
            return None
        try:
            connection.request('GET', target.path, headers={**_HEADERS, 'Accept': accept})
            response = connection.getresponse()
            if response.status in _REDIRECTS:
                location = (response.getheader('Location') or '').strip()
                if not location:
                    return None
                url = urljoin(url, location)
                continue
            body = _body(response, deadline, limit, whole)
            return None if body is None else _Reply(url, response.status, body)
        except (OSError, http.client.HTTPException, ValueError, zlib.error):
            return None
        finally:
            connection.close()
    return None


def _without(data, lowered, start, end):
    """Both texts without every start…end section, found in one pass so that a page full of unclosed ones costs nothing extra."""
    kept, kept_lowered, at = [], [], 0
    while True:
        begin = lowered.find(start, at)
        if begin < 0:
            kept.append(data[at:])
            kept_lowered.append(lowered[at:])
            break
        kept.append(data[at:begin])
        kept_lowered.append(lowered[at:begin])
        close = lowered.find(end, begin + len(start))
        if close < 0:
            break
        at = close + len(end)
    return b''.join(kept), b''.join(kept_lowered)


def _tags(data):
    """The link and base tags of the head as (name, attributes), read without a parser: a hostile page must not be able to keep one busy."""
    lowered = data.lower()
    for start, end in ((b'<!--', b'-->'), (b'<script', b'</script'), (b'<style', b'</style')):
        data, lowered = _without(data, lowered, start, end)
    ends = [at for at in (lowered.find(b'</head'), lowered.find(b'<body')) if at >= 0]
    stop = min(ends) if ends else len(lowered)
    at = 0
    while True:
        at = lowered.find(b'<', at, stop)
        if at < 0:
            return
        name = lowered[at + 1:at + 5]
        if name in (b'link', b'base') and lowered[at + 5:at + 6] in (b' ', b'\t', b'\n', b'\r', b'\f', b'/'):
            close = lowered.find(b'>', at, at + MAX_TAG)
            if close > 0:
                found = _ATTRIBUTE.findall(data[at + 5:close].decode('utf-8', 'replace'))
                yield name.decode(), {key.lower(): html.unescape(double or single or bare) for key, double, single, bare in reversed(found)}
                at = close
        at += 1


def _declared(body, page_url):
    """The icons a page names, the best one first."""
    tags = list(_tags(body))
    base = page_url
    for name, attributes in tags:
        if name == 'base' and attributes.get('href'):
            try:
                base = urljoin(page_url, attributes['href'].strip())
            except ValueError:
                pass
            break
    found = []
    for name, attributes in tags:
        rel = set(attributes.get('rel', '').lower().split())
        touch = bool(rel & {'apple-touch-icon', 'apple-touch-icon-precomposed'})
        href = attributes.get('href', '').strip()
        if name != 'link' or not href or not (touch or 'icon' in rel) or _for_dark(attributes.get('media', '').lower().encode()):
            continue
        try:
            url = urljoin(base, href)
        except ValueError:
            continue
        if _target(url) is None:
            continue
        kind = attributes.get('type', '').strip().lower()
        ending = urlsplit(url).path.lower().rpartition('.')[2]
        ico = kind in ('image/x-icon', 'image/vnd.microsoft.icon') or ending == 'ico'
        vector = not ico and (kind == 'image/svg+xml' or ending == 'svg')
        size = max((int(side) for side in _SIZE.findall(attributes.get('sizes', ''))), default=0)
        found.append(_Declared(url, touch, vector, ico, size))
    return [entry.url for entry in sorted(found, key=_rank)]


def _rank(entry):
    """What looks best in a small tile: the vector, then a sharp favicon, then the home screen icon, then whatever is left."""
    if entry.touch:
        return (2, -(entry.size or 180))
    if entry.vector:
        return (0, 0)
    if entry.ico:
        return (4, -entry.size)
    if entry.size >= 64:
        return (1, abs(entry.size - 128))
    return (3, -entry.size)


def _for_dark(query):
    """Whether a media query picks a dark browser. The tile an icon lands on is always light."""
    return b'prefers-color-scheme' in query and (b'dark' in query) != (b'not' in query)


def _light_only(svg):
    """The vector without the colours it keeps for a dark browser; what it keeps for a light one applies always."""
    lowered = svg.lower()
    kept, at = [], 0
    while True:
        start = lowered.find(b'@media', at)
        opening = lowered.find(b'{', start) if start >= 0 else -1
        if opening < 0:
            break
        depth, closing = 0, -1
        for brace in _BRACE.finditer(lowered, opening):
            depth += 1 if brace.group() == b'{' else -1
            if depth == 0:
                closing = brace.start()
                break
        if closing < 0:
            break
        query = lowered[start:opening]
        if b'prefers-color-scheme' not in query:
            kept.append(svg[at:closing + 1])
        else:
            kept.append(svg[at:start])
            if not _for_dark(query):
                kept.append(svg[opening + 1:closing])
        at = closing + 1
    kept.append(svg[at:])
    return b''.join(kept)


def _image_type(data):
    """The kind of image the bytes really are, whatever the server called them. A tracking pixel is no icon."""
    if data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':
        sides = (int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big'))
        return 'image/png' if min(sides) >= MIN_SIDE else None
    if data[:6] in (b'GIF87a', b'GIF89a') and len(data) >= 10:
        sides = (int.from_bytes(data[6:8], 'little'), int.from_bytes(data[8:10], 'little'))
        return 'image/gif' if min(sides) >= MIN_SIDE else None
    if data[:4] == b'\x00\x00\x01\x00':
        count = int.from_bytes(data[4:6], 'little')
        entries = [data[6 + 16 * index:22 + 16 * index] for index in range(min(count, 64))]
        widest = max((entry[0] or 256 for entry in entries if len(entry) == 16), default=0)
        return 'image/x-icon' if widest >= MIN_SIDE else None
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if _SVG.match(data[:4096].lstrip(b'\xef\xbb\xbf')):
        return 'image/svg+xml'
    return None


def _discover(url):
    """The icon of the page as (kind, bytes), MISSING when the site answered without one, None when it could not be reached."""
    start = _target(url)
    if start is None:
        return MISSING
    try:
        home = {_reach(address) for address in _resolve(start.host, start.port)}
    except (OSError, ValueError):
        return None
    if not home or None in home:
        return MISSING
    own_network = home == {'local'}

    def allow(host, address):
        reach = _reach(address)
        return reach == 'public' or (reach == 'local' and own_network and host == start.host)

    deadline = time.monotonic() + BUDGET
    page = _fetch(url, allow, deadline, MAX_PAGE, _PAGE, whole=False)
    answered = page is not None
    candidates = _declared(page.body, page.url)[:MAX_DECLARED] if page is not None else []
    for origin in (_origin(page.url) if page is not None else None, _origin(url)):
        if origin:
            candidates.append(f'{origin}/favicon.ico')
    for candidate in dict.fromkeys(candidates):
        reply = _fetch(candidate, allow, deadline, MAX_ICON, _IMAGE)
        if reply is None:
            continue
        answered = True
        kind = _image_type(reply.body) if reply.status == 200 else None
        if kind:
            return kind, reply.body
    return MISSING if answered else None


def _stored(key):
    """The newest file kept for the key as (path, kind, age); kind is None where the site had no icon."""
    newest = None
    for suffix in (*KINDS, 'none'):
        path = ICON_DIR / f'{key}.{suffix}'
        try:
            changed = path.stat().st_mtime
        except OSError:
            continue
        if newest is None or changed > newest[2]:
            newest = (path, KINDS.get(suffix), changed)
    if newest is None:
        return None
    return newest[0], newest[1], time.time() - newest[2]


def _keep(key, kind, body):
    suffix = SUFFIXES.get(kind, 'none')
    path = ICON_DIR / f'{key}.{suffix}'
    scratch = ICON_DIR / f'{key}.{os.getpid()}.tmp'
    try:
        ICON_DIR.mkdir(parents=True, exist_ok=True)
        scratch.write_bytes(body)
        os.replace(scratch, path)
    except OSError:
        _remove(scratch)
        return
    for other in (*KINDS, 'none'):
        if other != suffix:
            _remove(ICON_DIR / f'{key}.{other}')


def _remove(path):
    try:
        path.unlink()
    except OSError:
        pass


def _work(url, key, had_icon, done):
    found = None
    try:
        with _slots:
            found = _discover(url)
    except Exception:
        logging.exception('Site icon: the fetch failed')
    try:
        if found is None:
            with _lock:
                now = time.monotonic()
                for known in [known for known, until in _unreachable.items() if until <= now]:
                    del _unreachable[known]
                _unreachable[key] = now + UNREACHABLE
        elif found is not MISSING:
            _keep(key, *found)
        elif had_icon:
            # The icon shown so far stays; touching it puts the next attempt a month away.
            stored = _stored(key)
            try:
                if stored and stored[1]:
                    os.utime(stored[0])
            except OSError:
                pass
        else:
            _keep(key, None, b'')
    finally:
        with _lock:
            _running.pop(key, None)
        done.set()


def _refresh(url, key, had_icon):
    with _lock:
        if _unreachable.get(key, 0) > time.monotonic():
            return None
        done = _running.get(key)
        if done is None:
            done = _running[key] = threading.Event()
            threading.Thread(target=_work, args=(url, key, had_icon, done), name='site-icon', daemon=True).start()
    return done


def icon_for(url, wait=None):
    """The kept icon of the page. A first fetch runs beside the request, which waits for it only briefly."""
    key = _key(url)
    if key is None:
        return None
    stored = _stored(key)
    if stored:
        path, kind, age = stored
        if kind and age < FRESH:
            return Icon(path, kind)
        if not kind and age < RETRY:
            return None
    done = _refresh(url, key, bool(stored and stored[1]))
    if stored and stored[1]:
        return Icon(stored[0], stored[1])
    if done is not None:
        done.wait(WAIT if wait is None else wait)
    stored = _stored(key)
    return Icon(stored[0], stored[1]) if stored and stored[1] else None


def content(icon):
    """What is sent for an icon: a vector in its colours for a light surface, anything else as it was kept."""
    body = icon.path.read_bytes()
    return _light_only(body) if icon.kind == 'image/svg+xml' else body


def retry(url):
    """Lets the next request ask a site again that had no icon."""
    key = _key(url)
    if key is None:
        return
    with _lock:
        _unreachable.pop(key, None)
    _remove(ICON_DIR / f'{key}.none')


def forget(url, still_used=()):
    """Drops what is kept for the page unless one of the other addresses is the same page."""
    key = _key(url)
    if key is None or key in {_key(other) for other in still_used}:
        return
    with _lock:
        _unreachable.pop(key, None)
    for suffix in (*KINDS, 'none'):
        _remove(ICON_DIR / f'{key}.{suffix}')
