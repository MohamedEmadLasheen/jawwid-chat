/// `/scheduled-calls` on the wire (PD-13), and the history row's direction.
///
/// A real loopback server stands in for the API, as in
/// `account_call_history_test.dart`. It proves what the client sends and how it
/// reads the documented DTOs; it proves nothing about the real server.
///
/// No widget binding, deliberately: `TestWidgetsFlutterBinding` installs an
/// `HttpOverrides` that answers every real request with a 400.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/calls/data/fake_scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/data/http_account_call_history.dart';
import 'package:jawwid_chat/features/calls/data/http_scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';

import '../../core/data/http/test_server.dart';

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'fake-access-token';
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

Map<String, Object?> dto({
  String id = 'sc_1',
  String kind = 'scheduled',
  String state = 'upcoming',
  Object? title = 'Weekly review',
  bool canCancel = true,
}) => {
  'id': id,
  'conversationId': 'conv_1',
  'kind': kind,
  'title': title,
  'startsAt': '2026-10-20T15:00:00.000Z',
  'joinableFrom': '2026-10-20T14:50:00.000Z',
  'joinableUntil': '2026-10-20T17:00:00.000Z',
  'state': state,
  'createdBy': {'actorId': 'actor_1', 'displayName': 'Ms. Dina'},
  'canCancel': canCancel,
};

