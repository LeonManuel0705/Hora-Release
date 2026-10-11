# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import gzip
import http.server
import ipaddress
import os
import socket
import ssl
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import database as db

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = '93.184.216.34'
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'
JPEG = b'\xff\xd8\xff\xe0' + bytes(16)
WEBP = b'RIFF' + (4).to_bytes(4, 'little') + b'WEBP'
HTML = b'<!doctype html><html><head><title>Not found</title></head><body>Not found</body></html>'


def png(side=32):
    return b'\x89PNG\r\n\x1a\n' + (13).to_bytes(4, 'big') + b'IHDR' + side.to_bytes(4, 'big') * 2 + bytes(9)


def gif(side=32):
    return b'GIF89a' + side.to_bytes(2, 'little') * 2 + bytes(6)


def ico(side=32, count=1):
    return b'\x00\x00\x01\x00' + count.to_bytes(2, 'little') + bytes([side % 256, side % 256]) * count + bytes(14 * count)


def page(*links):
    return ('<!doctype html><html><head><meta charset="utf-8">' + ''.join(links) + '</head><body><p>Hi</p></body></html>').encode()


def reply(body=b'', status=200, **headers):
    return status, {name.replace('_', '-'): value for name, value in headers.items()}, body


class Site:
    """A web server on this machine that answers what a test tells it to and notes what it was asked."""

    def __init__(self, tls=None):
        self.routes = {}
        self.seen = []
        site = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                host = (self.headers.get('Host') or '').lower()
                site.seen.append((host, self.path))
                answer = site.routes.get((host, self.path)) or site.routes.get(self.path) or reply(HTML, 404)
                if callable(answer):
                    answer = answer(self)
                if answer is None:
                    return
                status, headers, body = answer
                try:
                    self.send_response(status)
                    if 'Content-Length' not in headers and 'Unannounced' not in headers:
                        self.send_header('Content-Length', str(len(body)))
                    for name, value in headers.items():
                        if name != 'Unannounced':
                            self.send_header(name, value)
                    self.end_headers()
                    self.wfile.write(body)
                except OSError:
                    pass

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        if tls is not None:
            self.server.socket = tls.wrap_socket(self.server.socket, server_side=True)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, args=(0.01,), daemon=True).start()

    def paths(self, host=None):
        return [path for seen_host, path in self.seen if host is None or seen_host == host]

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def icons(tmp_path, monkeypatch):
    from app import site_icons

    monkeypatch.setattr(site_icons, 'ICON_DIR', tmp_path / 'icons')
    monkeypatch.setattr(site_icons, 'WAIT', 10.0)
    site_icons._running.clear()
    site_icons._unreachable.clear()
    return site_icons


@pytest.fixture
def site():
    site = Site()
    yield site
    site.close()


@pytest.fixture
def net(icons, site, monkeypatch):
    """Names resolve to what the test says, and every connection ends at the local site whatever address was checked."""
    net = SimpleNamespace(names={}, asked=[], opened=[], port=site.port)

    def resolve(host, port):
        net.asked.append(host)
        answer = net.names.get(host)
        if callable(answer):
            answer = answer()
        if answer is None:
            try:
                return [ipaddress.ip_address(host)]
            except ValueError:
                raise socket.gaierror(socket.EAI_NONAME, 'unknown name')
        return [ipaddress.ip_address(address) for address in answer]

    def open_socket(address, port, timeout):
        net.opened.append(str(address))
        return socket.create_connection(('127.0.0.1', net.port), timeout)

    monkeypatch.setattr(icons, '_resolve', resolve)
    monkeypatch.setattr(icons, '_open_socket', open_socket)
    net.names['site.test'] = [PUBLIC]
    return net


def wait_until_idle(icons):
    deadline = time.monotonic() + 10
    while icons._running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not icons._running


@pytest.mark.parametrize('url', [
    None, '', 'example.com', '//example.com/a.png', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)',
    'data:image/png;base64,AAAA', 'http://', 'http://[', 'http://user@example.com/', 'http://user:secret@example.com/',
    'http://example.com\\@evil.example/', 'http://exam\nple.com/', 'http://example.com:port/', 'http://straße.de/',
    'http://exa mple.com/',
])
def test_only_plain_web_addresses_are_ever_asked(icons, url):
    assert icons._target(url) is None


