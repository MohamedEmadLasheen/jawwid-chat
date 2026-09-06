import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/data/http/unavailable_auth_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'test_server.dart';

/// A token provider with no tokens, which is the state until AI #1 publishes auth.
class _NoTokens implements TokenProvider {
  int refreshCalls = 0;
  AppError? ended;

  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async {
    refreshCalls++;
    return null;
  }

  @override
  Future<void> onSessionEnded(AppError error) async => ended = error;
}

/// A provider that can hand out a token and renew it once.
class _RenewableTokens implements TokenProvider {
  _RenewableTokens({this.canRefresh = true});

  final bool canRefresh;
  String current = 'stale-token';
  int refreshCalls = 0;
  AppError? ended;

  @override
  Future<String?> accessToken() async => current;

  @override
  Future<String?> refresh() async {
    refreshCalls++;
    if (!canRefresh) return null;
    current = 'fresh-token';
    return current;
  }

  @override
  Future<void> onSessionEnded(AppError error) async => ended = error;
}

void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ApiClient clientWith(
    TokenProvider tokens, {
    Duration receive = const Duration(seconds: 5),
    String debugActorId = '',
  }) {
    return buildApiClient(
      config: ApiConfig(baseUrl: server.baseUrl, receiveTimeout: receive),
      tokens: tokens,
      identity: debugActorId.isEmpty
          ? const BearerTokenIdentity()
          : DebugActorHeaderIdentity(actorId: debugActorId, enabled: true),
    );
  }

  HttpConversationRepository conversations(
    ApiClient client, {
    UserRole role = UserRole.parent,
  }) =>
      HttpConversationRepository(client: client, viewerRole: () => role);

  HttpMessageRepository messages(ApiClient client, {String actorId = 'me'}) =>
      HttpMessageRepository(client: client, viewerActorId: () => actorId);

  Map<String, Object?> conversationDto({
    String id = 'c1',
    String type = 'student_group',
    bool teacherApproval = true,
    bool parentApproval = false,
    String? archivedAt,
  }) =>
      {
        'id': id,
        'type': type,
        'title': 'أحمد · جَوِّد',
        'learnerId': 'l1',
        'state': 'open',
        'needsReply': false,
        'lastSeq': '10',
        'lastActivityAt': '2026-09-05T12:00:00.000Z',
        'archivedAt': archivedAt,
        'teacherRequiresApproval': teacherApproval,
        'parentRequiresApproval': parentApproval,
      };

  Map<String, Object?> messageDto({
    String id = 'srv_1',
    String seq = '1',
    String? clientMessageId,
    String moderation = 'published',
    String authorId = 'other',
    List<Object?> receipts = const [],
  }) =>
      {
        'id': id,
        'conversationId': 'c1',
        'seq': seq,
        'authorKind': 'contact',
        'authorId': authorId,
        'type': 'text',
        'body': 'مرحبا',
        'visibility': 'customer',
        'moderation': moderation,
        'origin': 'user',
        'replyToMessageId': null,
        'clientMessageId': clientMessageId,
        'deletedAt': null,
        'deletedForAll': false,
        'createdAt': '2026-09-05T12:00:00.000Z',
        'attachments': const [],
        'reactions': const [],
        'receipts': receipts,
      };

  group('conversation list', () {
    test('parses the { conversations: [...] } envelope', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [conversationDto(), conversationDto(id: 'c2')],
        }),
      ]);

      final result = await conversations(clientWith(_NoTokens())).list();

      expect(result, hasLength(2));
      expect(result.first.id, 'c1');
      expect(result.first.kind, ConversationKind.studentGroup);
    });

    test('an empty list is empty, not an error', () async {
      server.on('GET', '/conversations', [
        const Reply.ok({'conversations': []}),
      ]);

      expect(await conversations(clientWith(_NoTokens())).list(), isEmpty);
    });

    test('archived conversations are filtered unless asked for', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            conversationDto(),
            conversationDto(id: 'old', archivedAt: '2026-09-01T00:00:00.000Z'),
          ],
        }),
      ]);

      final repo = conversations(clientWith(_NoTokens()));
      expect(await repo.list(), hasLength(1));

      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            conversationDto(),
            conversationDto(id: 'old', archivedAt: '2026-09-01T00:00:00.000Z'),
          ],
        }),
      ]);
      expect(await repo.list(includeArchived: true), hasLength(2));
    });

    test('approval policy follows the viewer role', () async {
      for (final entry in {
        UserRole.teacher: true,
        UserRole.parent: false,
      }.entries) {
        server.on('GET', '/conversations', [
          Reply.ok({
            'conversations': [conversationDto()],
          }),
        ]);

        final result =
            await conversations(clientWith(_NoTokens()), role: entry.key).list();
        expect(result.single.requiresApproval, entry.value, reason: entry.key.name);
      }
    });

    test('a malformed row is skipped rather than blanking the list', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': ['not-an-object', conversationDto()],
        }),
      ]);

      final result = await conversations(clientWith(_NoTokens())).list();
      expect(result, hasLength(1));
    });

    test('a body that is not JSON surfaces as a safe error, not a crash', () async {
      server.on('GET', '/conversations', [const Reply(200, '<html>nope</html>')]);

      await expectLater(
        conversations(clientWith(_NoTokens())).list(),
        throwsA(isA<AppError>()),
      );
    });
  });

  group('preferences', () {
    test('pin posts to the preferences route', () async {
      server.on('POST', '/conversations/c1/preferences', [const Reply.ok({'ok': true})]);

      await conversations(clientWith(_NoTokens())).setPinned('c1', true);

      final request = server.lastRequestTo('POST', '/conversations/c1/preferences');
      expect(request!.json['pinned'], isTrue);
    });

    test('mute sends an expiry, and unmute sends null', () async {
      server.on('POST', '/conversations/c1/preferences', [
        const Reply.ok({'ok': true}),
        const Reply.ok({'ok': true}),
      ]);

      final repo = conversations(clientWith(_NoTokens()));
      await repo.setMuted('c1', true);
      expect(
        server.lastRequestTo('POST', '/conversations/c1/preferences')!
            .json['mutedUntil'],
        isA<String>(),
      );

      await repo.setMuted('c1', false);
      expect(
        server.lastRequestTo('POST', '/conversations/c1/preferences')!
            .json['mutedUntil'],
        isNull,
      );
    });

    test('markRead sends upToSeq as a string', () async {
      server.on('POST', '/conversations/c1/messages/read', [const Reply.ok({'ok': true})]);

      await conversations(clientWith(_NoTokens()))
          .markRead('c1', throughSequence: 9007199254740993);

      expect(
        server.lastRequestTo('POST', '/conversations/c1/messages/read')!
            .json['upToSeq'],
        '9007199254740993',
        reason: 'seq is 64-bit and must not cross the wire as a JSON number',
      );
    });
  });

  group('message history and pagination', () {
    test('parses messages and the nextBefore cursor', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [messageDto(seq: '2'), messageDto(id: 'srv_0', seq: '1')],
          'nextBefore': '1',
        }),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');

      expect(page.items, hasLength(2));
      expect(page.nextCursor, '1');
      expect(page.hasMore, isTrue);
    });

    test('a null nextBefore means there is no more history', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({'messages': [messageDto()], 'nextBefore': null}),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.hasMore, isFalse);
      expect(page.nextCursor, isNull);
    });

    test('an empty conversation yields an empty page, not an error', () async {
      server.on('GET', '/conversations/c1/messages', [
        const Reply.ok({'messages': [], 'nextBefore': null}),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items, isEmpty);
      expect(page.hasMore, isFalse);
    });

    test('older pages send before, not after', () async {
      server.on('GET', '/conversations/c1/messages', [
        const Reply.ok({'messages': [], 'nextBefore': null}),
      ]);

      await messages(clientWith(_NoTokens()))
          .history('c1', beforeCursor: '42', limit: 15);

      final request = server.lastRequestTo('GET', '/conversations/c1/messages')!;
      expect(request.query['before'], '42');
      expect(request.query['limit'], '15');
      expect(request.query.containsKey('after'), isFalse);
    });

    test('resync sends after as a string', () async {
      server.on('GET', '/conversations/c1/messages', [
        const Reply.ok({'messages': [], 'nextBefore': null}),
      ]);

      await messages(clientWith(_NoTokens())).since('c1', afterSequence: 77);

      final request = server.lastRequestTo('GET', '/conversations/c1/messages')!;
      expect(request.query['after'], '77');
      expect(request.query.containsKey('before'), isFalse);
    });

    test('a 64-bit seq survives the round trip', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [messageDto(seq: '9007199254740993')],
          'nextBefore': null,
        }),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items.single.sequence, 9007199254740993);
    });

    test('a malformed message row is skipped', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [42, messageDto()],
          'nextBefore': null,
        }),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items, hasLength(1));
    });
  });

  group('approval state from the wire', () {
    test('pending is not visible to others', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [messageDto(moderation: 'pending')],
          'nextBefore': null,
        }),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items.single.approvalState, ApprovalState.pending);
      expect(page.items.single.isVisibleToOthers, isFalse);
    });

    test('rejected is terminal and hidden from others', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [messageDto(moderation: 'rejected')],
          'nextBefore': null,
        }),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items.single.approvalState, ApprovalState.rejected);
      expect(page.items.single.isVisibleToOthers, isFalse);
    });

    test('published is live', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({'messages': [messageDto()], 'nextBefore': null}),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items.single.approvalState, ApprovalState.notRequired);
      expect(page.items.single.isVisibleToOthers, isTrue);
    });

    test('receipts decide delivery state, never the client', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [
            messageDto(receipts: [
              {'actorId': 'x', 'state': 'read'},
            ]),
          ],
          'nextBefore': null,
        }),
      ]);

      final page = await messages(clientWith(_NoTokens())).history('c1');
      expect(page.items.single.deliveryState, DeliveryState.read);
    });
  });

  group('sending and idempotency', () {
    OutgoingMessage outgoing({String id = 'client-uuid-1'}) => OutgoingMessage(
          clientMessageId: id,
          conversationId: 'c1',
          kind: MessageKind.text,
          body: 'مرحبا',
        );

    test('sends the client message id and the wire type', () async {
      server.on('POST', '/conversations/c1/messages', [
        Reply.ok(messageDto(clientMessageId: 'client-uuid-1', authorId: 'me')),
      ]);

      await messages(clientWith(_NoTokens())).send(outgoing());

      final request = server.lastRequestTo('POST', '/conversations/c1/messages')!;
      expect(request.json['clientMessageId'], 'client-uuid-1');
      expect(request.json['type'], 'text');
      expect(request.json['body'], 'مرحبا');
    });

    test('attaches the idempotency header so the POST is replayable', () async {
      server.on('POST', '/conversations/c1/messages', [
        Reply.ok(messageDto(clientMessageId: 'client-uuid-1')),
      ]);

      await messages(clientWith(_NoTokens())).send(outgoing());

      final request = server.lastRequestTo('POST', '/conversations/c1/messages')!;
      expect(
        request.headers[ApiClient.idempotencyHeader.toLowerCase()],
        'client-uuid-1',
      );
    });

    test('a duplicate send returns the original message, not a second one', () async {
      // The engine returns the existing row for a repeated clientMessageId.
      final original = messageDto(
        id: 'srv_first',
        seq: '5',
        clientMessageId: 'client-uuid-1',
        authorId: 'me',
      );
      server.on('POST', '/conversations/c1/messages', [
        Reply.ok(original),
        Reply.ok(original),
      ]);

      final repo = messages(clientWith(_NoTokens()));
      final first = await repo.send(outgoing());
      final second = await repo.send(outgoing());

      expect(first.id, second.id);
      expect(first.sequence, second.sequence);
      expect(server.countOf('POST', '/conversations/c1/messages'), 2);
    });

    test('isMine is decided by actor id', () async {
      server.on('POST', '/conversations/c1/messages', [
        Reply.ok(messageDto(clientMessageId: 'client-uuid-1', authorId: 'me')),
      ]);

      final sent = await messages(clientWith(_NoTokens()), actorId: 'me')
          .send(outgoing());
      expect(sent.isMine, isTrue);
    });

    test('the response is re-keyed to our client id even if the server omits it', () async {
      // The engine does echo clientMessageId back, but this is the response to our own POST,
      // so the correspondence is certain either way. Without re-keying, the log would key
      // the confirmation by its server id and show the message twice.
      server.on('POST', '/conversations/c1/messages', [
        Reply.ok(messageDto(id: 'srv_1', clientMessageId: null, authorId: 'me')),
      ]);

      final sent = await messages(clientWith(_NoTokens())).send(outgoing());
      expect(sent.clientMessageId, 'client-uuid-1');
    });

    test('a server-echoed client id is preserved unchanged', () async {
      server.onRequest('POST', '/conversations/c1/messages', (request) {
        return Reply.ok(
          messageDto(
            id: 'srv_1',
            clientMessageId: request.json['clientMessageId'] as String?,
            authorId: 'me',
          ),
        );
      });

      final sent = await messages(clientWith(_NoTokens())).send(outgoing());
      expect(sent.clientMessageId, 'client-uuid-1');
    });

    test('an empty response body is an error, not a silent success', () async {
      server.on('POST', '/conversations/c1/messages', [const Reply(200, null)]);

      await expectLater(
        messages(clientWith(_NoTokens())).send(outgoing()),
        throwsA(isA<AppError>()),
      );
    });
  });

  group('error mapping over the wire', () {
    test('BR-1 denial maps to a terminal forbidden error', () async {
      server.on('POST', '/conversations/c1/messages', [
        Reply.commError(403, WireErrors.br1TeacherParentDirect),
      ]);

      try {
        await messages(clientWith(_NoTokens())).send(
          const OutgoingMessage(
            clientMessageId: 'x',
            conversationId: 'c1',
            kind: MessageKind.text,
            body: 'hi',
          ),
        );
        fail('expected a refusal');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.forbidden);
        expect(error.code, WireErrors.br1TeacherParentDirect);
        expect(error.isTransient, isFalse);
      }
    });

    test('a 403 with no member access is forbidden and not retried', () async {
      server.on('GET', '/conversations', [
        Reply.commError(403, WireErrors.notConversationMember),
      ]);

      try {
        await conversations(clientWith(_NoTokens())).list();
        fail('expected a refusal');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.forbidden);
        expect(error.isTransient, isFalse);
      }
    });

    test('an inactive actor ends the session', () async {
      final tokens = _NoTokens();
      server.on('GET', '/conversations', [
        Reply.commError(403, WireErrors.actorInactive),
      ]);

      try {
        await conversations(clientWith(tokens)).list();
        fail('expected a refusal');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.accountDisabled);
        expect(error.terminatesSession, isTrue);
      }
      expect(tokens.ended, isNotNull);
    });

    test('a 404 for a missing conversation is not retried', () async {
      server.on('GET', '/conversations/gone', [
        Reply.commError(404, WireErrors.conversationNotFound),
      ]);

      try {
        await conversations(clientWith(_NoTokens())).byId('gone');
        fail('expected not found');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.notFound);
        expect(error.isTransient, isFalse);
      }
    });

    test('a 500 is a server error and is retryable', () async {
      server.on('GET', '/conversations', [const Reply(500, {'oops': true})]);

      try {
        await conversations(clientWith(_NoTokens())).list();
        fail('expected a server error');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.server);
        expect(error.isTransient, isTrue);
      }
    });

    test('a receive timeout maps to timeout and is retryable', () async {
      server.on('GET', '/conversations', [
        const Reply(200, {'conversations': []}, delay: Duration(seconds: 2)),
      ]);

      final client = clientWith(
        _NoTokens(),
        receive: const Duration(milliseconds: 150),
      );

      try {
        await conversations(client).list();
        fail('expected a timeout');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.timeout);
        expect(error.isTransient, isTrue);
      }
    });

    test('an unreachable host is a network failure, not a crash', () async {
      final client = buildApiClient(
        // Port 1 on loopback: nothing listens there.
        config: const ApiConfig(
          baseUrl: 'http://127.0.0.1:1',
          connectTimeout: Duration(milliseconds: 300),
        ),
        tokens: _NoTokens(),
        identity: const BearerTokenIdentity(),
      );

      try {
        await conversations(client).list();
        fail('expected a network failure');
      } on AppError catch (error) {
        expect(
          error.kind,
          anyOf(AppErrorKind.network, AppErrorKind.timeout),
        );
        expect(error.isTransient, isTrue);
      }
    });
  });

  group('401 handling and refresh', () {
    test('a 401 triggers one refresh and replays the request', () async {
      final tokens = _RenewableTokens();
      server.on('GET', '/conversations', [
        const Reply(401, {'error': {'code': 'unauthenticated'}}),
        Reply.ok({'conversations': [conversationDto()]}),
      ]);

      final result = await conversations(clientWith(tokens)).list();

      expect(result, hasLength(1));
      expect(tokens.refreshCalls, 1);
      expect(server.countOf('GET', '/conversations'), 2);
    });

    test('the replayed request carries the refreshed token', () async {
      final tokens = _RenewableTokens();
      server.on('GET', '/conversations', [
        const Reply(401, {'error': {'code': 'unauthenticated'}}),
        const Reply.ok({'conversations': []}),
      ]);

      await conversations(clientWith(tokens)).list();

      expect(
        server.lastRequestTo('GET', '/conversations')!.headers['authorization'],
        'Bearer fresh-token',
      );
    });

    test('a session that cannot refresh ends rather than looping', () async {
      final tokens = _RenewableTokens(canRefresh: false);
      server.on('GET', '/conversations', [
        const Reply(401, {'error': {'code': 'unauthenticated'}}),
      ]);

      await expectLater(
        conversations(clientWith(tokens)).list(),
        throwsA(isA<AppError>()),
      );

      expect(tokens.refreshCalls, 1);
      expect(tokens.ended, isNotNull);
      expect(
        server.countOf('GET', '/conversations'),
        1,
        reason: 'a request must not be replayed when there is no new token',
      );
    });

    test('a still-401 replay ends the session instead of retrying forever', () async {
      final tokens = _RenewableTokens();
      server.on('GET', '/conversations', [
        const Reply(401, {'error': {'code': 'unauthenticated'}}),
        const Reply(401, {'error': {'code': 'unauthenticated'}}),
        const Reply(401, {'error': {'code': 'unauthenticated'}}),
      ]);

      await expectLater(
        conversations(clientWith(tokens)).list(),
        throwsA(isA<AppError>()),
      );

      expect(
        server.countOf('GET', '/conversations'),
        lessThanOrEqualTo(2),
        reason: 'at most one replay per request',
      );
      expect(tokens.ended, isNotNull);
    });

    test('a revoked session is terminal and never refreshed', () async {
      final tokens = _RenewableTokens();
      server.on('GET', '/conversations', [
        Reply.commError(401, 'session_revoked'),
      ]);

      try {
        await conversations(clientWith(tokens)).list();
        fail('expected revocation');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.sessionRevoked);
        expect(error.terminatesSession, isTrue);
      }

      expect(
        tokens.refreshCalls,
        0,
        reason: 'refreshing a revoked session cannot help',
      );
      expect(tokens.ended, isNotNull);
    });
  });

  group('the actor-identity bring-up seam', () {
    test('sends no identity header by default', () async {
      server.on('GET', '/conversations', [
        const Reply.ok({'conversations': []}),
      ]);

      await conversations(clientWith(_NoTokens())).list();

      expect(
        server.lastRequestTo('GET', '/conversations')!.headers
            .containsKey(DebugActorHeaderIdentity.headerName),
        isFalse,
      );
    });

    test('sends x-actor-id only when explicitly enabled', () async {
      server.on('GET', '/conversations', [
        const Reply.ok({'conversations': []}),
      ]);

      await conversations(clientWith(_NoTokens(), debugActorId: 'actor-1')).list();

      expect(
        server.lastRequestTo('GET', '/conversations')!.headers[
            DebugActorHeaderIdentity.headerName],
        'actor-1',
      );
    });

    test('the seam is inert unless enabled', () async {
      const identity = DebugActorHeaderIdentity(actorId: 'actor-1');
      expect(await identity.headers(), isEmpty);
    });
  });

  group('capabilities the contract does not provide', () {
    test('search fails honestly rather than filtering locally', () async {
      await expectLater(
        conversations(clientWith(_NoTokens())).search('أحمد'),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', 'search_not_supported'),
        ),
      );
    });

    test('every auth call fails with a specific, terminal error', () async {
      const auth = UnavailableAuthRepository();

      for (final call in <Future<Object?> Function()>[
        () => auth.signIn(username: 'u', password: 'p'),
        () => auth.currentUser(),
        () => auth.refresh('r'),
        () => auth.devices(),
        () => auth.revokeDevice('d'),
      ]) {
        await expectLater(
          call(),
          throwsA(
            isA<AppError>().having(
              (e) => e.code,
              'code',
              'auth_contract_not_published',
            ),
          ),
        );
      }
    });

    test('sign-out still clears locally even with no server session', () async {
      const auth = UnavailableAuthRepository();
      await expectLater(auth.signOut(), completes);
    });
  });
}
