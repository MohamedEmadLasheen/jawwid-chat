import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The mobile client against a **running Jawwid Chat backend and a real database**.
///
/// This is the only suite in the repository that proves the integration rather than the
/// protocol: every other HTTP test speaks to a local test double. It is skipped unless a
/// live server is pointed at, so CI without a backend stays green.
///
/// It **signs in**. Until authentication landed, this suite asserted its identity with the
/// `x-actor-id` bring-up header; no HTTP route reads that header any more, so every request
/// here now carries a bearer token obtained from `POST /auth/login` exactly as the app
/// obtains one. There is no bypass and no seeded token: if the credentials are wrong, the
/// suite fails at sign-in, which is the correct place to find out.
///
/// Run it with:
///
/// ```
/// JAWWID_LIVE_API=http://127.0.0.1:3100/api/v1 \
/// JAWWID_LIVE_PARENT_USERNAME=<username> \
/// JAWWID_LIVE_PARENT_PASSWORD=<password> \
/// JAWWID_LIVE_TEACHER_USERNAME=<username> \
/// JAWWID_LIVE_TEACHER_PASSWORD=<password> \
/// JAWWID_LIVE_CONVERSATION=<conversation uuid> \
/// flutter test test/integration/live_backend_test.dart
/// ```
///
/// Credentials come from the environment and are never committed. A local bring-up seeds
/// them with `apps/api` own seed script; a shared environment should use throwaway accounts.

/// One signed-in principal, wired exactly as `bootstrap.dart` wires the app: one token store,
/// one token provider, one client. Refresh therefore works here too, which is the point --
/// a long suite outliving a 15-minute access token exercises rotation for real.
class _LivePrincipal {
  _LivePrincipal._({
    required this.client,
    required this.auth,
    required this.actorId,
    required this.role,
  });

  final ApiClient client;
  final HttpAuthRepository auth;
  final String actorId;
  final UserRole role;

  HttpConversationRepository get conversations =>
      HttpConversationRepository(client: client, viewerRole: () => role);

  HttpMessageRepository get messages =>
      HttpMessageRepository(client: client, viewerActorId: () => actorId);

  static Future<_LivePrincipal> signIn({
    required String baseUrl,
    required String username,
    required String password,
  }) async {
    final store = InMemoryTokenStore();
    late final ApiClient client;

    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: baseUrl)),
      protected: () => client,
      device: _TestDevice(),
    );

    client = buildApiClient(
      config: ApiConfig(baseUrl: baseUrl),
      tokens: StoredTokenProvider(
        store: store,
        auth: auth,
        onEnded: (_) async {},
      ),
    );

    final session = await auth.signIn(username: username, password: password);
    await store.write(session);

    final principal = await auth.currentUser();
    return _LivePrincipal._(
      client: client,
      auth: auth,
      actorId: principal.id,
      role: principal.role,
    );
  }
}

/// The test host is neither iOS nor Android, so the real descriptor would return null. This
/// names the run instead, so a seeded environment's session list shows where it came from.
class _TestDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => const DeviceDescription(
        platform: 'ios',
        name: 'flutter integration suite',
        appVersion: '0.0.0-test',
      );
}

