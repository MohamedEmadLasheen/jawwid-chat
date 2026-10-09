import 'dart:async';

import '../../shared/models/auth.dart';
import '../../shared/models/conversation.dart';
import '../../shared/models/message.dart';
import '../../shared/models/parent_profile.dart';
import '../../shared/utils/search_text.dart';
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

  /// Search, folded the way the server folds it.
  ///
  /// `toLowerCase().contains()` stood here and was wrong for this audience in
  /// the same way it was wrong on the server: a parent typing `احمد` must find
  /// `أحمد`. The development stack has to behave like production or it teaches
  /// the wrong thing, so this uses the same [SearchText] the UI does and
  /// matches the same three surfaces the server matches.
  @override
  Future<List<Conversation>> search(String query) async {
    if (query.trim().isEmpty) return const [];

    return backend
        .listConversations()
        .where((c) =>
            SearchText.matches(c.displayTitle, query) ||
            SearchText.matches(c.learner?.displayName ?? '', query) ||
            SearchText.matches(c.counterpart?.displayName ?? '', query))
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
  Future<UploadedAttachment> uploadVoiceNote({
    required String conversationId,
    required PendingVoiceNote note,
  }) async =>
      backend.uploadVoiceNote(conversationId, note);

  @override
  Future<UploadedAttachment> uploadAttachment({
    required String conversationId,
    required PendingAttachment attachment,
  }) async =>
      backend.uploadAttachment(conversationId, attachment);

  @override
  Future<void> react({
    required String conversationId,
    required String messageId,
    required String emoji,
  }) async =>
      backend.react(conversationId, messageId, emoji);

  @override
  Future<void> removeReaction({
    required String conversationId,
    required String messageId,
    required String emoji,
  }) async =>
      backend.removeReaction(conversationId, messageId, emoji);

  @override
  Future<void> deleteForMe({
    required String conversationId,
    required String messageId,
  }) async =>
      backend.deleteForMe(conversationId, messageId);

  @override
  Future<void> deleteForEveryone({
    required String conversationId,
    required String messageId,
  }) async =>
      backend.deleteForEveryone(conversationId, messageId);

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
  Future<CallCapability> capability({required String conversationId}) async =>
      const CallCapability(canCall: true);

  @override
  Future<StartedCall> start({required String conversationId}) async =>
      backend.startCall(conversationId: conversationId);

  @override
  Future<CallMediaGrant> mediaToken({required String callId}) async =>
      backend.mediaToken(callId: callId);

  @override
  Future<void> accept({required String callId}) async {}

  @override
  Future<void> decline({required String callId}) async {}

  @override
  Future<void> end({required String callId}) async {}

  @override
  Future<List<CallHistoryEntry>> callHistory({
    required String conversationId,
  }) async =>
      const [];
}

/// A parent profile backed by memory, for development and widget tests.
///
/// Deliberately a real little state machine rather than a stub that returns a constant:
/// the flows worth testing are set -> replace -> remove and the failures around them, and
/// a repository that always answers the same thing cannot exercise any of them.
///
/// It is NOT a security model. Ownership and the parent↔child boundary are decided by the
/// server; this fixture simply does what it is told, which is why every authorization test
/// lives in `apps/api/test/integration/parent-profile.spec.ts` against the real service.
class FakeProfileRepository implements ProfileRepository {
  FakeProfileRepository({
    ParentProfile? initial,
    this.loadError,
    this.mutationError,
  }) : _profile = initial ?? _seed;

  ParentProfile _profile;

  /// Thrown by [me], to exercise the screen's error and retry states.
  final Object? loadError;

  /// Thrown by every mutation, to exercise upload/remove failure handling.
  final Object? mutationError;

  static const _seed = ParentProfile(
    displayName: 'ولي أمر',
    relationship: 'mother',
    signInIdentity: 'qa.parent@qa.jawwid.test',
    children: [
      ChildProfile(id: 'learner-1', displayName: 'أحمد', level: 'المستوى الثالث'),
      ChildProfile(id: 'learner-2', displayName: 'مريم'),
    ],
  );

  @override
  Future<ParentProfile> me() async {
    final error = loadError;
    if (error != null) throw error;
    return _profile;
  }

  @override
  Future<ParentProfile> myAvatar() async {
    final error = loadError;
    if (error != null) throw error;
    // Name and photo only, exactly as the route behaves for a teacher or an admin.
    return ParentProfile(
      displayName: _profile.displayName,
      avatarUrl: _profile.avatarUrl,
      children: const [],
    );
  }

  @override
  Future<ParentProfile> setAvatar(PendingAttachment image) async {
    _failIfAsked();
    _profile = _copy(avatarUrl: 'https://fake.test/${image.fileName ?? 'avatar'}?sig=1');
    return _profile;
  }

  @override
  Future<ParentProfile> removeAvatar() async {
    _failIfAsked();
    _profile = _copy(avatarUrl: null, clearAvatar: true);
    return _profile;
  }

  @override
  Future<ParentProfile> setChildAvatar(String childId, PendingAttachment image) async {
    _failIfAsked();
    _profile = _copyChildren(childId, 'https://fake.test/$childId?sig=1');
    return _profile;
  }

  @override
  Future<ParentProfile> removeChildAvatar(String childId) async {
    _failIfAsked();
    _profile = _copyChildren(childId, null);
    return _profile;
  }

  void _failIfAsked() {
    final error = mutationError;
    if (error != null) throw error;
  }

  ParentProfile _copy({String? avatarUrl, bool clearAvatar = false}) => ParentProfile(
        displayName: _profile.displayName,
        relationship: _profile.relationship,
        signInIdentity: _profile.signInIdentity,
        avatarUrl: clearAvatar ? null : (avatarUrl ?? _profile.avatarUrl),
        canMessage: _profile.canMessage,
        children: _profile.children,
      );

  ParentProfile _copyChildren(String childId, String? avatarUrl) => ParentProfile(
        displayName: _profile.displayName,
        relationship: _profile.relationship,
        signInIdentity: _profile.signInIdentity,
        avatarUrl: _profile.avatarUrl,
        canMessage: _profile.canMessage,
        children: [
          for (final child in _profile.children)
            if (child.id == childId)
              ChildProfile(
                id: child.id,
                displayName: child.displayName,
                level: child.level,
                avatarUrl: avatarUrl,
              )
            else
              child,
        ],
      );
}