@pytest.mark.parametrize('url, expected', [
    ('HTTPS://Example.COM', ('https', 'example.com', 443, '/')),
    ('http://example.com:8080/a b?q=ä&x=1#top', ('http', 'example.com', 8080, '/a%20b?q=%C3%A4&x=1')),
    ('  https://müller.de/weg  ', ('https', 'xn--mller-kva.de', 443, '/weg')),
    ('http://[2001:db8::1]:8000/x', ('http', '2001:db8::1', 8000, '/x')),
    ('https://example.com/a%20b', ('https', 'example.com', 443, '/a%20b')),
])
def test_an_address_is_brought_into_one_form(icons, url, expected):
    assert tuple(icons._target(url)) == expected


def test_the_same_page_has_the_same_key_whatever_the_spelling(icons):
    assert icons._key('https://Example.com/a#one') == icons._key('https://example.com:443/a#two')
    assert icons._key('https://example.com/a') != icons._key('https://example.com/b')
    assert icons._key('https://example.com/a') != icons._key('http://example.com/a')


@pytest.mark.parametrize('address, expected', [
    ('93.184.216.34', 'public'), ('8.8.8.8', 'public'), ('2606:4700:4700::1111', 'public'), ('2002:808:808::1', 'public'),
    ('10.1.2.3', 'local'), ('172.16.0.1', 'local'), ('172.31.255.254', 'local'), ('192.168.178.1', 'local'),
    ('100.64.0.1', 'local'), ('100.127.255.254', 'local'), ('fd12:3456:789a::1', 'local'), ('::ffff:192.168.1.1', 'local'),
    ('2002:c0a8:101::1', 'local'), ('64:ff9b::a00:1', 'local'),
    ('127.0.0.1', None), ('127.8.9.10', None), ('::1', None), ('0.0.0.0', None), ('::', None), ('0.1.2.3', None),
    ('169.254.169.254', None), ('169.254.1.1', None), ('fe80::1', None), ('224.0.0.1', None), ('ff02::1', None),
    ('240.0.0.1', None), ('255.255.255.255', None), ('192.0.2.1', None), ('198.51.100.1', None), ('203.0.113.1', None),
    ('198.18.0.1', None), ('2001:db8::1', None), ('::ffff:127.0.0.1', None), ('::ffff:169.254.169.254', None),
    ('2002:7f00:1::1', None), ('64:ff9b::7f00:1', None), ('64:ff9b::a9fe:a9fe', None), ('2001::1', None),
])
def test_every_address_is_sorted_into_open_internet_own_network_or_never(icons, address, expected):
    assert icons._reach(ipaddress.ip_address(address)) == expected


def test_the_sharpest_favicon_comes_first(icons):
    body = page(
        '<link rel="shortcut icon" href="https://www.site.test/img/favicon.ico" type="image/x-icon">',
        '<link rel="icon" href="https://www.site.test/img/favicon_32x32.png" sizes="32x32">',
        '<link rel="icon" href="https://www.site.test/img/favicon_48x48.png" sizes="48x48">',
        '<link rel="icon" href="https://www.site.test/img/favicon_96x96.png" sizes="96x96">',
        '<link rel="icon" href="https://www.site.test/img/favicon_144x144.png" sizes="144x144">',
    )
    assert [url.rsplit('/', 1)[1] for url in icons._declared(body, 'https://www.site.test/')] == [
        'favicon_144x144.png', 'favicon_96x96.png', 'favicon_48x48.png', 'favicon_32x32.png', 'favicon.ico',
    ]


def test_a_vector_beats_the_home_screen_icon_and_that_beats_the_ico(icons):
    body = page(
        '<link rel="icon" href="/favicon.ico" sizes="any">',
        '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '<link rel="apple-touch-icon" sizes="120x120" href="/touch-120.png">',
        '<link rel="alternate icon" type="image/png" href="/favicon.png">',
    )
    assert icons._declared(body, 'https://site.test/deep/page') == [
        'https://site.test/icon.svg', 'https://site.test/apple-touch-icon.png', 'https://site.test/touch-120.png',
        'https://site.test/favicon.png', 'https://site.test/favicon.ico',
    ]


