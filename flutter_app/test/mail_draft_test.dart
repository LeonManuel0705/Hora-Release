// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:app/screens/desktop_webview_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the window hands only a mail draft to one address to the mail app', () {
    final draft = mailDraft('mailto:someone@example.org?subject=R%C3%BCckmeldung&body=Version%3A%200.5.2%0ABuild%3A%2040');
    expect(draft?.scheme, 'mailto');
    expect(draft?.queryParameters['subject'], 'Rückmeldung');
    expect(mailDraft('mailto:someone@example.org'), isNotNull);
    for (final value in <Object?>[
      'https://example.org/',
      'http://127.0.0.1:5050/hub',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'mailto:',
      'mailto:a@b.org,c@d.org',
      'mailto:a@b.org,c',
      'mailto:not an address',
      'mailto:%E0%A4%A',
      'tel:+4930',
      null,
      42,
      'mailto:a@b.org?body=${'x' * 9000}',
    ]) {
      expect(mailDraft(value), isNull, reason: '$value'.substring(0, '$value'.length.clamp(0, 40)));
    }
  });
}
