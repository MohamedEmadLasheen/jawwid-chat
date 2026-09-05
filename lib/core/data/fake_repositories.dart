import 'dart:async';

import '../../shared/models/auth.dart';
import '../../shared/models/conversation.dart';
import '../../shared/models/message.dart';
import '../errors/app_error.dart';
import '../storage/secure_token_store.dart';
import 'fake_backend.dart';
import 'repositories.dart';

/// Repository implementations backed by [FakeBackend].
///
/// Development and test only — never wired into a release build (decision D4).
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({required this.backend, required this.tokens});

  final FakeBackend backend;
  final TokenStore tokens;

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async {
    if (username.trim().isEmpty || password.isEmpty) {
      throw const AppError(AppErrorKind.unauthenticated, code: 'invalid_credentials');
    }

    return AuthSession(
      accessToken: 'fake-access',
      refreshToken: 'fake-refresh',
      accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
    );
  }

  @override
  Future<AuthUser> currentUser() async => backend.user;

  @override
  Future<AuthSession> refresh(String refreshToken) async => AuthSession(
        accessToken: 'fake-access-2',
        refreshToken: refreshToken,
        accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
      );

  @override
  Future<void> signOut() async {}

  @override
  Future<List<DeviceSession>> devices() async => [
        DeviceSession(
          id: 'this',
          label: 'iPhone',
          platform: 'iOS',
          lastSeenAt: DateTime.now(),
          isCurrent: true,
        ),
      ];

  @override
  Future<void> revokeDevice(String deviceId) async {}

  @override
  Stream<void> get sessionRevoked => backend.sessionRevoked;
}

class FakeConversationRepository implements ConversationRepository {
  FakeConversationRepository(this.backend);

  final FakeBackend backend;

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async =>
      backend.listConversations(includeArchived: includeArchived);

  @override
  Future<Conversation> byId(String conversationId) async =>
      backend.conversationById(conversationId);

  @override
  Future<void> setPinned(String conversationId, bool pinned) async =>
      backend.updateConversation(conversationId, (c) => c.copyWith(isPinned: pinned));

  @override
  Future<void> setMuted(String conversationId, bool muted) async =>
      backend.updateConversation(conversationId, (c) => c.copyWith(isMuted: muted));

  @override
  Future<void> setArchived(String conversationId, bool archived) async =>
      backend.updateConversation(
        conversationId,
        (c) => c.copyWith(isArchived: archived),
      );

  @override
  Future<void> markRead(String conversationId, {required int throughSequence}) async =>
      backend.updateConversation(conversationId, (c) => c.copyWith(unreadCount: 0));

  @override
  Future<List<Conversation>> search(String query) async {
    final needle = query.toLowerCase();
    return backend
        .listConversations()
        .where((c) => c.title.toLowerCase().contains(needle))
        .toList(growable: false);
  }
}

class FakeMessageRepository implements MessageRepository {
  FakeMessageRepository(this.backend);

  final FakeBackend backend;

  @override
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  }) async =>
      backend.history(conversationId, beforeCursor: beforeCursor, limit: limit);

  @override
  Future<List<Message>> since(
    String conversationId, {
    required int afterSequence,
  }) async =>
      backend.since(conversationId, afterSequence: afterSequence);

  @override
  Future<Message> send(OutgoingMessage message) async => backend.send(message);

  @override
  Future<void> react(String messageId, String emoji) async {}

  @override
  Future<void> removeReaction(String messageId, String emoji) async {}

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {}
}

class FakeGroupRepository implements GroupRepository {
  FakeGroupRepository(this.backend);

  final FakeBackend backend;

  @override
  Future<StudentGroup> group(String conversationId) async =>
      backend.group(conversationId);
}

class FakeCallRepository implements CallRepository {
  FakeCallRepository(this.backend);

  final FakeBackend backend;

  @override
  Future<CallGrant> requestGrant({required String conversationId}) async =>
      backend.requestGrant(conversationId: conversationId);

  @override
  Future<CallGrant> acceptIncoming({required String callId}) async =>
      throw const AppError(AppErrorKind.notFound, code: 'call_not_found');

  @override
  Future<void> decline({required String callId}) async {}

  @override
  Future<Page<CallHistoryEntry>> history({String? cursor}) async =>
      const Page(items: []);
}
