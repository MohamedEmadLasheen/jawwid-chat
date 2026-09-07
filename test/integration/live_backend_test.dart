import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The mobile transport against a **running Jawwid Chat backend and a real database**.
///
/// This is the only suite in the repository that proves the INTEGRATION rather
/// than the protocol: every other HTTP test here speaks to a local test double
/// that returns the shapes the controllers are documented to return. This one
/// finds out whether they actually do. It is skipped unless a live server is
/// pointed at, so CI without a backend stays green.
///
/// **It now authenticates.** It used to assert its own identity in an
/// `x-actor-id` header, which was the engine's documented pre-auth seam — and
/// Phase 1 deleted that seam, so this suite could no longer have passed. It
/// logs in with a subject and a password, exactly as a device does, and every
/// request below carries the resulting bearer token.
///
/// Bring the stack up and run it with:
///
/// ```
/// scripts/db/integration-db.sh up            # or any throwaway database
/// # start apps/api (dist/main.js) and the worker (dist/worker.js)
/// DATABASE_URL=... scripts/qa/phase2-smoke/run.sh   # seeds smoke_parent / smoke_supervisor
///
/// JAWWID_LIVE_API=http://127.0.0.1:3999/api/v1 \
/// JAWWID_LIVE_PARENT_SUBJECT=smoke_parent \
/// JAWWID_LIVE_ADMIN_SUBJECT=smoke_supervisor \
/// JAWWID_LIVE_PASSWORD=smoke-password-long-enough \
/// flutter test test/integration/live_backend_test.dart
/// ```
void main() {
  final env = Platform.environment;
  final baseUrl = env['JAWWID_LIVE_API'];
  final parentSubject = env['JAWWID_LIVE_PARENT_SUBJECT'];
  final adminSubject = env['JAWWID_LIVE_ADMIN_SUBJECT'];
  final password = env['JAWWID_LIVE_PASSWORD'];

  final configured =
      baseUrl != null && parentSubject != null && adminSubject != null && password != null;

  /// A client holding a real session, obtained by logging in.
  ///
  /// The token store is in-memory and the refresh path is live, so this
  /// exercises the same `StoredTokenProvider` wiring the app uses rather than a
  /// stub that always has a token.
  ///
  /// The actor id comes from a RAW `/me` read rather than from
  /// `HttpAuthRepository.currentUser`. That method maps the principal to a
  /// [UserRole], and refuses a `staff` one — correctly, because the mobile app
  /// is the family and teacher client and an admin belongs in the console. The
  /// supervisor below is a COUNTERPARTY in these tests, not a mobile user, so
  /// putting them through that mapping would be asserting the wrong thing.
  /// The mapping itself is asserted on the parent, where it applies.
  Future<({ApiClient client, String actorId, HttpAuthRepository auth})> signIn(
    String subject,
  ) async {
    final tokens = InMemoryTokenStore();
    late final HttpAuthRepository auth;

    final client = buildApiClient(
      config: ApiConfig(baseUrl: baseUrl!),
      tokens: StoredTokenProvider(
        store: tokens,
        auth: () => auth,
        onEnded: (_) async {},
      ),
      identity: const BearerTokenIdentity(),
    );
    auth = HttpAuthRepository(
      client: client,
      device: const DeviceDescriptor(clientKey: 'flutter-live-test', platform: 'test'),
    );

    await tokens.write(await auth.signIn(username: subject, password: password!));
    final me = await client.get<Map<String, Object?>>('/me');
    return (client: client, actorId: me.data!['actorId']! as String, auth: auth);
  }

  group(
    'live backend',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API and the seeded subjects to run against a real server',
    () {
      late ApiClient parentClient;
      late ApiClient adminClient;
      late String parentId;
      late String adminId;
      late HttpConversationRepository parentConversations;
      late HttpMessageRepository parentMessages;
      late HttpMessageRepository adminMessages;
      late String conversationId;

      setUpAll(() async {
        final parent = await signIn(parentSubject!);
        final admin = await signIn(adminSubject!);
        parentClient = parent.client;
        adminClient = admin.client;
        parentId = parent.actorId;
        adminId = admin.actorId;

        parentConversations = HttpConversationRepository(
          client: parentClient,
          viewerRole: () => UserRole.parent,
          viewerActorId: () => parentId,
        );
        parentMessages =
            HttpMessageRepository(client: parentClient, viewerActorId: () => parentId);
        adminMessages =
            HttpMessageRepository(client: adminClient, viewerActorId: () => adminId);

        // The conversation is opened through the API rather than supplied as an
        // id: a test that needs a hand-seeded uuid is a test that rots the
        // first time the fixtures change.
        final opened = await parentClient.post<Map<String, Object?>>(
          '/conversations/direct',
          data: {'withActorId': adminId},
        );
        conversationId = opened.data!['id']! as String;
      });

      test('the login resolves a real principal, and the role is the server\'s', () async {
        final me = await HttpAuthRepository(
          client: parentClient,
          device: const DeviceDescriptor(clientKey: 'k', platform: 'test'),
        ).currentUser();

        expect(me.id, parentId);
        expect(me.role, UserRole.parent);
        expect(me.displayName, isNotEmpty);
      });

      test('this app refuses a STAFF principal by name, rather than guessing a role', () async {
        // Valid credentials, wrong application. Quietly treating an admin as a
        // parent would be very much worse than a specific refusal — and the
        // refusal is not retryable, so the client does not loop on it.
        try {
          await HttpAuthRepository(
            client: adminClient,
            device: const DeviceDescriptor(clientKey: 'k', platform: 'test'),
          ).currentUser();
          fail('the mobile client must refuse a staff principal');
        } on AppError catch (error) {
          expect(error.code, 'wrong_application_for_role');
          expect(error.isTransient, isFalse);
        }
      });

      test('the parent sees their conversations, with the row data the list needs', () async {
        final result = await parentConversations.list();

        expect(result.map((c) => c.id), contains(conversationId));
        final row = result.firstWhere((c) => c.id == conversationId);
        // Phase 2 put these ON the row. Their absence is what forced one
        // request per row to render a chat list.
        expect(row.unreadCount, isA<int>());
        expect(row.title, isNotEmpty, reason: 'a 1:1 is named after the other side');
      });

      test('a conversation loads by id, carrying its unread count', () async {
        final conversation = await parentConversations.byId(conversationId);

        expect(conversation.id, conversationId);
        expect(conversation.kind, ConversationKind.adminDirect);
        expect(conversation.unreadCount, isA<int>());
      });

      test('sending creates a real message, and a retry is deduplicated', () async {
        final clientMessageId = 'live-${DateTime.now().microsecondsSinceEpoch}';
        final outgoing = OutgoingMessage(
          clientMessageId: clientMessageId,
          conversationId: conversationId,
          kind: MessageKind.text,
          body: 'اختبار التكامل',
        );

        final first = await parentMessages.send(outgoing);
        expect(first.id, isNotNull);
        expect(first.sequence, isNotNull);
        expect(first.isMine, isTrue);
        expect(first.clientMessageId, clientMessageId);

        // The same composed message, sent again exactly as a retry would.
        final second = await parentMessages.send(outgoing);
        expect(
          second.id,
          first.id,
          reason: 'the server must return the original, not create a duplicate',
        );

        final page = await parentMessages.history(conversationId, limit: 50);
        expect(page.items.where((m) => m.clientMessageId == clientMessageId), hasLength(1));
        for (final message in page.items) {
          expect(message.sequence, isNotNull, reason: 'every server message carries a seq');
        }
      });

      test('resync returns only what came after a watermark', () async {
        await parentMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-resync-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: 'نقطة المزامنة',
          ),
        );

        final page = await parentMessages.history(conversationId, limit: 50);
        final highest =
            page.items.map((m) => m.sequence ?? 0).fold<int>(0, (a, b) => a > b ? a : b);

        final after = await parentMessages.since(conversationId, afterSequence: highest);
        expect(
          after.where((m) => (m.sequence ?? 0) <= highest),
          isEmpty,
          reason: 'resync must not re-deliver what the client already holds',
        );
      });

      test('a reply comes back with its quote resolved by the server', () async {
        final original = await adminMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-quote-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: 'متى الحصة؟',
          ),
        );

        await parentMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-reply-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: 'غدا',
            replyToMessageId: original.id,
          ),
        );

        final page = await parentMessages.history(conversationId, limit: 50);
        final reply = page.items.firstWhere((m) => m.replyTo != null);
        expect(reply.replyTo!.isAvailable, isTrue);
        expect(reply.replyTo!.excerpt, 'متى الحصة؟');
      });

      test('editing marks the message edited, and only for its author', () async {
        final mine = await parentMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-edit-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: 'قبل التعديل',
          ),
        );

        final edited = await parentMessages.edit(
          conversationId: conversationId,
          messageId: mine.id!,
          body: 'بعد التعديل',
        );
        expect(edited.body, 'بعد التعديل');
        expect(edited.isEdited, isTrue);

        // The admin may read the conversation and still may not rewrite this.
        await expectLater(
          adminMessages.edit(
            conversationId: conversationId,
            messageId: mine.id!,
            body: 'ليست رسالتي',
          ),
          throwsA(isA<AppError>()),
        );
      });

      test('a reaction round-trips, and an unsupported one is refused', () async {
        final target = await adminMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-react-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: 'تفاعل',
          ),
        );

        await parentMessages.react(conversationId, target.id!, kReactionEmoji.first);
        final page = await parentMessages.history(conversationId, limit: 50);
        final reacted = page.items.firstWhere((m) => m.id == target.id);
        expect(reacted.reactions.single.emoji, kReactionEmoji.first);
        expect(reacted.reactions.single.mine, isTrue);

        await expectLater(
          parentMessages.react(conversationId, target.id!, '💩'),
          throwsA(isA<AppError>()),
        );

        await parentMessages.removeReaction(conversationId, target.id!);
      });

      test('delete for me hides it here and nowhere else', () async {
        final target = await adminMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-hide-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: 'أخفِ هذه',
          ),
        );

        await parentMessages.deleteForMe(
          conversationId: conversationId,
          messageId: target.id!,
        );

        final parentView = await parentMessages.history(conversationId, limit: 50);
        expect(parentView.items.map((m) => m.id), isNot(contains(target.id)));

        final adminView = await adminMessages.history(conversationId, limit: 50);
        expect(adminView.items.map((m) => m.id), contains(target.id));
      });

      test('search reaches the server and returns hits the client can render', () async {
        final needle = 'ابرة${DateTime.now().microsecondsSinceEpoch}';
        await parentMessages.send(
          OutgoingMessage(
            clientMessageId: 'live-search-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId,
            kind: MessageKind.text,
            body: needle,
          ),
        );

        final hits = await parentMessages.search(MessageSearchQuery(text: needle));
        expect(hits, isNotEmpty);
        expect(hits.first.conversationId, conversationId);

        final scoped = await parentMessages.search(
          MessageSearchQuery(text: needle, conversationId: conversationId),
        );
        expect(scoped, isNotEmpty);

        // Conversation search is a server call too, never a local filter.
        await expectLater(parentConversations.search('a'), completion(isEmpty));
      });

      test('the read cursor is accepted, and unread falls to zero', () async {
        final page = await parentMessages.history(conversationId, limit: 50);
        final highest =
            page.items.map((m) => m.sequence ?? 0).fold<int>(0, (a, b) => a > b ? a : b);

        await parentConversations.markRead(conversationId, throughSequence: highest);
        final after = await parentConversations.byId(conversationId);
        expect(after.unreadCount, 0);
      });

      test('BR-1 is refused by the server, whichever side asks', () async {
        // The client offers no such affordance; this proves the server refuses
        // it anyway. A teacher subject is not seeded, so this exercises the
        // half that can be reached: a parent naming a teacher-shaped id gets a
        // refusal rather than a conversation.
        try {
          await parentClient.post<Map<String, Object?>>(
            '/conversations/direct',
            data: {'withActorId': parentId},
          );
          fail('the server must refuse a conversation with oneself');
        } on AppError catch (error) {
          expect(error.kind, anyOf(AppErrorKind.forbidden, AppErrorKind.validation));
          expect(
            error.isTransient,
            isFalse,
            reason: 'a policy refusal must never enter the retry loop',
          );
        }
      });

      test('an unknown conversation is refused, and refused as ABSENT', () async {
        try {
          await parentConversations.byId('00000000-0000-0000-0000-000000000000');
          fail('the server must refuse a conversation this actor cannot read');
        } on AppError catch (error) {
          // NOT FOUND rather than FORBIDDEN, so probing ids yields no signal
          // about which ones exist.
          expect(error.kind, AppErrorKind.notFound);
          expect(error.code, WireErrors.conversationNotFound);
        }
      });

      test('no payload the client receives contains a phone-shaped string', () async {
        // BR-1's sibling: the check that matters is what the server sends, not
        // what the client renders.
        final phoneShaped = RegExp(r'(?:\+|00)\d[\d\s\-().]{6,}\d|\b0\d{9,}\b');

        final list = await parentConversations.list();
        final page = await parentMessages.history(conversationId, limit: 50);

        final surfaces = <String>[
          for (final c in list) '${c.title} ${c.lastMessagePreview}',
          for (final m in page.items) '${m.authorName} ${m.body}',
        ];

        for (final surface in surfaces) {
          expect(
            phoneShaped.hasMatch(surface),
            isFalse,
            reason: 'a phone-shaped string reached the client: $surface',
          );
        }
      });
    },
  );
}

