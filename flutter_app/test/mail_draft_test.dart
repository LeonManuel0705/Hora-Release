// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:app/screens/desktop_webview_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the window hands only a feedback draft to the published address to the mail app', () {
    final draft = mailDraft('mailto:horaapp.team@gmail.com?subject=R%C3%BCckmeldung&body=Version%3A%200.5.2%0ABuild%3A%2040');
    expect(draft?.scheme, 'mailto');
    expect(draft?.queryParameters['subject'], 'Rückmeldung');
    expect(mailDraft('mailto:horaapp.team@gmail.com'), isNotNull);
    for (final value in <Object?>[
      'mailto:someone@example.org?subject=x',
      'mailto:horaapp.team@gmail.com?subject=x&bcc=someone@example.org',
      'mailto:horaapp.team@gmail.com?cc=someone@example.org',
      'mailto:horaapp.team@gmail.com?to=someone@example.org',
      'mailto:horaapp.team@gmail.com?attach=C:/Users/user/secret.txt',
      'mailto:horaapp.team@gmail.com?Subject=x',
      'mailto:horaapp.team@gmail.com#x',
      'mailto:horaapp.team@gmail.com,someone@example.org',
      'https://example.org/',
      'http://127.0.0.1:5050/hub',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'mailto:',
      'mailto:%E0%A4%A',
      'tel:+4930',
      null,
      42,
      'mailto:horaapp.team@gmail.com?body=${'x' * 9000}',
    ]) {
      expect(mailDraft(value), isNull, reason: '$value'.substring(0, '$value'.length.clamp(0, 60)));
    }
  });
}