def test_addresses_in_a_page_are_read_the_way_a_browser_reads_them(icons):
    body = page(
        '<BASE HREF="https://cdn.site.test/assets/">',
        "<LINK REL='Icon Shortcut' HREF='a.png?x=1&amp;y=2' SIZES='64x64'>",
        '<link href=//other.test/b.png rel=icon sizes=72x72>',
        '<link rel="icon" sizes="80x80" href="  /c.png  " />',
        '<link rel="icon" rel="stylesheet" sizes="96x96" href="d.png" href="ignored.png">',
    )
    assert icons._declared(body, 'https://site.test/page') == [
        'https://cdn.site.test/assets/d.png', 'https://cdn.site.test/c.png', 'https://other.test/b.png',
        'https://cdn.site.test/assets/a.png?x=1&y=2',
    ]


def test_what_is_no_icon_of_the_page_is_left_out(icons):
    body = page(
        '<link rel="mask-icon" href="/mask.svg" color="#000">',
        '<link rel="fluid-icon" href="/fluid.png">',
        '<link rel="stylesheet" href="/icon.css">',
        '<link rel="icon">',
        '<link rel="icon" href="data:image/png;base64,AAAA">',
        '<link rel="icon" href="javascript:alert(1)">',
        '<link rel="icon" href="http://user@site.test/x.png">',
        '<!-- <link rel="icon" href="/old.png"> -->',
        '<script>document.write(\'<link rel="icon" href="/written.png">\')</script>',
        '<style>/* <link rel="icon" href="/styled.png"> */</style>',
        '<linker rel="icon" href="/linker.png">',
    ) + b'<link rel="icon" href="/in-the-body.png">'
    assert icons._declared(body, 'https://site.test/') == []


