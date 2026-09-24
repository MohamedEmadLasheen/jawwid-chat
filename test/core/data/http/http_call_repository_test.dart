import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_call_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';

import 'test_server.dart';

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

/// The call repository against a REAL socket.
///
/// Every assertion here is about the wire: the path that was requested, the
/// method, what was in the body, what came back as a typed value, and what a
/// `COMM.*` refusal becomes. The repository holds no policy, so there is
/// nothing else in it worth testing — and driving it through a scripted server
/// is the only way to show that the seven methods address the seven endpoints
/// the contract describes rather than the ones the old interface imagined.
///
/// No widget binding, deliberately: `TestWidgetsFlutterBinding` installs an
/// `HttpOverrides` that answers every real request with a 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpCallRepository repository({String? token = 'fake-access-token'}) =>
      HttpCallRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _Tokens(token),
          identity: const BearerTokenIdentity(),
        ),
      );

  /// Register one reply for the route a method will actually address.
  void reply(String route, Reply r) {
    const paths = <String, List<String>>{
      'capability': ['GET', '/conversations/c_1/call-capability'],
      'start': ['POST', '/calls'],
      'mediaToken': ['POST', '/calls/call_1/token'],
      'accept': ['POST', '/calls/call_1/accept'],
      'decline': ['POST', '/calls/call_1/decline'],
      'end': ['POST', '/calls/call_1/end'],
      'history': ['GET', '/calls/history/c_1'],
    };
    final spec = paths[route]!;
    server.on(spec[0], spec[1], [r]);
  }

  // -----------------------------------------------------------------------
  group('capability', () {
    test('asks the conversation route and decodes an allowance', () async {
      reply('capability', const Reply.ok({'canCall': true, 'code': null}));

      final result = await repository().capability(conversationId: 'c_1');

      expect(server.requests.single.method, 'GET');
      expect(server.requests.single.path, '/conversations/c_1/call-capability');
      expect(result.canCall, isTrue);
      expect(result.code, isNull);
    });

    test('decodes a refusal and keeps the server’s code', () async {
      reply('capability', const Reply.ok({
        'canCall': false,
        'code': WireErrors.teacherParentNotAuthorized,
      }));

      final result = await repository().capability(conversationId: 'c_1');

      expect(result.canCall, isFalse);
      // The code is what lets an interface distinguish a revoked relationship
      // from every other refusal. Collapsing it would lose that.
      expect(result.code, WireErrors.teacherParentNotAuthorized);
    });

    test('a response without a boolean canCall FAILS CLOSED', () async {
      // Missing, wrong type, and string "true" — none may read as permission.
      for (final body in <Map<String, Object?>>[
        {'code': null},
        {'canCall': 'true'},
        {'canCall': 1},
        {'canCall': null},
      ]) {
        reply('capability', Reply.ok(body));
        await expectLater(
          repository().capability(conversationId: 'c_1'),
          throwsA(
            isA<AppError>().having((e) => e.code, 'code', 'malformed_call_capability'),
          ),
          reason: '$body',
        );
      }
    });

    test('a forbidden capability request surfaces the server code', () async {
      reply('capability', Reply.commError(403, WireErrors.notConversationMember));

      await expectLater(
        repository().capability(conversationId: 'c_1'),
        throwsA(
          isA<AppError>()
              .having((e) => e.code, 'code', WireErrors.notConversationMember),
        ),
      );
    });
  });

  // -----------------------------------------------------------------------
  group('start', () {
    test('posts the conversation id and nothing else', () async {
      reply('start', const Reply.ok({'callId': 'call_1', 'roomName': 'jawwid-room'}));

      final started = await repository().start(conversationId: 'c_1');

      final request = server.requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/calls');
      // No actorId, no room, no token: identity is the bearer's and the room is
      // the server's. There is no field here through which a client could name
      // itself or choose where it lands.
      expect(request.json.keys.toList(), ['conversationId']);
      expect(request.json['conversationId'], 'c_1');
      expect(started.callId, 'call_1');
      expect(started.roomName, 'jawwid-room');
    });

    test('a refused start keeps TEACHER_PARENT_NOT_AUTHORIZED distinguishable',
        () async {
      reply('start', 
        Reply.commError(403, WireErrors.teacherParentNotAuthorized),
      );

      await expectLater(
        repository().start(conversationId: 'c_1'),
        throwsA(
          isA<AppError>()
              .having((e) => e.code, 'code', WireErrors.teacherParentNotAuthorized),
        ),
      );
    });

    test('a response missing callId is malformed, not a half-built call', () async {
      reply('start', const Reply.ok({'roomName': 'jawwid-room'}));

      await expectLater(
        repository().start(conversationId: 'c_1'),
        throwsA(isA<AppError>().having((e) => e.code, 'code', 'malformed_start_call')),
      );
    });
  });

  // -----------------------------------------------------------------------
  group('media token — obtained, not consumed', () {
    test('decodes the grant the server issues', () async {
      reply('mediaToken', const Reply.ok({
        'token': 'a.b.c',
        'url': 'wss://jawwid.livekit.cloud',
        'roomName': 'jawwid-room',
        'expiresAt': '2026-09-24T10:00:00.000Z',
      }));

      final grant = await repository().mediaToken(callId: 'call_1');

      expect(server.requests.single.path, '/calls/call_1/token');
      expect(server.requests.single.method, 'POST');
      expect(grant.token, 'a.b.c');
      expect(grant.serverUrl, 'wss://jawwid.livekit.cloud');
      expect(grant.roomName, 'jawwid-room');
      expect(grant.expiresAt.toUtc().toIso8601String(),
          '2026-09-24T10:00:00.000Z');
    });

    test('an unparseable expiry is refused rather than defaulted', () async {
      // A grant with no honest expiry is worse than none: it would be treated
      // as valid forever.
      reply('mediaToken', const Reply.ok({
        'token': 'a.b.c',
        'url': 'wss://x',
        'roomName': 'r',
        'expiresAt': 'soon',
      }));

      await expectLater(
        repository().mediaToken(callId: 'call_1'),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', 'malformed_call_media_token'),
        ),
      );
    });

    test('a call that has ended issues nothing, and says so', () async {
      reply('mediaToken', Reply.commError(409, WireErrors.callAlreadyEnded));

      await expectLater(
        repository().mediaToken(callId: 'call_1'),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', WireErrors.callAlreadyEnded),
        ),
      );
    });
  });

  // -----------------------------------------------------------------------
  group('accept / decline / end', () {
    test('accept posts to the call, with no body', () async {
      reply('accept', const Reply.ok({'ok': true}));

      await repository().accept(callId: 'call_1');

      expect(server.requests.single.method, 'POST');
      expect(server.requests.single.path, '/calls/call_1/accept');
      expect(server.requests.single.json, isEmpty);
    });

    test('decline posts to the call', () async {
      reply('decline', const Reply.ok({'ok': true}));

      await repository().decline(callId: 'call_1');

      expect(server.requests.single.path, '/calls/call_1/decline');
    });

    test('end sends no outcome when none is given', () async {
      reply('end', const Reply.ok({'ok': true}));

      await repository().end(callId: 'call_1');

      // The server derives it from whether the call was answered. A client
      // default here would be the client writing history.
      expect(server.requests.single.path, '/calls/call_1/end');
      expect(server.requests.single.json, isEmpty);
    });

    test('end forwards an outcome when one is given', () async {
      reply('end', const Reply.ok({'ok': true}));

      await repository().end(callId: 'call_1', outcome: Wire.callDeclined);

      expect(server.requests.single.json, {'outcome': 'declined'});
    });

    test('accepting a call already left keeps its own code', () async {
      reply('accept', Reply.commError(409, WireErrors.callParticipantLeft));

      await expectLater(
        repository().accept(callId: 'call_1'),
        throwsA(
          isA<AppError>()
              .having((e) => e.code, 'code', WireErrors.callParticipantLeft),
        ),
      );
    });

    test('declining a call that is no longer ringing keeps its own code', () async {
      reply('decline', Reply.commError(409, WireErrors.callNotRinging));

      await expectLater(
        repository().decline(callId: 'call_1'),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', WireErrors.callNotRinging),
        ),
      );
    });
  });

  // -----------------------------------------------------------------------
  group('history — per conversation, as the endpoint is', () {
    Map<String, Object?> row({
      String id = 'call_1',
      String outcome = 'answered',
      String type = 'direct',
      Object? durationSeconds = 42,
    }) =>
        {
          'id': id,
          'conversationId': 'c_1',
          'type': type,
          'status': 'ended',
          'outcome': outcome,
          'initiatorId': 'a_1',
          'startedAt': '2026-09-24T10:00:00.000Z',
          'endedAt': '2026-09-24T10:00:42.000Z',
          'durationSeconds': durationSeconds,
          'participants': const [],
        };

    test('asks the conversation-scoped route and maps the rows', () async {
      reply('history', Reply.ok({
        'calls': [row(), row(id: 'call_2', outcome: 'missed', durationSeconds: 0)],
      }));

      final entries = await repository().callHistory(conversationId: 'c_1');

      expect(server.requests.single.path, '/calls/history/c_1');
      expect(entries.map((e) => e.id).toList(), ['call_1', 'call_2']);
      expect(entries.first.outcome, CallOutcome.answered);
      expect(entries.first.duration, const Duration(seconds: 42));
      expect(entries.last.outcome, CallOutcome.missed);
    });

    test('a group call is marked as one', () async {
      reply('history', Reply.ok({'calls': [row(type: 'group')]}));

      final entries = await repository().callHistory(conversationId: 'c_1');
      expect(entries.single.isGroup, isTrue);
    });

    test('the display name is left unresolved rather than filled with an id',
        () async {
      // The rows carry `initiatorId` and no name. Showing a uuid to a parent
      // would be worse than showing nothing, so the interface is left to treat
      // an empty title as unresolved (O3 in backend-dependencies.md).
      reply('history', Reply.ok({'calls': [row()]}));

      final entries = await repository().callHistory(conversationId: 'c_1');
      expect(entries.single.title, isEmpty);
      expect(entries.single.title, isNot(contains('a_1')));
    });

    test('one malformed row is dropped, and does not empty the history',
        () async {
      reply('history', Reply.ok({
        'calls': [
          row(),
          {'id': 'broken'}, // no conversationId, no startedAt
          'not-a-row',
          row(id: 'call_3'),
        ],
      }));

      final entries = await repository().callHistory(conversationId: 'c_1');

      expect(entries.map((e) => e.id).toList(), ['call_1', 'call_3']);
    });

    test('a response with no calls array is malformed', () async {
      reply('history', const Reply.ok({'items': []}));

      await expectLater(
        repository().callHistory(conversationId: 'c_1'),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', 'malformed_call_history'),
        ),
      );
    });

    test('an empty history is empty, not an error', () async {
      reply('history', const Reply.ok({'calls': []}));

      expect(await repository().callHistory(conversationId: 'c_1'), isEmpty);
    });
  });

  // -----------------------------------------------------------------------
  group('security', () {
    test('every request carries the session bearer, and no actor header',
        () async {
      reply('capability', const Reply.ok({'canCall': true, 'code': null}));
      reply('start', const Reply.ok({'callId': 'c', 'roomName': 'r'}));

      final repo = repository();
      await repo.capability(conversationId: 'c_1');
      await repo.start(conversationId: 'c_1');

      expect(server.requests, hasLength(2));
      for (final request in server.requests) {
        expect(request.headers['authorization'], 'Bearer fake-access-token');
        // The pre-PR-B seam. It must not have come back through the call path.
        expect(request.headers.containsKey('x-actor-id'), isFalse);
      }
    });

    test('no method takes an actor id, so none can name somebody else', () {
      // Structural, against the source: identity comes from the bearer alone,
      // and the way that stops being true is a parameter appearing here. The
      // signatures are the thing worth pinning, not any value at runtime.
      final source =
          File('lib/core/data/http/http_call_repository.dart').readAsStringSync();

      final signatures = RegExp(r'Future<[^>]*>\s+\w+\(([^)]*)\)')
          .allMatches(source)
          .map((m) => m.group(1)!)
          .toList();

      expect(signatures, isNotEmpty);
      for (final parameters in signatures) {
        expect(parameters.toLowerCase(), isNot(contains('actor')), reason: parameters);
        expect(parameters.toLowerCase(), isNot(contains('token')), reason: parameters);
        expect(parameters.toLowerCase(), isNot(contains('room')), reason: parameters);
      }
    });

    test('no credential is hard-coded, and no media client is reached for', () {
      final source =
          File('lib/core/data/http/http_call_repository.dart').readAsStringSync();

      expect(source, isNot(contains('Bearer ')));
      expect(source, isNot(matches(RegExp(r'\beyJ[A-Za-z0-9_-]{5,}\.'))));
      // W4 owns media. Obtaining the grant is this layer's business; doing
      // anything with it is not.
      expect(source.toLowerCase(), isNot(contains('livekit_client')));
      expect(source.toLowerCase(), isNot(contains('room.connect')));
    });
  });
}
