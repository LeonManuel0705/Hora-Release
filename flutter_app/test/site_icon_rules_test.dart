// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:app/services/site_icon_rules.dart';

import 'site_icon_images.dart';

Uint8List page(List<String> links, {String after = ''}) =>
    Uint8List.fromList(utf8.encode('<!doctype html><html><head><meta charset="utf-8">${links.join()}</head><body><p>Hi</p></body></html>$after'));

List<String> names(List<String> urls) => [for (final url in urls) url.split('/').last];

void main() {
  test('only plain web addresses are ever asked', () {
    for (final url in [
      null, '', 'example.com', '//example.com/a.png', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)',
      'data:image/png;base64,AAAA', 'http://', 'http://[', 'http://user@example.com/', 'http://user:secret@example.com/',
      'http://example.com\\@evil.example/', 'http://exam\nple.com/', 'http://example.com:port/', 'http://straße.de/',
      'http://exa mple.com/', 'https://müller.de/',
    ]) {
      expect(iconTarget(url), isNull, reason: '$url');
    }
  });

  test('an address is brought into one form', () {
    List<Object> parts(String url) {
      final target = iconTarget(url)!;
      return [target.scheme, target.host, target.port, target.path];
    }

    expect(parts('HTTPS://Example.COM'), ['https', 'example.com', 443, '/']);
    expect(parts('http://example.com:8080/a b?q=1&x=2#top'), ['http', 'example.com', 8080, '/a%20b?q=1&x=2']);
    expect(parts('  https://example.com/weg  '), ['https', 'example.com', 443, '/weg']);
    expect(parts('http://[2001:db8::1]:8000/x'), ['http', '2001:db8::1', 8000, '/x']);
    expect(iconTarget('http://[2001:db8::1]:8000/x')!.origin, 'http://[2001:db8::1]:8000');
    expect(iconTarget('https://Example.com/a#one')!.address, iconTarget('https://example.com:443/a#two')!.address);
  });

  test('every address is sorted into open internet, own network or never', () {
    const expected = {
      IconReach.public: ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2002:808:808::1'],
      IconReach.local: [
        '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.178.1', '100.64.0.1', '100.127.255.254', 'fd12:3456:789a::1',
        '::ffff:192.168.1.1', '2002:c0a8:101::1', '64:ff9b::a00:1',
      ],
      IconReach.never: [
        '127.0.0.1', '127.8.9.10', '::1', '0.0.0.0', '::', '0.1.2.3', '169.254.169.254', '169.254.1.1', 'fe80::1', '224.0.0.1',
        'ff02::1', '240.0.0.1', '255.255.255.255', '192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1', '2001:db8::1',
        '::ffff:127.0.0.1', '::ffff:169.254.169.254', '2002:7f00:1::1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2001::1',
        'fec0::1', '4000::1',
      ],
    };
    for (final entry in expected.entries) {
      for (final address in entry.value) {
        expect(iconReach(InternetAddress(address).rawAddress), entry.key, reason: address);
      }
    }
    expect(iconReach(const [1, 2, 3]), IconReach.never);
  });

  test('the sharpest favicon comes first', () {
    final body = page([
      '<link rel="shortcut icon" href="https://www.site.test/img/favicon.ico" type="image/x-icon">',
      '<link rel="icon" href="https://www.site.test/img/favicon_32x32.png" sizes="32x32">',
      '<link rel="icon" href="https://www.site.test/img/favicon_48x48.png" sizes="48x48">',
      '<link rel="icon" href="https://www.site.test/img/favicon_96x96.png" sizes="96x96">',
      '<link rel="icon" href="https://www.site.test/img/favicon_144x144.png" sizes="144x144">',
    ]);
    expect(names(declaredIcons(body, 'https://www.site.test/')),
        ['favicon_144x144.png', 'favicon_96x96.png', 'favicon_48x48.png', 'favicon_32x32.png', 'favicon.ico']);
  });

  test('a vector is left out, the home screen icon beats the ico', () {
    final body = page([
      '<link rel="icon" href="/favicon.ico" sizes="any">',
      '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
      '<link rel="icon" href="/vector" type="image/svg+xml">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<link rel="apple-touch-icon" sizes="120x120" href="/touch-120.png">',
      '<link rel="alternate icon" type="image/png" href="/favicon.png">',
    ]);
    expect(declaredIcons(body, 'https://site.test/deep/page'), [
      'https://site.test/apple-touch-icon.png', 'https://site.test/touch-120.png', 'https://site.test/favicon.png',
      'https://site.test/favicon.ico',
    ]);
  });

  test('addresses in a page are read the way a browser reads them', () {
    final body = page([
      '<BASE HREF="https://cdn.site.test/assets/">',
      "<LINK REL='Icon Shortcut' HREF='a.png?x=1&amp;y=2' SIZES='64x64'>",
      '<link href=//other.test/b.png rel=icon sizes=72x72>',
      '<link rel="icon" sizes="80x80" href="  /c.png  " />',
      '<link rel="icon" rel="stylesheet" sizes="96x96" href="d.png" href="ignored.png">',
    ]);
    expect(declaredIcons(body, 'https://site.test/page'), [
      'https://cdn.site.test/assets/d.png', 'https://cdn.site.test/c.png', 'https://other.test/b.png',
      'https://cdn.site.test/assets/a.png?x=1&y=2',
    ]);
  });

  test('what is no icon of the page is left out', () {
    final body = page([
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
      '<link rel="icon" href="/dark.png" sizes="128x128" media="(prefers-color-scheme: dark)">',
    ], after: '<link rel="icon" href="/in-the-body.png">');
    expect(declaredIcons(body, 'https://site.test/'), isEmpty);
  });

  test('an icon for a light browser stays in', () {
    final body = page([
      '<link rel="icon" href="/light.png" sizes="96x96" media="(prefers-color-scheme: light)">',
      '<link rel="icon" href="/also-light.png" sizes="64x64" media="not (prefers-color-scheme: dark)">',
    ]);
    expect(names(declaredIcons(body, 'https://site.test/')), ['light.png', 'also-light.png']);
  });

  test('a page built to keep a reader busy is done in no time', () {
    for (final piece in ['<link ', '<!--', '<script', '<link rel="icon" href="', '<', '<base href=']) {
      final body = Uint8List.fromList(utf8.encode(piece * (256 * 1024 ~/ piece.length)));
      final watch = Stopwatch()..start();
      declaredIcons(body, 'https://site.test/');
      expect(watch.elapsed, lessThan(const Duration(seconds: 3)), reason: piece);
    }
  });

  test('an image is known by its bytes', () {
    expect(imageKind(iconImage('png')), 'png');
    expect(imageKind(iconImage('gif')), 'gif');
    expect(imageKind(iconImage('icoPng')), 'ico');
    expect(imageKind(iconImage('icoBmp')), 'ico');
    expect(imageKind(iconImage('jpg')), 'jpg');
    expect(imageKind(iconImage('webp')), 'webp');
  });

  test('what is no image, a vector or only a tracking pixel is no icon', () {
    final pixel = [...iconImage('png')];
    pixel.setRange(16, 24, const [0, 0, 0, 1, 0, 0, 0, 1]);
    final dot = [...iconImage('gif')];
    dot.setRange(6, 10, const [1, 0, 1, 0]);
    final speck = [...iconImage('icoBmp')];
    speck[6] = 1;
    final empty = [...iconImage('icoBmp')];
    empty.setRange(4, 6, const [0, 0]);
    for (final body in [
      <int>[], utf8.encode('<!doctype html><html></html>'), utf8.encode('{"error": "not found"}'),
      utf8.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), pixel, dot, speck, empty,
      const [0, 0, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ascii.encode('GIF89a'), ascii.encode('RIFF1234WAVE'),
    ]) {
      expect(imageKind(body), isNull, reason: '${body.take(12).toList()}');
    }
  });
}
