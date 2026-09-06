import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/shared/models/message.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// The controller driving the real HTTP transport against a server that speaks the published
/// contract. This is the seam where the two halves meet, and it is the one place the
/// idempotency guarantee can be observed end to end.
void main() {
  late TestServer server;
  late ProviderContainer container;

  Map<String, Object?> messageDto({
    required String id,
    required String seq,
    String? clientMessageId,
    String moderation = 'published',
  }) =>
      {
        'id': id,
        'conversationId': 'c1',
        'seq': seq,
        'authorKind': 'contact',
        'authorId': 'me',
        'type': 'text',
        'body': 'مرحبا',
        'visibility': 'customer',
        'moderation': moderation,
        'origin': 'user',
        'clientMessageId': clientMessageId,
        'deletedForAll': false,
        'createdAt': '2026-09-05T12:00:00.000Z',
        'attachments': const [],
        'reactions': const [],
        'receipts': const [],
      };

  setUp(() async {
    server = await TestServer.start();
    container = ProviderContainer(
      overrides: [
        messageRepositoryProvider.overrideWithValue(
          HttpMessageRepository(
            client: buildApiClient(
              config: ApiConfig(baseUrl: server.baseUrl),
              tokens: _NoTokens(),
              identity: const BearerTokenIdentity(),
            ),
            viewerActorId: () => 'me',
          ),
        ),
      ],
    );
  });

  tearDown(() async {
    container.dispose();
    await server.stop();
  });

  MessagesController controller() =>
      container.read(messagesControllerProvider('c1').notifier);
  MessagesState read() => container.read(messagesControllerProvider('c1'));

  /// Wait for a condition rather than sleeping a fixed amount.
  ///
  /// A fixed delay is a flake waiting to happen: the very first request in an isolate pays
  /// for socket setup, so 60ms passes locally and fails on a loaded CI box.
  Future<void> waitUntil(bool Function() condition, {String? describe}) async {
    final deadline = DateTime.now().add(const Duration(seconds: 5));

    while (DateTime.now().isBefore(deadline)) {
      if (condition()) return;
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    fail('timed out waiting for ${describe ?? 'condition'}');
  }

  /// The initial history load has finished.
  Future<void> settle() =>
      waitUntil(() => !read().isLoadingInitial, describe: 'initial load');

  /// The message composed under [clientId] has left the in-flight states.
  Future<void> settleSend(String clientId) => waitUntil(
        () => !(read().log.byClientId(clientId)?.isPending ?? true),
        describe: 'send of $clientId',
      );

  test('loads history over HTTP into the log', () async {
    server.on('GET', '/conversations/c1/messages', [
      Reply.ok({
        'messages': [
          messageDto(id: 'srv_2', seq: '2'),
          messageDto(id: 'srv_1', seq: '1'),
        ],
        'nextBefore': null,
      }),
    ]);

    controller();
    await waitUntil(
      () => read().log.length == 2,
      describe: 'history to arrive',
    );

    expect(read().log.length, 2);
    // Server order was newest-first; the log re-sorts ascending by seq.
    expect(read().log.messages.map((m) => m.sequence), [1, 2]);
  });

  test('a sent message is echoed, posted, and reconciled by client id', () async {
    server.on('GET', '/conversations/c1/messages', [
      const Reply.ok({'messages': [], 'nextBefore': null}),
    ]);

    final c = controller();
    await settle();

    // The reply mirrors back whatever clientMessageId the client sent.
    server.on('POST', '/conversations/c1/messages', [
      Reply.ok(messageDto(id: 'srv_9', seq: '9')),
    ]);

    final clientId = c.send('مرحبا');
    expect(read().log.byClientId(clientId)!.deliveryState.isLocal, isTrue);

    await settleSend(clientId);

    expect(read().log.length, 1, reason: 'the echo must be replaced, not duplicated');
    final sent = server.lastRequestTo('POST', '/conversations/c1/messages')!;
    expect(sent.json['clientMessageId'], clientId);
  });

  test('a transient failure queues the message and a retry reuses the id', () async {
    server.on('GET', '/conversations/c1/messages', [
      const Reply.ok({'messages': [], 'nextBefore': null}),
    ]);

    final c = controller();
    await settle();

    server.on('POST', '/conversations/c1/messages', [
      const Reply(503, {'error': {'code': 'unavailable'}}),
      Reply.ok(messageDto(id: 'srv_1', seq: '1')),
    ]);

    final clientId = c.send('مرحبا');
    await settleSend(clientId);

    expect(read().log.byClientId(clientId)!.deliveryState, DeliveryState.failed);
    expect(read().log.byClientId(clientId)!.canRetry, isTrue);

    await c.retry(clientId);
    await waitUntil(
      () => read().log.byClientId(clientId)?.deliveryState == DeliveryState.sent,
      describe: 'retry to succeed',
    );

    final posts = server.requests
        .where((r) => r.method == 'POST' && r.path == '/conversations/c1/messages')
        .toList();
    expect(posts, hasLength(2));
    expect(
      posts.map((r) => r.json['clientMessageId']).toSet(),
      hasLength(1),
      reason: 'both attempts must carry the same id so the server deduplicates',
    );
    expect(read().log.length, 1, reason: 'no duplicate bubble');
  });

  test('a BR-1 refusal parks the message and is never auto-retried', () async {
    server.on('GET', '/conversations/c1/messages', [
      const Reply.ok({'messages': [], 'nextBefore': null}),
    ]);

    final c = controller();
    await settle();

    server.on('POST', '/conversations/c1/messages', [
      Reply.commError(403, 'COMM.BR1_TEACHER_PARENT_DIRECT'),
    ]);

    final clientId = c.send('مرحبا');
    await settleSend(clientId);
    // Give any (incorrect) automatic retry a chance to fire before asserting it did not.
    await Future<void>.delayed(const Duration(milliseconds: 300));

    expect(
      server.countOf('POST', '/conversations/c1/messages'),
      1,
      reason: 'a policy refusal would fail identically forever',
    );
    expect(read().isOffline, isFalse);
  });

  test('resync asks only for what came after the highest known seq', () async {
    server.on('GET', '/conversations/c1/messages', [
      Reply.ok({
        'messages': [messageDto(id: 'srv_5', seq: '5')],
        'nextBefore': null,
      }),
      Reply.ok({
        'messages': [messageDto(id: 'srv_6', seq: '6')],
        'nextBefore': null,
      }),
    ]);

    final c = controller();
    await waitUntil(() => read().log.length == 1, describe: 'history');

    await c.resync();
    await waitUntil(() => read().log.length == 2, describe: 'resync');

    final resyncRequest = server.lastRequestTo('GET', '/conversations/c1/messages')!;
    expect(resyncRequest.query['after'], '5');
    expect(read().log.length, 2);
  });

  test('a pending-approval reply is shown as withheld from others', () async {
    server.on('GET', '/conversations/c1/messages', [
      const Reply.ok({'messages': [], 'nextBefore': null}),
    ]);

    final c = controller();
    await settle();

    server.on('POST', '/conversations/c1/messages', [
      Reply.ok(messageDto(id: 'srv_1', seq: '1', moderation: 'pending')),
    ]);

    final clientId = c.send('مرحبا');
    await settleSend(clientId);

    final message = read().log.byClientId(clientId)!;
    expect(message.approvalState, ApprovalState.pending);
    expect(message.isVisibleToOthers, isFalse);
  });
}