@pytest.mark.parametrize('piece', [b'<link ', b'<!--', b'<script', b'<link rel="icon" href="', b'<', b'<base href='])
def test_a_page_built_to_keep_a_reader_busy_is_done_in_no_time(icons, piece):
    body = piece * (icons.MAX_PAGE // len(piece))
    started = time.monotonic()
    icons._declared(body, 'https://site.test/')
    assert time.monotonic() - started < 3


@pytest.mark.parametrize('body, kind', [
    (png(), 'image/png'), (gif(), 'image/gif'), (ico(), 'image/x-icon'), (ico(0), 'image/x-icon'), (JPEG, 'image/jpeg'),
    (WEBP, 'image/webp'), (SVG, 'image/svg+xml'),
    (b'\xef\xbb\xbf<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<SVG width="1">', 'image/svg+xml'),
])
def test_an_image_is_known_by_its_bytes(icons, body, kind):
    assert icons._image_type(body) == kind


@pytest.mark.parametrize('body', [
    b'', HTML, b'{"error": "not found"}', b'<html><body><svg></svg></body></html>', b'<?xml version="1.0"?><rss></rss>',
    png(1), gif(1), ico(1), ico(32, count=0), b'\x00\x00\x02\x00\x01\x00' + bytes(16), b'\x89PNG\r\n\x1a\n', b'GIF89a', b'RIFF1234WAVE',
    b'<!--' * 2000,
])
def test_what_is_no_image_or_only_a_tracking_pixel_is_no_icon(icons, body):
    assert icons._image_type(body) is None


def test_the_icon_a_page_names_is_fetched(icons, site, net):
    site.routes['/start'] = reply(page('<link rel="icon" href="/img/logo.png" sizes="96x96">'), Content_Type='text/html; charset=utf-8')
    site.routes['/img/logo.png'] = reply(png(96), Content_Type='image/png')
    assert icons._discover('http://site.test/start') == ('image/png', png(96))
    assert site.seen == [('site.test', '/start'), ('site.test', '/img/logo.png')]
    assert net.opened == [PUBLIC, PUBLIC]


def test_the_request_says_who_asks_and_carries_nothing_else(icons, site, net):
    heard = {}

    def listen(handler):
        heard.update({name.lower(): value for name, value in handler.headers.items()})
        return reply(page())

    site.routes['/'] = listen
    icons._discover('http://site.test/')
    from app import brand

    assert brand.NAME in heard['user-agent'] and brand.REPOSITORY in heard['user-agent']
    assert not {'cookie', 'referer', 'authorization'} & set(heard)


def test_without_a_named_icon_the_usual_place_is_tried(icons, site, net):
    site.routes['/'] = reply(page())
    site.routes['/favicon.ico'] = reply(ico(), Content_Type='image/x-icon')
    assert icons._discover('http://site.test/') == ('image/x-icon', ico())


def test_a_site_that_turns_readers_away_can_still_have_an_icon(icons, site, net):
    site.routes['/article'] = reply(b'<html><head><title>Just a moment</title></head></html>', 403)
    site.routes['/favicon.ico'] = reply(WEBP, Content_Type='image/x-icon')
    assert icons._discover('http://site.test/article') == ('image/webp', WEBP)


def test_a_broken_first_choice_leads_to_the_next(icons, site, net):
    site.routes['/'] = reply(page('<link rel="icon" href="/gone.svg">', '<link rel="apple-touch-icon" href="/touch.png">'))
    site.routes['/touch.png'] = reply(png(180))
    assert icons._discover('http://site.test/') == ('image/png', png(180))
    assert site.paths() == ['/', '/gone.svg', '/touch.png']


def test_a_page_cannot_make_us_ask_for_dozens_of_icons(icons, site, net):
    site.routes['/'] = reply(page(*[f'<link rel="icon" href="/missing-{index}.png">' for index in range(40)]))
    assert icons._discover('http://site.test/') is icons.MISSING
    assert len(site.seen) == 1 + icons.MAX_DECLARED + 1


def test_a_packed_answer_is_unpacked(icons, site, net):
    site.routes['/'] = reply(gzip.compress(page('<link rel="icon" href="/logo.svg">')), Content_Encoding='gzip')
    site.routes['/logo.svg'] = reply(gzip.compress(SVG), Content_Encoding='gzip', Content_Type='image/svg+xml')
    assert icons._discover('http://site.test/') == ('image/svg+xml', SVG)


@pytest.mark.parametrize('answer', [
    lambda limit: reply(png() + bytes(limit)),
    lambda limit: reply(png() + bytes(limit), Unannounced='yes'),
    lambda limit: reply(gzip.compress(png() + bytes(20 * limit)), Content_Encoding='gzip'),
    lambda limit: reply(png(), Content_Length=str(len(png()) + 100)),
    lambda limit: reply(gzip.compress(png() + os.urandom(4000))[:-200], Content_Encoding='gzip'),
    lambda limit: reply(png(), Content_Encoding='br'),
    lambda limit: reply(HTML, Content_Type='image/x-icon'),
    lambda limit: reply(gif(1), Content_Type='image/gif'),
    lambda limit: reply(png(), 404),
])
def test_an_answer_that_is_too_big_cut_short_or_no_image_is_not_kept(icons, site, net, answer):
    site.routes['/'] = reply(page())
    site.routes['/favicon.ico'] = answer(icons.MAX_ICON)
    assert icons._discover('http://site.test/') is icons.MISSING


def test_reading_ends_at_the_limit_however_much_keeps_coming(icons, site, net):
    sent = []
    over = threading.Event()

    def pour(handler):
        try:
            handler.send_response(200)
            handler.end_headers()
            for _ in range(40 * icons.MAX_ICON // 65536):
                handler.wfile.write(bytes(65536))
                sent.append(65536)
        except OSError:
            pass
        finally:
            over.set()

    site.routes['/'] = reply(page())
    site.routes['/favicon.ico'] = pour
    assert icons._discover('http://site.test/') is icons.MISSING
    assert over.wait(10) and sum(sent) < 10 * icons.MAX_ICON


def test_only_the_head_of_a_long_page_is_read(icons, site, net):
    site.routes['/'] = reply(page('<link rel="icon" href="/logo.png">') + b'<p>' + bytes(8 * icons.MAX_PAGE) + b'</p>')
    site.routes['/logo.png'] = reply(png())
    assert icons._discover('http://site.test/') == ('image/png', png())


def test_redirects_are_followed_a_few_steps(icons, site, net):
    net.names['www.site.test'] = [PUBLIC]
    site.routes[('site.test', '/')] = reply(status=301, Location='http://www.site.test/home')
    site.routes[('www.site.test', '/home')] = reply(page('<link rel="icon" href="logo.png">'))
    site.routes[('www.site.test', '/logo.png')] = reply(status=302, Location='/static/logo.png')
    site.routes[('www.site.test', '/static/logo.png')] = reply(png())
    assert icons._discover('http://site.test/') == ('image/png', png())


def test_a_redirect_in_circles_ends(icons, site, net):
    site.routes['/'] = reply(status=302, Location='/')
    site.routes['/favicon.ico'] = reply(status=302, Location='/favicon.ico')
    assert icons._discover('http://site.test/') is None
    assert len(site.seen) == 2 * (icons.MAX_REDIRECTS + 1)


@pytest.mark.parametrize('inside', [
    'http://192.168.178.1/logo.png', 'http://10.0.0.5:8080/logo.png', 'http://router.lan/logo.png', 'http://127.0.0.1/logo.png',
    'http://localhost/logo.png', 'http://[::1]/logo.png', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/logo.png',
    'http://[::ffff:10.0.0.5]/logo.png', 'http://[64:ff9b::7f00:1]/logo.png', 'http://mixed.test/logo.png',
])
def test_a_site_on_the_internet_cannot_send_us_into_the_own_network(icons, site, net, inside):
    net.names.update({'router.lan': ['192.168.178.1'], 'localhost': ['127.0.0.1'], 'mixed.test': [PUBLIC, '10.0.0.5']})
    site.routes['/named'] = reply(page(f'<link rel="icon" href="{inside}">'))
    site.routes['/moved'] = reply(status=302, Location=inside)
    site.routes['/favicon.ico'] = reply(status=302, Location=inside)
    site.routes['/logo.png'] = reply(png())
    site.routes['/latest/meta-data/'] = reply(png())
    assert icons._discover('http://site.test/named') is icons.MISSING
    assert icons._discover('http://site.test/moved') is None
    assert set(net.opened) == {PUBLIC}
    assert not {'/logo.png', '/latest/meta-data/'} & set(site.paths())


def test_a_name_that_later_points_into_the_own_network_is_not_followed(icons, site, net):
    answers = iter([[PUBLIC], [PUBLIC], ['192.168.178.1'], ['192.168.178.1']])
    net.names['turning.test'] = lambda: next(answers)
    site.routes['/'] = reply(page('<link rel="icon" href="/reboot?now=1">'))
    site.routes['/reboot?now=1'] = reply(png())
    assert icons._discover('http://turning.test/') is icons.MISSING
    assert site.paths() == ['/'] and net.opened == [PUBLIC]


def test_a_bookmark_in_the_own_network_gets_its_icon_from_there(icons, site, net):
    net.names.update({'nas.lan': ['192.168.178.40'], 'printer.lan': ['192.168.178.41']})
    site.routes[('nas.lan', '/')] = reply(page('<link rel="icon" href="http://printer.lan/steal.png" sizes="128x128">', '<link rel="icon" href="/own.png" sizes="16x16">'))
    site.routes[('nas.lan', '/own.png')] = reply(png(16))
    site.routes[('printer.lan', '/steal.png')] = reply(png(64))
    assert icons._discover('http://nas.lan/') == ('image/png', png(16))
    assert net.opened == ['192.168.178.40', '192.168.178.40'] and site.paths('printer.lan') == []


@pytest.mark.parametrize('url', [
    'http://127.0.0.1:5050/api/hub/bookmarks', 'http://localhost:3000/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/', 'http://[fe80::1]/', 'http://224.0.0.1/',
])
def test_this_machine_and_link_local_addresses_are_never_asked(icons, site, net, url):
    net.names['localhost'] = ['127.0.0.1']
    assert icons._discover(url) is icons.MISSING
    assert net.opened == [] and site.seen == []


def test_a_site_that_cannot_be_reached_is_tried_again_soon_but_not_at_once(icons, site, net):
    assert icons._discover('http://nowhere.test/') is None
    assert icons.icon_for('http://nowhere.test/') is None
    assert not icons.ICON_DIR.exists() or not list(icons.ICON_DIR.iterdir())
    asked = len(net.asked)
    assert icons.icon_for('http://nowhere.test/') is None and len(net.asked) == asked
    net.names['nowhere.test'] = [PUBLIC]
    site.routes[('nowhere.test', '/favicon.ico')] = reply(png())
    icons._unreachable.update({key: 0.0 for key in icons._unreachable})
    assert icons.icon_for('http://nowhere.test/').kind == 'image/png'


def test_a_site_that_keeps_us_waiting_is_given_up_in_time(icons, site, net, monkeypatch):
    monkeypatch.setattr(icons, 'TIMEOUT', 0.3)
    monkeypatch.setattr(icons, 'BUDGET', 0.6)

    def dawdle(handler):
        time.sleep(2)
        return reply(png())

    site.routes['/'] = dawdle
    site.routes['/favicon.ico'] = dawdle
    started = time.monotonic()
    assert icons._discover('http://site.test/') is None
    assert time.monotonic() - started < 1.8


def test_slow_icons_use_up_the_time_one_site_gets(icons, site, net, monkeypatch):
    monkeypatch.setattr(icons, 'TIMEOUT', 0.4)
    monkeypatch.setattr(icons, 'BUDGET', 0.8)

    def dawdle(handler):
        time.sleep(2)
        return reply(png())

    site.routes['/'] = reply(page(*[f'<link rel="icon" href="/slow-{index}.png">' for index in range(3)]))
    for index in range(3):
        site.routes[f'/slow-{index}.png'] = dawdle
    site.routes['/favicon.ico'] = dawdle
    assert icons._discover('http://site.test/') is icons.MISSING
    assert len(site.seen) <= 4


def test_a_site_that_sends_its_answer_drop_by_drop_is_given_up_in_time(icons, site, net, monkeypatch):
    monkeypatch.setattr(icons, 'TIMEOUT', 0.3)
    monkeypatch.setattr(icons, 'BUDGET', 0.6)

    def drip(handler):
        try:
            handler.send_response(200)
            handler.end_headers()
            for _ in range(30):
                handler.wfile.write(png())
                handler.wfile.flush()
                time.sleep(0.1)
        except OSError:
            pass

    site.routes['/'] = drip
    site.routes['/favicon.ico'] = drip
    started = time.monotonic()
    assert icons._discover('http://site.test/') is None
    assert time.monotonic() - started < 1.8


def test_an_icon_is_fetched_once_and_then_comes_from_the_folder(icons, site, net):
    site.routes['/favicon.ico'] = reply(png())
    first = icons.icon_for('http://site.test/')
    assert first.kind == 'image/png' and first.path.read_bytes() == png() and first.path.parent == icons.ICON_DIR
    asked = len(site.seen)
    assert icons.icon_for('http://site.test/#later') == first
    wait_until_idle(icons)
    assert len(site.seen) == asked and not list(icons.ICON_DIR.glob('*.tmp'))


def test_a_site_without_an_icon_is_remembered_until_someone_asks_again(icons, site, net):
    assert icons.icon_for('http://site.test/') is None
    asked = len(site.seen)
    assert asked == 2 and icons.icon_for('http://site.test/') is None
    wait_until_idle(icons)
    assert len(site.seen) == asked
    site.routes['/favicon.ico'] = reply(SVG)
    icons.retry('http://site.test/')
    found = icons.icon_for('http://site.test/')
    assert found.kind == 'image/svg+xml' and [path.suffix for path in icons.ICON_DIR.iterdir()] == ['.svg']


def test_an_old_icon_stays_on_screen_while_a_new_one_is_fetched(icons, site, net):
    site.routes['/favicon.ico'] = reply(png())
    old = icons.icon_for('http://site.test/')
    aged = time.time() - icons.FRESH - 60
    os.utime(old.path, (aged, aged))

    def slowly(handler):
        time.sleep(0.5)
        return reply(SVG)

    site.routes['/favicon.ico'] = slowly
    started = time.monotonic()
    assert icons.icon_for('http://site.test/') == old and time.monotonic() - started < 0.3
    wait_until_idle(icons)
    new = icons.icon_for('http://site.test/')
    assert new.kind == 'image/svg+xml' and new.path.read_bytes() == SVG and not old.path.exists()


def test_an_old_icon_is_kept_when_the_site_has_none_any_more(icons, site, net):
    site.routes['/favicon.ico'] = reply(png())
    old = icons.icon_for('http://site.test/')
    aged = time.time() - icons.FRESH - 60
    os.utime(old.path, (aged, aged))
    del site.routes['/favicon.ico']
    assert icons.icon_for('http://site.test/', wait=0) == old
    wait_until_idle(icons)
    asked = len(site.seen)
    assert icons.icon_for('http://site.test/') == old and len(site.seen) == asked


def test_requests_at_the_same_moment_share_one_fetch(icons, site, net):
    def slowly(handler):
        time.sleep(0.3)
        return reply(png())

    site.routes['/favicon.ico'] = slowly
    found = []
    threads = [threading.Thread(target=lambda: found.append(icons.icon_for('http://site.test/'))) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert len(found) == 6 and len({icon.path for icon in found}) == 1
    assert site.paths().count('/favicon.ico') == 1


def test_a_request_does_not_wait_for_a_slow_site(icons, site, net):
    def slowly(handler):
        time.sleep(0.6)
        return reply(png())

    site.routes['/favicon.ico'] = slowly
    started = time.monotonic()
    assert icons.icon_for('http://site.test/', wait=0.05) is None
    assert time.monotonic() - started < 0.5
    wait_until_idle(icons)
    assert icons.icon_for('http://site.test/', wait=0).kind == 'image/png'


def test_forgetting_spares_a_page_another_bookmark_still_shows(icons, site, net):
    site.routes['/favicon.ico'] = reply(png())
    icon = icons.icon_for('http://site.test/a')
    icons.forget('http://site.test/a', still_used=['https://elsewhere.test/', 'http://site.test/a#part'])
    assert icon.path.exists()
    icons.forget('http://site.test/a', still_used=['https://elsewhere.test/'])
    assert not icon.path.exists()
    icons.forget('not an address')


def certificate(folder, name):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.now(timezone.utc)
    signed = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    path = folder / 'site.pem'
    path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())
        + signed.public_bytes(serialization.Encoding.PEM)
    )
    return path


def test_the_certificate_must_fit_the_name_although_the_address_is_fixed(icons, net, tmp_path, monkeypatch):
    proof = certificate(tmp_path, 'secure.test')
    served = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    served.load_cert_chain(proof)
    secure = Site(tls=served)
    try:
        net.port = secure.port
        net.names.update({'secure.test': [PUBLIC], 'other.test': [PUBLIC]})
        trusting = ssl.create_default_context(cafile=str(proof))
        monkeypatch.setattr(icons, '_tls', lambda: trusting)
        secure.routes['/favicon.ico'] = reply(png())
        assert icons._discover('https://secure.test/') == ('image/png', png())
        assert icons._discover('https://other.test/') is None
        assert secure.paths('other.test') == []
        monkeypatch.setattr(icons, '_tls', ssl.create_default_context)
        assert icons._discover('https://secure.test/') is None
    finally:
        secure.close()


@pytest.fixture
def hub(tmp_path, monkeypatch, icons):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    from app import app as hub

    monkeypatch.setattr(hub, 'DESKTOP_TOKEN', None)
    hub.app.config['TESTING'] = True
    return hub


@pytest.fixture
def client(hub):
    with hub.app.test_client() as client:
        client.get(f'/hub?token={hub.API_TOKEN}')
        yield client


def bookmark(client, url, title='Seite'):
    created = client.post('/api/hub/bookmarks', json={'title': title, 'url': url}).get_json()
    return created['bookmark']['id']


def test_the_icon_of_a_bookmark_is_served_as_an_image_that_can_do_nothing(client, site, net):
    site.routes['/favicon.ico'] = reply(SVG, Content_Type='text/html')
    response = client.get(f"/api/hub/bookmarks/{bookmark(client, 'http://site.test/')}/icon?v=1")
    assert response.status_code == 200 and response.data == SVG
    assert response.headers['Content-Type'].startswith('image/svg+xml')
    assert response.headers['Content-Security-Policy'] == "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.headers['Cache-Control'] == 'private, max-age=604800'
    again = client.get(response.request.path, headers={'If-None-Match': response.headers['ETag']})
    assert again.status_code == 304 and again.data == b''


def test_a_bookmark_without_an_icon_answers_not_found_and_is_asked_again_next_time(client, site, net):
    response = client.get(f"/api/hub/bookmarks/{bookmark(client, 'http://site.test/')}/icon")
    assert response.status_code == 404 and response.data == b'' and response.headers['Cache-Control'] == 'no-store'
    unknown = client.get('/api/hub/bookmarks/987654/icon')
    assert unknown.status_code == 404 and site.paths().count('/favicon.ico') == 1


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'http://127.0.0.1:5050/api/hub/bookmarks', 'kein link'])
def test_a_bookmark_that_is_no_web_address_has_no_icon_and_asks_nobody(client, site, net, url):
    assert client.get(f'/api/hub/bookmarks/{bookmark(client, url)}/icon').status_code == 404
    assert net.opened == []


