import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/rewards/data/rewards_repository.dart';
import 'package:jawwid_chat/features/rewards/domain/rewards.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'token';
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-55 PR-4: the reward routes, as the teacher's tray calls them.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpRewardsRepository repo() =>
      HttpRewardsRepository(client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _NoTokens()));

  test('the lessons on now are read for the tray', () async {
    server.on('GET', '/teacher/rewards/now', [
      const Reply.ok({
        'lessons': [
          {'lessonId': 'l1', 'learnerId': 'a', 'learnerName': 'Adam', 'startsAt': 'x', 'endsAt': 'y', 'stars': 2},
        ],
      }),
    ]);
    final lessons = await repo().lessonsNow();
    expect([lessons.single.learnerName, lessons.single.stars], ['Adam', 2]);
  });

  test('a reward posts its lesson, its client id, its board and the gift -- and reads back the id and the stars', () async {
    server.on('POST', '/learners/a/rewards', [
      const Reply(201, {
        'event': {'id': 'e1', 'kind': 'sticker'},
        'stars': 3,
      }),
    ]);
    final r = await repo().give(learnerId: 'a', lessonId: 'l1', gift: const StickerGift(Sticker.rocket), clientEventId: 'c1', boardId: 'b1');
    expect([r.eventId, r.stars], ['e1', 3]);
    expect(server.requests.single.json, {'lessonId': 'l1', 'clientEventId': 'c1', 'boardId': 'b1', 'kind': 'sticker', 'stickerKey': 'rocket'});
  });

  test('undo posts to the reward\'s own route', () async {
    server.on('POST', '/learners/a/rewards/e1/undo', [const Reply(201, {'stars': 1})]);
    expect(await repo().undo(learnerId: 'a', eventId: 'e1'), 1);
  });

  test('a refusal (rewards off: 404) is an AppError, for the tray to say it was not recorded', () async {
    server.on('POST', '/learners/a/rewards', [Reply.commError(404, 'COMM.LESSON_NOT_FOUND')]);
    await expectLater(repo().give(learnerId: 'a', lessonId: 'l1', gift: const StarGift(), clientEventId: 'c1'), throwsA(isA<AppError>()));
  });
}
