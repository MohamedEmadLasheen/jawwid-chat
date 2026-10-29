import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_lesson_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';

import 'test_server.dart';

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token';
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-15 / PD-50 on the wire: what a teacher or staff card reader fetches from
/// `GET /lessons/:id` -- the outcome note, the excuse category and a family's
/// late-apology words (`ruling.reason`), with blanks read as absent. Proves the client
/// reads the fields; proves nothing about who the server shows them to.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ApiClient client() => buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _Tokens());

  test('reads the note, the category and the ruling\'s reason', () async {
    server.on('GET', '/lessons/l1', [
      const Reply.ok({
        'id': 'l1',
        'outcomeNote': 'Out of town',
        'excuseCategory': 'travel',
        'ruling': {
          'id': 'r1', 'kind': 'late_apology', 'reason': 'Our flight was delayed.', 'openedAt': '2026-10-27T14:00:00.000Z',
          'decision': null, 'decisionNote': null, 'decidedAt': null,
        },
      }),
    ]);
    final d = await HttpLessonRepository(client: client()).staffDetails('l1');
    expect((d.note, d.category, d.familyWords), ('Out of town', 'travel', 'Our flight was delayed.'));
  });

  test('withheld or blank fields are null', () async {
    server.on('GET', '/lessons/l2', [
      const Reply.ok({'id': 'l2', 'outcomeNote': '  ', 'excuseCategory': null, 'ruling': {'reason': ''}}),
    ]);
    final d = await HttpLessonRepository(client: client()).staffDetails('l2');
    expect((d.note, d.category, d.familyWords), (null, null, null));

    server.on('GET', '/lessons/l3', [const Reply.ok({'id': 'l3', 'ruling': null})]);
    final e = await HttpLessonRepository(client: client()).staffDetails('l3');
    expect((e.note, e.category, e.familyWords), (null, null, null));
  });
}