def test_the_icon_is_only_for_the_signed_in_app_itself(hub, client, site, net):
    site.routes['/favicon.ico'] = reply(png())
    path = f"/api/hub/bookmarks/{bookmark(client, 'http://site.test/')}/icon"
    assert client.get(path, headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    with hub.app.test_client() as stranger:
        assert stranger.get(path).status_code == 401
    assert site.seen == []


def test_saving_a_bookmark_lets_a_missing_icon_be_tried_again(client, site, net):
    number = bookmark(client, 'http://site.test/')
    assert client.get(f'/api/hub/bookmarks/{number}/icon').status_code == 404
    site.routes['/favicon.ico'] = reply(png())
    assert client.get(f'/api/hub/bookmarks/{number}/icon').status_code == 404
    client.put(f'/api/hub/bookmarks/{number}', json={'title': 'Neu'})
    assert client.get(f'/api/hub/bookmarks/{number}/icon').data == png()


def test_changing_or_deleting_a_bookmark_drops_the_icon_nobody_shows_any_more(client, icons, site, net):
    net.names['second.test'] = [PUBLIC]
    site.routes['/favicon.ico'] = reply(png())
    first, twin = bookmark(client, 'http://site.test/'), bookmark(client, 'http://site.test/#twin')
    other = bookmark(client, 'http://second.test/')
    for number in (first, twin, other):
        assert client.get(f'/api/hub/bookmarks/{number}/icon').status_code == 200
    assert len(list(icons.ICON_DIR.iterdir())) == 2
    client.delete(f'/api/hub/bookmarks/{first}')
    assert len(list(icons.ICON_DIR.iterdir())) == 2
    client.put(f'/api/hub/bookmarks/{twin}', json={'url': 'http://second.test/'})
    assert [path.name for path in icons.ICON_DIR.iterdir()] == [icons._key('http://second.test/') + '.png']
    client.delete(f'/api/hub/bookmarks/{twin}')
    client.delete(f'/api/hub/bookmarks/{other}')
    assert list(icons.ICON_DIR.iterdir()) == []


def test_the_bookmark_page_asks_the_app_and_no_outside_service_for_icons(client):
    text = client.get('/hub/bookmarks').get_data(as_text=True)
    assert '/api/hub/bookmarks/${b.id}/icon' in text
    assert 's2/favicons' not in text


def test_the_script_of_the_older_pages_leaves_the_bookmark_form_alone():
    script = (ROOT / 'app' / 'static' / 'js' / 'hub.js').read_text(encoding='utf-8')
    assert 'bookmarkForm' not in script and 's2/favicons' not in script and "setItem('hub_bookmarks'" not in script
