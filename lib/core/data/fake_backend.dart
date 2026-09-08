import 'dart:async';

import '../../shared/models/auth.dart';
import '../../shared/models/conversation.dart';
import '../../shared/models/message.dart';
import '../../shared/models/user_role.dart';
import '../errors/app_error.dart';
import '../policy/communication_policy.dart';
import 'repositories.dart';

/// An in-memory stand-in for the backend.
///
/// This exists because no AI #1 / AI #2 contract has been published yet (decision D4). It is
/// a **development and test fixture only** and is never wired into a release build.
///
/// Two deliberate properties:
///
/// * The seed data uses invented placeholder names. Real staff names, real schedules, and
///   real payment state are business truth that belongs to the backend and must never be
///   hardcoded into the client (§80).
/// * It **enforces the same refusals the real backend must enforce** — a forbidden call is
///   rejected here too. That way the tests exercise the app's failure handling rather than a
///   permissive fake that would hide it.
class FakeBackend {
  FakeBackend({required this.role, DateTime? now})
      : _now = now ?? DateTime.utc(2026, 9, 5, 12) {
    _seed();
  }

  final UserRole role;
  final DateTime _now;

  final _conversations = <String, Conversation>{};
  final _messages = <String, List<Message>>{};
  final _groups = <String, StudentGroup>{};
  final _sessionRevoked = StreamController<void>.broadcast();

  int _sequence = 0;

  /// Set to make the next network-ish call fail, so tests can drive error paths.
  AppError? nextFailure;

  /// Set to make every call fail until cleared — used to assert a settled error state,
  /// which a single-shot failure cannot do once retries are in play.
  AppError? persistentFailure;

  void dispose() => _sessionRevoked.close();

  /// Simulate the backend ending this session (§7, §9).
  void revokeSession() => _sessionRevoked.add(null);

  Stream<void> get sessionRevoked => _sessionRevoked.stream;

  AuthUser get user => AuthUser(
        id: role == UserRole.parent ? 'u_parent' : 'u_teacher',
        displayName: role == UserRole.parent ? 'ولي أمر' : 'معلم',
        role: role,
        timeZone: 'Africa/Cairo',
      );

  void _seed() {
    if (role == UserRole.parent) {
      _addConversation(
        Conversation(
          id: 'c_support',
          kind: ConversationKind.jawwidSupport,
          title: 'جَوِّد',
          updatedAt: _now,
          lastMessageAt: _now.subtract(const Duration(minutes: 4)),
          lastMessagePreview: 'أهلًا بك، كيف يمكننا مساعدتك؟',
          unreadCount: 1,
          isPinned: true,
          handledByLabel: 'المشرفة المناوبة',
        ),
      );

      _addGroup(
        conversationId: 'c_group_1',
        learner: const LearnerRef(id: 'l_1', displayName: 'أحمد'),
        includeParent: true,
      );
      _addGroup(
        conversationId: 'c_group_2',
        learner: const LearnerRef(id: 'l_2', displayName: 'سارة'),
        includeParent: true,
      );
    } else {
      _addGroup(
        conversationId: 'c_group_1',
        learner: const LearnerRef(id: 'l_1', displayName: 'أحمد'),
        includeParent: true,
      );

      _addConversation(
        Conversation(
          id: 'c_admin',
          kind: ConversationKind.adminDirect,
          title: 'إدارة جَوِّد',
          updatedAt: _now.subtract(const Duration(hours: 2)),
          lastMessageAt: _now.subtract(const Duration(hours: 2)),
          lastMessagePreview: 'برجاء مراجعة جدول الحصص.',
        ),
      );
    }
  }

  void _addConversation(Conversation conversation) {
    _conversations[conversation.id] = conversation;
    _messages.putIfAbsent(conversation.id, () => []);

    _appendServerMessage(
      conversationId: conversation.id,
      body: conversation.lastMessagePreview,
      authorName: conversation.title,
      authorRole: ParticipantRole.admin,
      at: conversation.lastMessageAt ?? conversation.updatedAt,
    );
  }

  void _addGroup({
    required String conversationId,
    required LearnerRef learner,
    required bool includeParent,
  }) {
    _addConversation(
      Conversation(
        id: conversationId,
        kind: ConversationKind.studentGroup,
        title: '${learner.displayName} · جَوِّد',
        learner: learner,
        updatedAt: _now.subtract(const Duration(hours: 1)),
        lastMessageAt: _now.subtract(const Duration(hours: 1)),
        lastMessagePreview: 'تم تأكيد موعد الحصة القادمة.',
        requiresApproval: true,
      ),
    );

    _groups[conversationId] = StudentGroup(
      conversationId: conversationId,
      learner: learner,
      requiresApproval: true,
      members: [
        if (includeParent)
          const GroupMember(
            id: 'm_parent',
            displayName: 'ولي الأمر',
            role: ParticipantRole.parent,
          ),
        const GroupMember(
          id: 'm_teacher',
          displayName: 'المعلم',
          role: ParticipantRole.teacher,
        ),
        const GroupMember(
          id: 'm_admin',
          displayName: 'المشرفة',
          role: ParticipantRole.admin,
        ),
      ],
    );
  }

