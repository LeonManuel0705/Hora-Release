// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';

import 'package:app/services/assistant/assistant_engine.dart';
import 'package:app/services/assistant/wiki_cache.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final engine = AssistantEngine.instance;
  final asked = <Uri>[];

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    asked.clear();
  });
  tearDown(() => WikiCacheService.instance.client = null);

  void answerWith(Future<http.Response> Function(http.Request request) reply) {
    WikiCacheService.instance.client = MockClient((request) {
      asked.add(request.url);
      return reply(request);
    });
  }

  http.Response article(String title, String extract) => http.Response(
        jsonEncode({
          'type': 'standard',
          'title': title,
          'extract': extract,
          'content_urls': {
            'desktop': {'page': 'https://de.wikipedia.org/wiki/${title.replaceAll(' ', '_')}'},
          },
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );

  test('a name with spaces reaches Wikipedia as one title and is encoded once', () {
    expect(WikiCacheService.summaryUri('de', 'Rosa Luxemburg').toString(),
        'https://de.wikipedia.org/api/rest_v1/page/summary/Rosa_Luxemburg');
    expect(WikiCacheService.summaryUri('en', 'AC/DC').toString(), 'https://en.wikipedia.org/api/rest_v1/page/summary/AC%2FDC');
    expect(WikiCacheService.summaryUri('de', 'Émile Zola').path, '/api/rest_v1/page/summary/%C3%89mile_Zola');
    expect(WikiCacheService.extractUri('de', 'Rosa Luxemburg').queryParameters['titles'], 'Rosa Luxemburg');
  });

  test('a person with a two-word name is found', () async {
    answerWith((request) async => request.url.path.endsWith('/api.php')
        ? http.Response(jsonEncode({'query': {'pages': {}}}), 200)
        : article('Rosa Luxemburg', 'Rosa Luxemburg war eine Politikerin und Theoretikerin.'));
    final answer = await engine.answer('Wer war Rosa Luxemburg?');
    expect(answer.source, AssistantSource.wikipedia);
    expect(answer.text, contains('Theoretikerin'));
    expect(asked.first.toString(), 'https://de.wikipedia.org/api/rest_v1/page/summary/Rosa_Luxemburg');
  });

  test('only when both wikis say there is no article, the answer says so', () async {
    answerWith((_) async => http.Response('{}', 404));
    final answer = await engine.answer('Wer war Kunibert Blumentopf?');
    expect(answer.text, contains('keinen Wikipedia-Eintrag'));
    expect(asked.map((uri) => uri.host), ['de.wikipedia.org', 'en.wikipedia.org']);
  });

  test('a blocked or failed request is not passed off as a missing article', () async {
    for (final failure in <Future<http.Response> Function(http.Request)>[
      (_) async => throw http.ClientException('Refused to connect because of the content security policy'),
      (_) async => http.Response('busy', 503),
      (request) async => request.url.host.startsWith('de.') ? http.Response('{}', 404) : throw http.ClientException('offline'),
    ]) {
      answerWith(failure);
      final answer = await engine.answer('Wer war Clara Zetkin?');
      expect(answer.text, contains('Wikipedia ist gerade nicht erreichbar'));
      expect(answer.text, isNot(contains('keinen Wikipedia-Eintrag')));
    }
  });

  test('without internet the answer says why nothing was looked up', () async {
    answerWith((_) async => fail('no request offline'));
    final answer = await engine.answer('Wer war Hedwig Dohm?', online: false);
    expect(answer.text, contains('Ohne Internet'));
  });

  test('a question that is not about a person or term does not blame the internet', () async {
    final answer = await engine.answer('Magst du lieber Katzen oder Hunde?');
    expect(answer.text, isNot(contains('Internet')));
  });

  test('with the language model, an unreachable Wikipedia leaves the question to the model', () async {
    final answer = await engine.answerExact('Wer war Ada Lovelace?', online: true, lookup: (_) async => throw const WikiUnreachable());
    expect(answer, isNull);
  });
}
