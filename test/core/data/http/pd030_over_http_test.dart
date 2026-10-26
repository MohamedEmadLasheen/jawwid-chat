import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_billing_repository.dart';
import 'package:jawwid_chat/core/data/http/http_lesson_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
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

/// PD-30 on the wire, against a REAL HTTP server on loopback: the renewal request, the
/// lesson total beside the suggested number, a report's kept total, and the Schedule's
/// payment hold. Proves the client speaks `docs/admin/pd030-subscriptions.md`; proves
/// nothing about the server.
///
/// No widget binding here: `TestWidgetsFlutterBinding` answers real requests with 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ApiClient client() => buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _Tokens());

  group('POST /me/subscriptions/:learnerId/renewal-request', () {
    test('201: sent once, for that child', () async {
      server.on('POST', '/me/subscriptions/k1/renewal-request', [const Reply(201, {'id': 'rr1'})]);
      await HttpBillingRepository(client: client()).requestRenewal('k1');
      expect(server.countOf('POST', '/me/subscriptions/k1/renewal-request'), 1);
    });

    test('409 the second time a day: the code reaches the caller', () async {
      server.on('POST', '/me/subscriptions/k1/renewal-request', [Reply.commError(409, BillingErrors.subscriptionState)]);
      await expectLater(
        HttpBillingRepository(client: client()).requestRenewal('k1'),
        throwsA(isA<AppError>().having((e) => e.code, 'code', BillingErrors.subscriptionState)),
      );
    });
  });

  group('Lesson N of M', () {
    test('a report ticket carries the total beside the number', () async {
      server.on('GET', '/conversations/c1/lesson-tickets', [
        const Reply.ok({
          'tickets': [
            {
              'ticket': 'report',
              'lessonId': 'l1',
              'learner': {'id': 'k1', 'name': 'Adam'},
              'startsAt': '2026-10-26T14:00:00.000Z',
              'endsAt': '2026-10-26T14:30:00.000Z',
              'suggestedLessonNumber': 2,
              'suggestedLessonTotal': 24,
            },
            {
              'ticket': 'report',
              'lessonId': 'l2',
              'learner': {'id': 'k2', 'name': 'Sara'},
              'startsAt': '2026-10-26T15:00:00.000Z',
              'endsAt': '2026-10-26T15:30:00.000Z',
              'suggestedLessonNumber': 5,
            },
          ],
        }),
      ]);
      final tickets = await HttpLessonRepository(client: client()).tickets('c1');
      expect(tickets.map((t) => (t.suggestedLessonNumber, t.suggestedLessonTotal)), [(2, 24), (5, null)]);
    });

    test('GET /lessons/:id: the ticket and the kept report both carry it', () async {
      final lesson = {
        'id': 'l1',
        'startsAt': '2026-10-26T14:00:00.000Z',
        'endsAt': '2026-10-26T14:30:00.000Z',
        'learner': {'id': 'k1', 'name': 'Adam'},
        'acts': ['report'],
        'suggestedLessonNumber': 2,
        'suggestedLessonTotal': 24,
        'report': {'lessonNumber': 1, 'lessonTotal': 24, 'coveredTopics': ['reading'], 'deletedAt': null},
      };
      server.on('GET', '/lessons/l1', [Reply.ok(lesson), Reply.ok(lesson)]);
      final repo = HttpLessonRepository(client: client());

      final offered = await repo.lessonTickets('l1');
      expect(offered.single.suggestedLessonTotal, 24);

      final kept = await repo.reportFor('l1');
      expect(kept!.lessonNumber, 1);
      expect(kept.lessonTotal, 24);
    });
  });

  test("the Schedule: a payment hold is 'suspended' for 'payment'", () async {
    server.on('GET', '/lessons', [
      const Reply.ok({
        'lessons': [
          {
            'id': 'l1',
            'learner': {'id': 'k1', 'name': 'Adam'},
            'startsAt': '2026-10-27T14:00:00.000Z',
            'endsAt': '2026-10-27T14:30:00.000Z',
            'kind': 'regular',
            'phase': 'upcoming',
            'outcome': 'suspended',
            'suspendedFor': 'payment',
          },
          {
            'id': 'l2',
            'learner': {'id': 'k2', 'name': 'Sara'},
            'startsAt': '2026-10-27T15:00:00.000Z',
            'endsAt': '2026-10-27T15:30:00.000Z',
            'kind': 'regular',
            'phase': 'upcoming',
          },
        ],
      }),
    ]);
    final lessons = await HttpLessonRepository(client: client()).myLessons(DateTime(2026, 10, 27), DateTime(2026, 10, 28));
    expect(lessons.map((l) => (l.outcome, l.suspendedFor)), [('suspended', 'payment'), (null, null)]);
  });
}