  Message _appendServerMessage({
    required String conversationId,
    required String body,
    required String authorName,
    required ParticipantRole authorRole,
    required DateTime at,
  }) {
    final message = Message(
      id: 'srv_${++_sequence}',
      clientMessageId: 'seed_$_sequence',
      conversationId: conversationId,
      sequence: _sequence,
      authorName: authorName,
      authorRole: authorRole,
      kind: MessageKind.text,
      body: body,
      createdAt: at,
      deliveryState: DeliveryState.delivered,
    );

    _messages.putIfAbsent(conversationId, () => []).add(message);
    return message;
  }

  void _maybeFail() {
    final persistent = persistentFailure;
    if (persistent != null) throw persistent;

    final failure = nextFailure;
    if (failure != null) {
      nextFailure = null;
      throw failure;
    }
  }

  // --- Repository surface ------------------------------------------------------------

  List<Conversation> listConversations({bool includeArchived = false}) {
    _maybeFail();
    return _conversations.values
        .where((c) => includeArchived || !c.isArchived)
        .toList(growable: false);
  }

  Conversation conversationById(String id) {
    _maybeFail();
    final conversation = _conversations[id];
    if (conversation == null) {
      throw const AppError(AppErrorKind.notFound, code: 'conversation_not_found');
    }
    return conversation;
  }

  void updateConversation(String id, Conversation Function(Conversation) update) {
    final existing = _conversations[id];
    if (existing != null) _conversations[id] = update(existing);
  }

  Page<Message> history(String conversationId, {String? beforeCursor, int limit = 30}) {
    _maybeFail();
    final all = List<Message>.from(_messages[conversationId] ?? const [])
      ..sort((a, b) => (a.sequence ?? 0).compareTo(b.sequence ?? 0));

    final before = beforeCursor == null ? null : int.tryParse(beforeCursor);
    final eligible =
        before == null ? all : all.where((m) => (m.sequence ?? 0) < before).toList();

    final start = eligible.length > limit ? eligible.length - limit : 0;
    final page = eligible.sublist(start);

    return Page(
      items: page,
      nextCursor: page.isEmpty ? null : '${page.first.sequence}',
      hasMore: start > 0,
    );
  }

  List<Message> since(String conversationId, {required int afterSequence}) {
    _maybeFail();
    return (_messages[conversationId] ?? const <Message>[])
        .where((m) => (m.sequence ?? 0) > afterSequence)
        .toList(growable: false);
  }

  /// Accept an outgoing message, honouring idempotency: re-sending the same
  /// [OutgoingMessage.clientMessageId] returns the original rather than creating a second
  /// message. This mirrors the server behaviour requested in C6.
  Message send(OutgoingMessage outgoing) {
    _maybeFail();

    final conversation = conversationById(outgoing.conversationId);
    final existing = (_messages[outgoing.conversationId] ?? const <Message>[])
        .where((m) => m.clientMessageId == outgoing.clientMessageId);
    if (existing.isNotEmpty) return existing.first;

    final approval = conversation.requiresApproval
        ? ApprovalState.pending
        : ApprovalState.notRequired;

    final message = Message(
      id: 'srv_${++_sequence}',
      clientMessageId: outgoing.clientMessageId,
      conversationId: outgoing.conversationId,
      sequence: _sequence,
      authorId: user.id,
      authorName: user.displayName,
      authorRole: role == UserRole.parent
          ? ParticipantRole.parent
          : ParticipantRole.teacher,
      kind: outgoing.kind,
      body: outgoing.body,
      createdAt: _now,
      deliveryState: DeliveryState.sent,
      approvalState: approval,
      isMine: true,
    );

    _messages.putIfAbsent(outgoing.conversationId, () => []).add(message);
    return message;
  }

  /// Apply an edit, the way the server does: the body is replaced, the message
  /// is stamped, and its ordering and send time are untouched.
  Message edit(String conversationId, String messageId, String body) {
    _maybeFail();
    final list = _messages[conversationId] ?? const <Message>[];
    final index = list.indexWhere((m) => m.id == messageId);
    if (index < 0) {
      throw const AppError(AppErrorKind.notFound, code: 'message_not_found');
    }
    if (!list[index].isMine) {
      throw const AppError(AppErrorKind.forbidden, code: 'COMM.NOT_MESSAGE_AUTHOR');
    }

    final updated = list[index].copyWith(body: body, editedAt: _now);
    _messages[conversationId]![index] = updated;
    return updated;
  }

