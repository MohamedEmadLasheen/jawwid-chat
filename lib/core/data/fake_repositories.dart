import 'dart:async';

import '../../shared/models/auth.dart';
import '../../shared/models/conversation.dart';
import '../../shared/models/message.dart';
import '../../shared/models/parent_billing.dart';
import '../../shared/models/parent_profile.dart';
import '../../shared/models/teacher_feedback.dart';
import '../../shared/models/trial.dart';
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
    bool remember = false,
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

  /// Opening a direct channel is **not** offered by the fixture, on purpose.
  ///
  /// Whether two actors may share a channel is `canOpenDirect` — a server
  /// decision made at the moment of the action (since PD-7 it refuses every
  /// teacher<->parent pair; staff pairs depend on scope). A fixture cannot evaluate that, and the only
  /// two things it could do instead are both wrong: fabricate a conversation for
  /// any id handed to it, which makes an unauthorized pairing look like it
  /// worked; or hard-code a pairing, which teaches a rule the server does not
  /// have.
  ///
  /// Refusing is the same call the story repository already makes — the HTTP
  /// composition root registers one and the development root deliberately does
  /// not, because a fixture publication is indistinguishable on screen from a
  /// real one. An authorization result is the same kind of claim.
  ///
  /// The client's own model is the second reason: [Conversation] carries no
  /// counterpart actor id, so there is nothing here to match an actor against.
  @override
  Future<Conversation> openDirect(String withActorId) async {
    throw const AppError(
      AppErrorKind.notFound,
      code: 'direct_open_not_available_in_fixtures',
      debugDetail:
          'openDirect needs a server authorization decision; the fixture has none to give',
    );
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

/// The fixture build's trial repository: no tickets, and a join that the fixture
/// backend records, so a Sales seat can join a trial group without a server.
class FakeTrialRepository implements TrialRepository {
  FakeTrialRepository(this.backend);

  final FakeBackend backend;

  @override
  Future<List<TrialTicket>> tickets(String conversationId) async => const [];

  @override
  Future<void> reportAttendance(String trialId, TrialAttendanceDraft draft) =>
      throw UnsupportedError('no trial server in this build');

  @override
  Future<void> joinGroup(String conversationId) async => backend.joinTrialGroup(conversationId);
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

/// An in-memory parent profile, for tests and for working on the screen with no backend.
///
/// Behaves like the real contract in the ways the UI depends on: every mutation answers with
/// the WHOLE profile, an omitted field is left alone, and a blank About is a clear. It also
/// reproduces the two failure shapes a screen has to handle — a load that throws and a
/// mutation that throws — because those are what the error and retry paths are built for.
/// PD-17, for the fixture build: nothing billed yet. Honest, because it is the
/// signed-in fixture parent's OWN account -- there is no real one behind it.
class FakeBillingRepository implements BillingRepository {
  const FakeBillingRepository();

  @override
  Future<ParentBilling> myBilling() async => ParentBilling.empty;

  // Nothing is owed, so nothing can be paid: there is no request or instalment to name.
  @override
  Future<String> checkout({String? requestId, String? instalmentId}) =>
      throw const AppError(AppErrorKind.notFound, code: 'COMM.BILLING_NOT_FOUND');

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) =>
      throw const AppError(AppErrorKind.notFound, code: 'COMM.BILLING_NOT_FOUND');

  @override
  Future<String> invoiceLink(String invoiceId) =>
      throw const AppError(AppErrorKind.notFound, code: 'COMM.BILLING_NOT_FOUND');

  // No child is locked in the fixture world, so there is nothing to renew.
  @override
  Future<void> requestRenewal(String learnerId) =>
      throw const AppError(AppErrorKind.notFound, code: 'COMM.BILLING_NOT_FOUND');
}

class FakeProfileRepository implements ProfileRepository {
  FakeProfileRepository({
    ParentProfile? initial,
    this.loadError,
    this.mutationError,
  }) : _profile = initial ?? _seed;

  ParentProfile _profile;

  /// Thrown by [me]. The screen should show its error state and offer a retry.
  final AppError? loadError;

  /// Thrown by every mutation. The screen should say so and keep what it was showing.
  final AppError? mutationError;

  static const _seed = ParentProfile(
    displayName: 'ولي أمر',
    relationship: 'والدة',
    signInIdentity: 'qa.parent@qa.jawwid.test',
    children: [
      ChildProfile(id: 'learner-1', displayName: 'أحمد', level: 'الصف الرابع'),
      ChildProfile(id: 'learner-2', displayName: 'يوسف', level: 'الصف الثاني'),
    ],
  );

  @override
  Future<ParentProfile> me() async {
    final error = loadError;
    if (error != null) throw error;
    return _profile;
  }

  @override
  Future<ParentProfile> updateMe({String? name, String? about}) async {
    _guard();
    _profile = ParentProfile(
      // Absent means "leave it alone"; a blank About is an explicit clear.
      displayName: name ?? _profile.displayName,
      relationship: _profile.relationship,
      signInIdentity: _profile.signInIdentity,
      about: about == null ? _profile.about : (about.trim().isEmpty ? null : about.trim()),
      avatarUrl: _profile.avatarUrl,
      canMessage: _profile.canMessage,
      children: _profile.children,
    );
    return _profile;
  }

  @override
  Future<ParentProfile> updateChild(String childId, {String? name, String? about}) async {
    _guard();
    return _withChild(
      childId,
      (child) => ChildProfile(
        id: child.id,
        displayName: name ?? child.displayName,
        level: child.level,
        about: about == null ? child.about : (about.trim().isEmpty ? null : about.trim()),
        avatarUrl: child.avatarUrl,
      ),
    );
  }

  void _guard() {
    final error = mutationError;
    if (error != null) throw error;
  }

  /// Replace exactly one child and leave every sibling untouched — the property the screen
  /// depends on when a parent edits one of several children.
  ParentProfile _withChild(String childId, ChildProfile Function(ChildProfile) change) {
    _profile = ParentProfile(
      displayName: _profile.displayName,
      relationship: _profile.relationship,
      signInIdentity: _profile.signInIdentity,
      about: _profile.about,
      avatarUrl: _profile.avatarUrl,
      canMessage: _profile.canMessage,
      children: [
        for (final child in _profile.children)
          if (child.id == childId) change(child) else child,
      ],
    );
    return _profile;
  }
}

/// PD-32, in memory: the fixture parent's feedback about their children's teachers.
///
/// Behaves like the contract where a screen depends on it: the body is trimmed and
/// bounded, a child with no teacher is refused with `COMM.FEEDBACK_NOT_FOUND`, and the
/// newest item comes first. [refuseWith] makes every submission fail with that code, for
/// the error paths.
class FakeFeedbackRepository implements FeedbackRepository {
  FakeFeedbackRepository({
    List<FeedbackChild>? children,
    List<FeedbackItem> items = const [],
    this.refuseWith,
  })  : _children = children ??
            const [
              FeedbackChild(learnerId: 'learner_1', name: 'أحمد', teacherName: 'teacher_t1'),
              FeedbackChild(learnerId: 'learner_2', name: 'child_two', teacherName: 'teacher_t2'),
            ],
        _items = [...items];

  final List<FeedbackChild> _children;
  final List<FeedbackItem> _items;

  /// Every submission is refused with this code (and the matching kind), when set.
  String? refuseWith;

  /// What was submitted, oldest first.
  final submitted = <FeedbackItem>[];

  int _next = 0;

  @override
  bool get isAvailable => true;

  @override
  Future<MyFeedback> mine() async => MyFeedback(children: _children, items: List.unmodifiable(_items));

  @override
  Future<FeedbackItem> submit({
    required String learnerId,
    required FeedbackCategory category,
    required String body,
  }) async {
    final code = refuseWith;
    if (code != null) {
      throw AppError(
        switch (code) {
          FeedbackErrors.limit => AppErrorKind.rateLimited,
          FeedbackErrors.notFound => AppErrorKind.notFound,
          FeedbackErrors.denied => AppErrorKind.forbidden,
          _ => AppErrorKind.validation,
        },
        code: code,
      );
    }
    final text = body.trim();
    if (text.isEmpty || text.length > FeedbackErrors.maxLength) {
      throw const AppError(AppErrorKind.validation, code: 'COMMON.VALIDATION');
    }
    final child = _children.where((c) => c.learnerId == learnerId).firstOrNull;
    if (child == null || child.teacherName == null) {
      throw const AppError(AppErrorKind.notFound, code: FeedbackErrors.notFound);
    }
    final item = FeedbackItem(
      id: 'feedback_${_next++}',
      learnerId: learnerId,
      childName: child.name,
      teacherName: child.teacherName,
      category: category,
      body: text,
      status: FeedbackStatus.received,
      createdAt: DateTime.now(),
    );
    _items.insert(0, item);
    submitted.add(item);
    return item;
  }
}
