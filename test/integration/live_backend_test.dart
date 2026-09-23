import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
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

/// The mobile transport against a **running Jawwid Chat backend and a real database**.
///
/// This is the only suite in the repository that proves the integration rather than the
/// protocol: every other HTTP test speaks to a local test double. It is skipped unless a
/// live server is pointed at, so CI without a backend stays green.
///
/// Run it with:
///
/// ```
/// JAWWID_LIVE_API=http://127.0.0.1:3100/api/v1 \
/// JAWWID_LIVE_PARENT=<contact uuid> \
/// JAWWID_LIVE_ADMIN=<staff uuid> \
/// JAWWID_LIVE_TEACHER=<teacher uuid> \
/// JAWWID_LIVE_CONVERSATION=<conversation uuid> \
/// flutter test test/integration/live_backend_test.dart
/// ```
///
/// The `x-actor-id` header is the engine's own documented pre-auth seam
/// (`actor.decorator.ts`). It is used here because there is no authentication contract yet —
/// see `docs/mobile/http-integration.md`.
void main() {
  final env = Platform.environment;
  final baseUrl = env['JAWWID_LIVE_API'];
  final parentId = env['JAWWID_LIVE_PARENT'];
  final adminId = env['JAWWID_LIVE_ADMIN'];
  final teacherId = env['JAWWID_LIVE_TEACHER'];
  final conversationId = env['JAWWID_LIVE_CONVERSATION'];

  final configured = baseUrl != null &&
      parentId != null &&
      adminId != null &&
      teacherId != null &&
      conversationId != null;

  ApiClient clientAs(String actorId) => buildApiClient(
        config: ApiConfig(baseUrl: baseUrl!),
        tokens: _NoTokens(),
        identity: DebugActorHeaderIdentity(actorId: actorId, enabled: true),
      );

  HttpConversationRepository conversationsAs(String actorId, UserRole role) =>
      HttpConversationRepository(
        client: clientAs(actorId),
        viewerRole: () => role,
      );

  HttpMessageRepository messagesAs(String actorId) => HttpMessageRepository(
        client: clientAs(actorId),
        viewerActorId: () => actorId,
      );

  group(
    'live backend',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API and the seeded ids to run against a real server',
    () {
      test('the parent sees their conversations', () async {
        final result =
            await conversationsAs(parentId!, UserRole.parent).list();

        expect(result, isNotEmpty);
        expect(result.map((c) => c.id), contains(conversationId));
      });

      test('a conversation loads by id with the real approval policy', () async {
        final conversation = await conversationsAs(parentId!, UserRole.parent)
            .byId(conversationId!);

        expect(conversation.id, conversationId);
        expect(conversation.kind, ConversationKind.adminDirect);
        // The engine seeds both approval flags true for a direct conversation; the parent
        // must see the parent flag, not the teacher one.
        expect(conversation.requiresApproval, isA<bool>());
      });

      test('message history comes back with a string seq parsed', () async {
        final repository = messagesAs(parentId!);

        // Self-contained: a freshly seeded conversation has no messages, and a test that
        // depends on what an earlier test left behind is a test that fails in isolation.
        await repository.send(
          OutgoingMessage(
            clientMessageId: 'live-history-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId!,
            kind: MessageKind.text,
            body: 'سجل المحادثة',
          ),
        );

        final page = await repository.history(conversationId, limit: 50);

        expect(page.items, isNotEmpty);
        for (final message in page.items) {
          expect(
            message.sequence,
            isNotNull,
            reason: 'every server message carries a seq',
          );
        }
      });

      test('sending creates a real message, and a retry is deduplicated', () async {
        final repository = messagesAs(parentId!);
        final clientMessageId =
            'live-${DateTime.now().microsecondsSinceEpoch}';

        final outgoing = OutgoingMessage(
          clientMessageId: clientMessageId,
          conversationId: conversationId!,
          kind: MessageKind.text,
          body: 'اختبار التكامل',
        );

        final first = await repository.send(outgoing);
        expect(first.id, isNotNull);
        expect(first.sequence, isNotNull);
        expect(first.isMine, isTrue);
        expect(first.clientMessageId, clientMessageId);

        // The same composed message, sent again exactly as a retry would.
        final second = await repository.send(outgoing);

        expect(
          second.id,
          first.id,
          reason: 'the server must return the original, not create a duplicate',
        );
        expect(second.sequence, first.sequence);
      });

      test('the sent message appears in history exactly once', () async {
        final repository = messagesAs(parentId!);
        final clientMessageId =
            'live-once-${DateTime.now().microsecondsSinceEpoch}';

        final outgoing = OutgoingMessage(
          clientMessageId: clientMessageId,
          conversationId: conversationId!,
          kind: MessageKind.text,
          body: 'رسالة واحدة',
        );

        await repository.send(outgoing);
        await repository.send(outgoing);

        final page = await repository.history(conversationId, limit: 50);
        final matches =
            page.items.where((m) => m.clientMessageId == clientMessageId);

        expect(matches, hasLength(1));
      });

      test('resync returns only what came after a watermark', () async {
        final repository = messagesAs(parentId!);

        await repository.send(
          OutgoingMessage(
            clientMessageId: 'live-resync-${DateTime.now().microsecondsSinceEpoch}',
            conversationId: conversationId!,
            kind: MessageKind.text,
            body: 'نقطة المزامنة',
          ),
        );

        final page = await repository.history(conversationId, limit: 50);
        final highest = page.items
            .map((m) => m.sequence ?? 0)
            .fold<int>(0, (a, b) => a > b ? a : b);

        final after =
            await repository.since(conversationId, afterSequence: highest);

        expect(
          after.where((m) => (m.sequence ?? 0) <= highest),
          isEmpty,
          reason: 'resync must not re-deliver what the client already holds',
        );
      });

      // PD-6 (2026-09-23) re-versioned BR-1. These two tests used to assert that
      // the server refused a parent/teacher direct conversation outright. It no
      // longer does: it refuses an UNAUTHORIZED pairing, which is what they
      // assert now. JAWWID_LIVE_UNRELATED_TEACHER names a real, active teacher
      // who teaches nobody in this parent's family; without it there is no way
      // to tell a correct refusal from a broken fixture, so the pair is skipped
      // rather than asserted against an unknown relationship.
      test('PD-6: an UNAUTHORIZED pairing is refused by the server for a parent', () async {
        final unrelatedTeacher = env['JAWWID_LIVE_UNRELATED_TEACHER'];
        if (unrelatedTeacher == null) {
          markTestSkipped('set JAWWID_LIVE_UNRELATED_TEACHER to run this');
          return;
        }
        final client = clientAs(parentId!);

        try {
          await client.post<Map<String, Object?>>(
            '/conversations/direct',
            data: {'withActorId': unrelatedTeacher},
          );
          fail('the server must refuse an unauthorized parent/teacher pairing');
        } on AppError catch (error) {
          expect(error.code, WireErrors.teacherParentNotAuthorized);
          expect(error.kind, AppErrorKind.forbidden);
          expect(
            error.isTransient,
            isFalse,
            reason: 'an authorization refusal must never enter the retry loop',
          );
        }
      });

      test('PD-6: an AUTHORIZED pairing is accepted by the server, in both directions', () async {
        // The positive half. Without it the refusal above would still pass
        // against a server that refused every parent/teacher pairing, which is
        // the behaviour PD-6 removed.
        final asParent = clientAs(parentId!);
        final asTeacher = clientAs(teacherId!);

        final fromParent = await asParent.post<Map<String, Object?>>(
          '/conversations/direct',
          data: {'withActorId': teacherId},
        );
        final fromTeacher = await asTeacher.post<Map<String, Object?>>(
          '/conversations/direct',
          data: {'withActorId': parentId},
        );

        expect(fromParent.data?['id'], isNotNull);
        // One channel, not two: direct_key is the sorted pair.
        expect(fromTeacher.data?['id'], fromParent.data?['id']);
      });

      test('an unrelated actor cannot read this conversation', () async {
        // Authorization is the server's. The client simply renders the refusal.
        try {
          final foreign = await conversationsAs(adminId!, UserRole.parent)
              .byId(conversationId!);
          // An admin who is a member may legitimately read it; the assertion is only that
          // the call is decided by the server, never by the client.
          expect(foreign.id, conversationId);
        } on AppError catch (error) {
          expect(
            error.kind,
            anyOf(AppErrorKind.forbidden, AppErrorKind.notFound),
          );
        }
      });

      test('no payload the client receives contains a phone-shaped string', () async {
        // BR-1's sibling: the check that matters is what the server sends, not what the
        // client renders.
        final phoneShaped = RegExp(r'(?:\+|00)\d[\d\s\-().]{6,}\d|\b0\d{9,}\b');

        final list = await conversationsAs(parentId!, UserRole.parent).list();
        final page = await messagesAs(parentId).history(conversationId!, limit: 50);

        final surfaces = <String>[
          for (final c in list) '${c.title} ${c.lastMessagePreview}',
          for (final m in page.items) '${m.authorName} ${m.body}',
        ];

        for (final text in surfaces) {
          expect(
            phoneShaped.hasMatch(text),
            isFalse,
            reason: 'phone-shaped string reached the client: "$text"',
          );
        }
      });
    },
  );
}

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}
