/// The Calls tab's data path, on the wire (W8-W2).
///
/// TWO THINGS THIS FILE IS ABOUT.
///
/// 1. THE CLIENT DECIDES NOTHING. It sends one request to one endpoint and
///    renders what comes back. There is no `family_id` anywhere in it, no
///    per-conversation fan-out, no client-side merge, no client ordering and no
///    paging arithmetic — the server owns the actor's scope and the order, and
///    the assertions below are about the client NOT doing those things.
///
/// 2. IT FAILS CLOSED, MORE STRICTLY THAN ITS SIBLING. The per-conversation
///    parser in `HttpCallRepository` drops a row it cannot read, on purpose: one
///    bad row should not empty a history the user can see beside the thread.
///    This screen IS the record, so a quietly shortened list is
///    indistinguishable from a complete one — and every malformed shape below is
///    refused outright instead.
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
import 'package:jawwid_chat/features/calls/data/http_account_call_history.dart';

import '../../core/data/http/test_server.dart';

class _Tokens implements TokenProvider {
  _Tokens(this.token);
  final String? token;
  @override
  Future<String?> accessToken() async => token;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

Map<String, Object?> row({
  String id = 'call_1',
  String conversationId = 'conv_1',
  String outcome = 'answered',
  String type = 'direct',
  int? durationSeconds = 120,
  String startedAt = '2026-09-28T10:00:00.000Z',
}) =>
    {
      'id': id,
      'conversationId': conversationId,
      'type': type,
      'status': 'ended',
      'outcome': outcome,
      'initiatorId': 'actor_1',
      'startedAt': startedAt,
      'endedAt': '2026-09-28T10:02:00.000Z',
      'durationSeconds': durationSeconds,
      'participants': const [],
    };

void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpAccountCallHistory repository({String? token = 'fake-access-token'}) =>
      HttpAccountCallHistory(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _Tokens(token),
        ),
      );

  void reply(Reply r) => server.on('GET', '/calls/history', [r]);

  // =======================================================================
  group('3/4. the endpoint, and the shape it answers with', () {
    test('3. one request, to the account endpoint', () async {
      reply(Reply.ok({'items': [row()], 'nextCursor': null}));

      await repository().page();

      expect(server.countOf('GET', '/calls/history'), 1);
      final request = server.lastRequestTo('GET', '/calls/history')!;
      expect(request.method, 'GET');
      // No family, no actor, no scope of any kind travels from the client.
      expect(request.query.keys, isNot(contains('familyId')));
      expect(request.query.keys, isNot(contains('actorId')));
      expect(request.query.keys, isNot(contains('conversationId')));
    });

    test('4. items and nextCursor parse into a page', () async {
      reply(Reply.ok({
        'items': [row(id: 'call_a'), row(id: 'call_b', outcome: 'missed')],
        'nextCursor': 'opaque-cursor',
      }));

      final page = await repository().page();

      expect(page.items.map((e) => e.id), ['call_a', 'call_b']);
      expect(page.items.first.outcome, CallOutcome.answered);
      expect(page.items.last.outcome, CallOutcome.missed);
      expect(page.items.first.duration, const Duration(seconds: 120));
      expect(page.nextCursor, 'opaque-cursor');
      expect(page.hasMore, isTrue);
    });

    test('4b. a group call is marked as one', () async {
      reply(Reply.ok({'items': [row(type: 'group')], 'nextCursor': null}));

      final page = await repository().page();

      expect(page.items.single.isGroup, isTrue);
    });

    test('4c. a null duration stays null rather than becoming zero', () async {
      reply(Reply.ok({'items': [row(durationSeconds: null)], 'nextCursor': null}));

      final page = await repository().page();

      expect(page.items.single.duration, isNull);
    });

    test('7. an empty page is empty, not an error', () async {
      reply(const Reply.ok({'items': [], 'nextCursor': null}));

      final page = await repository().page();

      expect(page.items, isEmpty);
      expect(page.nextCursor, isNull);
      expect(page.hasMore, isFalse);
    });

    test('8. the final page carries no cursor', () async {
      reply(Reply.ok({'items': [row()], 'nextCursor': null}));

      final page = await repository().page();

      expect(page.nextCursor, isNull);
      expect(page.hasMore, isFalse);
    });

    test('8b. a cursor is sent back verbatim, and only when there is one',
        () async {
      reply(const Reply.ok({'items': [], 'nextCursor': null}));
      await repository().page(cursor: 'page-2');
      expect(server.lastRequestTo('GET', '/calls/history')!.query['cursor'], 'page-2');

      await repository().page();
      expect(
        server.lastRequestTo('GET', '/calls/history')!.query.containsKey('cursor'),
        isFalse,
      );
    });
  });

  // =======================================================================
  group('5. malformed responses fail closed', () {
    Future<void> refuses(Object? body) async {
      reply(Reply.ok(body));
      await expectLater(
        repository().page(),
        throwsA(
          isA<AppError>().having(
            (e) => e.code,
            'code',
            'malformed_account_call_history',
          ),
        ),
      );
    }

    test('missing items', () => refuses(const {'nextCursor': null}));
    test('items is not a list', () => refuses(const {'items': 'nope'}));
    test('an item is not an object', () => refuses(const {'items': ['nope']}));

    test('a row missing its id', () async {
      final bad = row()..remove('id');
      await refuses({'items': [bad], 'nextCursor': null});
    });

    test('a row missing its conversationId', () async {
      final bad = row()..remove('conversationId');
      await refuses({'items': [bad], 'nextCursor': null});
    });

    test('a row with an unparseable startedAt', () async {
      await refuses({
        'items': [row()..['startedAt'] = 'not-a-date'],
        'nextCursor': null,
      });
    });

    test('nextCursor is neither a string nor null', () async {
      await refuses({'items': [row()], 'nextCursor': 42});
    });

    test('one bad row refuses the WHOLE page, unlike the thread parser',
        () async {
      // The distinction this class exists to make: a silently shortened account
      // history looks exactly like a complete one.
      await refuses({
        'items': [row(id: 'good'), 'nope'],
        'nextCursor': null,
      });
    });
  });

  // =======================================================================
  group('6. server refusals stay server refusals', () {
    test('a 403 surfaces as a forbidden error, with the code preserved',
        () async {
      reply(Reply.commError(403, 'COMM.NOT_CONVERSATION_MEMBER'));

      await expectLater(
        repository().page(),
        throwsA(
          isA<AppError>()
              .having((e) => e.kind, 'kind', AppErrorKind.forbidden)
              .having((e) => e.code, 'code', 'COMM.NOT_CONVERSATION_MEMBER'),
        ),
      );
    });

    test('a 401 is an authentication failure, not an empty history', () async {
      reply(Reply.commError(401, 'COMM.UNKNOWN_ACTOR'));

      await expectLater(
        repository().page(),
        throwsA(isA<AppError>().having(
          (e) => e.kind,
          'kind',
          AppErrorKind.unauthenticated,
        )),
      );
    });

    test('a 500 does not become an empty list', () async {
      reply(const Reply(500, {'error': {'code': 'boom', 'message': 'x'}}));

      await expectLater(repository().page(), throwsA(isA<AppError>()));
    });
  });

  // =======================================================================
  group('1/11. what the client never does', () {
    test('11. no family_id is sent, and none is read from a row', () async {
      // The row carries a family the client must ignore entirely: scope is the
      // server's, and a client that learned to read `familyId` would be one
      // change away from filtering on it.
      reply(Reply.ok({
        'items': [row()..['familyId'] = 'family_1'],
        'nextCursor': null,
      }));

      final page = await repository().page();
      final request = server.lastRequestTo('GET', '/calls/history')!;

      expect(request.query.values.join(' '), isNot(contains('family')));
      // `CallHistoryEntry` has no family field to put it in.
      expect(page.items.single.conversationId, 'conv_1');
    });

    test('10. one request per page — never one per conversation', () async {
      reply(Reply.ok({
        'items': [
          row(id: 'a', conversationId: 'conv_1'),
          row(id: 'b', conversationId: 'conv_2'),
          row(id: 'c', conversationId: 'conv_3'),
        ],
        'nextCursor': null,
      }));

      await repository().page();

      expect(server.requests, hasLength(1));
      expect(server.countOf('GET', '/calls/history/conv_1'), 0);
      expect(server.countOf('GET', '/calls/history/conv_2'), 0);
    });

    test('9. the order is the server\'s, not re-sorted here', () async {
      // Deliberately NOT chronological: if the client sorted, this would come
      // back reordered.
      reply(Reply.ok({
        'items': [
          row(id: 'older', startedAt: '2026-09-28T09:00:00.000Z'),
          row(id: 'newer', startedAt: '2026-09-28T11:00:00.000Z'),
          row(id: 'middle', startedAt: '2026-09-28T10:00:00.000Z'),
        ],
        'nextCursor': null,
      }));

      final page = await repository().page();

      expect(page.items.map((e) => e.id), ['older', 'newer', 'middle']);
    });

    test('no credential, room name or phone number is modelled', () async {
      reply(Reply.ok({
        'items': [
          row()
            ..['roomName'] = 'jawwid-conv_1-uuid'
            ..['token'] = 'a.media.token',
        ],
        'nextCursor': null,
      }));

      final page = await repository().page();
      final entry = page.items.single;

      // There is nowhere for any of it to go: the entry has id, conversationId,
      // title, startedAt, outcome, isGroup and duration, and nothing else.
      expect(entry.title, '');
      expect(entry.id, 'call_1');
      expect(entry.conversationId, 'conv_1');
    });
  });
}