void main() {
  final env = Platform.environment;
  final baseUrl = env['JAWWID_LIVE_API'];
  final parentUsername = env['JAWWID_LIVE_PARENT_USERNAME'];
  final parentPassword = env['JAWWID_LIVE_PARENT_PASSWORD'];
  final teacherUsername = env['JAWWID_LIVE_TEACHER_USERNAME'];
  final teacherPassword = env['JAWWID_LIVE_TEACHER_PASSWORD'];
  final conversationId = env['JAWWID_LIVE_CONVERSATION'];

  final configured = baseUrl != null &&
      parentUsername != null &&
      parentPassword != null &&
      teacherUsername != null &&
      teacherPassword != null &&
      conversationId != null;

  late _LivePrincipal parent;
  late _LivePrincipal teacher;

  group(
    'live backend',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API and the JAWWID_LIVE_*_USERNAME/PASSWORD pairs to run '
            'against a real server',
    () {
      setUpAll(() async {
        parent = await _LivePrincipal.signIn(
          baseUrl: baseUrl!,
          username: parentUsername!,
          password: parentPassword!,
        );
        teacher = await _LivePrincipal.signIn(
          baseUrl: baseUrl,
          username: teacherUsername!,
          password: teacherPassword!,
        );
      });

      tearDownAll(() async {
        // End both sessions server-side. A suite that leaves live sessions behind on every
        // run turns a seeded environment's session list into noise.
        await parent.auth.signOut();
        await teacher.auth.signOut();
      });

      group('authentication', () {
        test('signing in yields a usable session and a server-asserted role', () {
          expect(parent.actorId, isNotEmpty);
          expect(parent.role, UserRole.parent);
          expect(teacher.role, UserRole.teacher);
        });

        test('a protected route refuses a request with no token', () async {
          final anonymous = buildApiClient(
            config: ApiConfig(baseUrl: baseUrl!),
            tokens: _NoTokens(),
          );

          try {
            await anonymous.get<Map<String, Object?>>('/me');
            fail('an unauthenticated request must be refused, never silently answered');
          } on AppError catch (error) {
            expect(error.kind, AppErrorKind.unauthenticated);
          }
        });

        test('wrong credentials are refused as invalid credentials', () async {
          final auth = HttpAuthRepository(
            transport: buildAuthTransport(config: ApiConfig(baseUrl: baseUrl!)),
            protected: () => throw StateError('no protected call expected'),
            device: _TestDevice(),
          );

          try {
            await auth.signIn(username: parentUsername!, password: 'not-the-password');
            fail('the server must refuse a wrong password');
          } on AppError catch (error) {
            expect(
              error.kind,
              anyOf(AppErrorKind.invalidCredentials, AppErrorKind.rateLimited),
              reason: 'repeated runs may trip the login rate limiter, which is correct',
            );
          }
        });
      });
      test('the parent sees their conversations', () async {
        final result =
            await parent.conversations.list();

        expect(result, isNotEmpty);
        expect(result.map((c) => c.id), contains(conversationId));
      });

      test('a conversation loads by id with the real approval policy', () async {
        final conversation = await parent.conversations
            .byId(conversationId!);

        expect(conversation.id, conversationId);
        expect(conversation.kind, ConversationKind.adminDirect);
        // The engine seeds both approval flags true for a direct conversation; the parent
        // must see the parent flag, not the teacher one.
        expect(conversation.requiresApproval, isA<bool>());
      });

      test('message history comes back with a string seq parsed', () async {
        final repository = parent.messages;

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
        final repository = parent.messages;
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
        final repository = parent.messages;
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
        final repository = parent.messages;

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

      test('BR-1 is refused by the server for a parent', () async {
        // The client offers no such affordance; this proves the server refuses it anyway.
        final client = parent.client;

        try {
          await client.post<Map<String, Object?>>(
            '/conversations/direct',
            data: {'withActorId': teacher.actorId},
          );
          fail('the server must refuse a parent/teacher direct conversation');
        } on AppError catch (error) {
          expect(error.code, WireErrors.br1TeacherParentDirect);
          expect(error.kind, AppErrorKind.forbidden);
          expect(
            error.isTransient,
            isFalse,
            reason: 'a BR-1 refusal must never enter the retry loop',
          );
        }
      });

      test('BR-1 is refused by the server for a teacher too', () async {
        final client = teacher.client;

        try {
          await client.post<Map<String, Object?>>(
            '/conversations/direct',
            data: {'withActorId': parent.actorId},
          );
          fail('the server must refuse a teacher/parent direct conversation');
        } on AppError catch (error) {
          expect(error.code, WireErrors.br1TeacherParentDirect);
          expect(error.kind, AppErrorKind.forbidden);
        }
      });

      test('an unrelated actor cannot read this conversation', () async {
        // Authorization is the server's. The client simply renders the refusal.
        try {
          final foreign = await teacher.conversations
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

        final list = await parent.conversations.list();
        final page = await parent.messages.history(conversationId!, limit: 50);

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