void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ApiClient client() => buildApiClient(
    config: ApiConfig(baseUrl: server.baseUrl),
    tokens: _Tokens(),
  );

  HttpScheduledCallRepository repository() =>
      HttpScheduledCallRepository(client: client());

  group('scheduled calls', () {
    test(
      'GET /scheduled-calls parses the server\'s list in its order',
      () async {
        server.on('GET', '/scheduled-calls', [
          Reply.ok({
            'items': [
              dto(id: 'b', state: 'open'),
              dto(id: 'a', kind: 'link', title: null),
            ],
          }),
        ]);

        final items = await repository().upcoming();

        expect(items.map((c) => c.id), ['b', 'a']);
        expect(items.first.state, ScheduledCallState.open);
        expect(items.first.title, 'Weekly review');
        expect(items.first.createdByName, 'Ms. Dina');
        expect(items.first.canCancel, isTrue);
        expect(items.first.startsAt, DateTime.utc(2026, 10, 20, 15).toLocal());
        expect(items.last.kind, ScheduledCallKind.link);
        expect(items.last.title, isNull);
      },
    );

    test('a row it cannot read refuses the whole list', () async {
      final broken = dto()..remove('joinableUntil');
      server.on('GET', '/scheduled-calls', [
        Reply.ok({
          'items': [dto(), broken],
        }),
      ]);

      await expectLater(
        repository().upcoming(),
        throwsA(
          isA<AppError>().having(
            (e) => e.code,
            'code',
            'malformed_scheduled_call',
          ),
        ),
      );
    });

    test('an unknown state or kind is refused, not guessed', () async {
      server.on('GET', '/scheduled-calls', [
        Reply.ok({
          'items': [dto(state: 'paused')],
        }),
      ]);
      await expectLater(repository().upcoming(), throwsA(isA<AppError>()));
    });

    test('POST /scheduled-calls sends the conversation, kind, UTC start and trimmed title', () async {
      server.on('POST', '/scheduled-calls', [Reply.ok(dto())]);
      final at = DateTime(2026, 10, 20, 18, 30);

      await repository().create(
        conversationId: 'conv_1',
        kind: ScheduledCallKind.scheduled,
        startsAt: at,
        title: '  Weekly review  ',
      );

      final body = server.lastRequestTo('POST', '/scheduled-calls')!.json;
      expect(body['conversationId'], 'conv_1');
      expect(body['kind'], 'scheduled');
      expect(body['startsAt'], at.toUtc().toIso8601String());
      expect(body['title'], 'Weekly review');
      // Nothing that names a person or a number travels from the client.
      expect(
        body.keys,
        unorderedEquals(['conversationId', 'kind', 'startsAt', 'title']),
      );
    });

    test('a link sends no start and no empty title', () async {
      server.on('POST', '/scheduled-calls', [Reply.ok(dto(kind: 'link'))]);

      await repository().create(
        conversationId: 'conv_1',
        kind: ScheduledCallKind.link,
        title: '  ',
      );

      final body = server.lastRequestTo('POST', '/scheduled-calls')!.json;
      expect(body, {'conversationId': 'conv_1', 'kind': 'link'});
    });

    test('a refusal arrives with its code', () async {
      server.on('POST', '/scheduled-calls', [
        Reply.commError(403, ScheduledCallCodes.parentCannotStartGroupCall),
      ]);

      await expectLater(
        repository().create(
          conversationId: 'conv_1',
          kind: ScheduledCallKind.link,
        ),
        throwsA(
          isA<AppError>().having(
            (e) => e.code,
            'code',
            ScheduledCallCodes.parentCannotStartGroupCall,
          ),
        ),
      );
    });

    test('POST /:id/join reads both modes', () async {
      server.on('POST', '/scheduled-calls/sc_1/join', [
        const Reply.ok({
          'callId': 'call_1',
          'conversationId': 'conv_1',
          'mode': 'started',
        }),
        const Reply.ok({
          'callId': 'call_1',
          'conversationId': 'conv_1',
          'mode': 'joined',
        }),
      ]);

      expect((await repository().join('sc_1')).mode, ScheduledJoinMode.started);
      expect((await repository().join('sc_1')).mode, ScheduledJoinMode.joined);
    });

    test('a join answer without a mode is refused', () async {
      server.on('POST', '/scheduled-calls/sc_1/join', [
        const Reply.ok({'callId': 'call_1', 'conversationId': 'conv_1'}),
      ]);
      await expectLater(repository().join('sc_1'), throwsA(isA<AppError>()));
    });

    test('409 not joinable keeps its code', () async {
      server.on('POST', '/scheduled-calls/sc_1/join', [
        Reply.commError(409, ScheduledCallCodes.notJoinable),
      ]);
      await expectLater(
        repository().join('sc_1'),
        throwsA(
          isA<AppError>().having(
            (e) => e.code,
            'code',
            ScheduledCallCodes.notJoinable,
          ),
        ),
      );
    });

    test('POST /:id/cancel', () async {
      server.on('POST', '/scheduled-calls/sc_1/cancel', [
        Reply.ok(dto(state: 'cancelled')),
      ]);

      final cancelled = await repository().cancel('sc_1');

      expect(cancelled.state, ScheduledCallState.cancelled);
      expect(server.countOf('POST', '/scheduled-calls/sc_1/cancel'), 1);
    });
  });

  group('the account history row\'s direction', () {
    Map<String, Object?> row(String? initiatorId) => {
      'id': 'call_1',
      'conversationId': 'conv_1',
      'type': 'direct',
      'status': 'ended',
      'outcome': 'answered',
      'initiatorId': initiatorId,
      'startedAt': '2026-09-28T10:00:00.000Z',
      'durationSeconds': 60,
      'participants': const [],
    };

    Future<CallHistoryDirection?> directionFor(
      String? initiatorId, {
      String viewer = 'viewer',
    }) async {
      server.on('GET', '/calls/history', [
        Reply.ok({
          'items': [row(initiatorId)],
          'nextCursor': null,
        }),
      ]);
      final page = await HttpAccountCallHistory(
        client: client(),
        viewerActorId: () => viewer,
      ).page();
      return page.items.single.direction;
    }

    test('outgoing when the viewer placed it', () async {
      expect(await directionFor('viewer'), CallHistoryDirection.outgoing);
    });

    test('incoming when somebody else did', () async {
      expect(await directionFor('actor_other'), CallHistoryDirection.incoming);
    });

    test('unknown, not guessed, when the row names no initiator', () async {
      expect(await directionFor(null), isNull);
    });

    test('unknown before a session exists', () async {
      expect(await directionFor('actor_other', viewer: ''), isNull);
    });
  });

  group('the fixture repository mirrors the window', () {
    test('a link is joinable at once; the second Join takes a seat', () async {
      var started = 0;
      final repo = FakeScheduledCallRepository(
        startCall: (_) async => 'call_${++started}',
      );

      final link = await repo.create(
        conversationId: 'conv_1',
        kind: ScheduledCallKind.link,
      );
      expect(link.state, ScheduledCallState.open);

      expect((await repo.join(link.id)).mode, ScheduledJoinMode.started);
      expect((await repo.join(link.id)).mode, ScheduledJoinMode.joined);
      expect(started, 1);
    });

    test(
      'a call tomorrow is not joinable today, and a cancelled one never is',
      () async {
        final now = DateTime(2026, 10, 19, 12);
        final repo = FakeScheduledCallRepository(
          startCall: (_) async => 'call',
          clock: () => now,
        );

        final later = await repo.create(
          conversationId: 'conv_1',
          kind: ScheduledCallKind.scheduled,
          startsAt: now.add(const Duration(days: 1)),
        );
        expect(later.state, ScheduledCallState.upcoming);
        await expectLater(
          repo.join(later.id),
          throwsA(
            isA<AppError>().having(
              (e) => e.code,
              'code',
              ScheduledCallCodes.notJoinable,
            ),
          ),
        );

        await repo.cancel(later.id);
        expect(await repo.upcoming(), isEmpty);
      },
    );
  });
}