  /// Hide a message from this user only. Nothing else changes about it, which
  /// is the distinction the real per-user deletion makes.
  void hideForMe(String conversationId, String messageId) {
    _maybeFail();
    _messages[conversationId]?.removeWhere((m) => m.id == messageId);
  }

  /// Withdraw a message for everyone: the row stays, the body does not.
  void deleteForEveryone(String conversationId, String messageId) {
    _maybeFail();
    final list = _messages[conversationId] ?? const <Message>[];
    final index = list.indexWhere((m) => m.id == messageId);
    if (index < 0) return;
    _messages[conversationId]![index] =
        list[index].copyWith(isDeleted: true, body: '');
  }

  /// Add or replace this user's reaction. One per user per message, matching
  /// the unique index the real schema carries.
  void react(String conversationId, String messageId, String? emoji) {
    _maybeFail();
    final list = _messages[conversationId] ?? const <Message>[];
    final index = list.indexWhere((m) => m.id == messageId);
    if (index < 0) return;

    final current = list[index];
    final others = current.reactions
        .map((r) => r.mine ? r.copyWith(count: r.count - 1, mine: false) : r)
        .where((r) => r.count > 0)
        .toList();

    if (emoji != null) {
      final existing = others.indexWhere((r) => r.emoji == emoji);
      if (existing >= 0) {
        others[existing] = others[existing]
            .copyWith(count: others[existing].count + 1, mine: true);
      } else {
        others.add(Reaction(emoji: emoji, count: 1, mine: true));
      }
    }

    _messages[conversationId]![index] = current.copyWith(reactions: others);
  }

  /// Copy a message into other conversations, as the forwarder.
  List<Message> forward(
    String conversationId,
    String messageId,
    List<String> toConversationIds,
  ) {
    _maybeFail();
    final source = (_messages[conversationId] ?? const <Message>[])
        .where((m) => m.id == messageId);
    if (source.isEmpty) {
      throw const AppError(AppErrorKind.notFound, code: 'message_not_found');
    }

    return [
      for (final target in toConversationIds)
        send(
          OutgoingMessage(
            clientMessageId: 'fwd_${++_sequence}',
            conversationId: target,
            kind: source.first.kind,
            body: source.first.body,
          ),
        ),
    ];
  }

  /// Search every conversation this fake holds. The real backend scopes by
  /// authorization; the fake holds only the signed-in user's conversations, so
  /// searching all of them is the same set.
  List<MessageSearchHit> searchMessages(MessageSearchQuery query) {
    _maybeFail();
    final needle = query.text.trim().toLowerCase();
    final hits = <MessageSearchHit>[];

    for (final entry in _messages.entries) {
      if (query.conversationId != null && entry.key != query.conversationId) continue;

      for (final message in entry.value) {
        if (message.isDeleted) continue;
        if (!message.body.toLowerCase().contains(needle)) continue;
        if (query.authorId != null && message.authorId != query.authorId) continue;
        if (query.from != null && message.createdAt.isBefore(query.from!)) continue;
        if (query.to != null && message.createdAt.isAfter(query.to!)) continue;

        hits.add(
          MessageSearchHit(
            message: message,
            conversationId: entry.key,
            conversationTitle: _conversations[entry.key]?.title ?? '',
          ),
        );
      }
    }

    hits.sort((a, b) => b.message.createdAt.compareTo(a.message.createdAt));
    return hits;
  }

  StudentGroup group(String conversationId) {
    _maybeFail();
    final group = _groups[conversationId];
    if (group == null) {
      throw const AppError(AppErrorKind.notFound, code: 'group_not_found');
    }
    return group;
  }

  /// Authorize a call, refusing the forbidden pairing exactly as the backend must (§32).
  CallGrant requestGrant({required String conversationId}) {
    _maybeFail();
    final conversation = conversationById(conversationId);

    if (conversation.kind == ConversationKind.adminDirect ||
        conversation.kind == ConversationKind.jawwidSupport) {
      if (!CommunicationPolicy.allowsDirectCall(role, ParticipantRole.admin)) {
        throw const AppError(AppErrorKind.forbidden, code: 'call_not_allowed');
      }
    }

    return CallGrant(
      callId: 'call_${conversationId}_$_sequence',
      serverUrl: 'wss://livekit.invalid',
      token: 'fake-token',
      expiresAt: _now.add(const Duration(minutes: 5)),
    );
  }
}
