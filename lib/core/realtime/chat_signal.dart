/// The chat events the backend publishes, reduced to what a client may do with
/// them: know WHICH conversation changed, and go and ask the server.
///
/// Mirrors `apps/api/src/communication/contracts/events.ts`. Every one of these
/// is a SIGNAL, never content: `message.created` deliberately carries no body,
/// and nothing here could render a message even if it wanted to. The client
/// refetches through the same authorized REST routes it reads history from, so
/// an event can never show anybody something the read path would refuse.
library;

/// What changed, at the granularity a client acts on.
enum ChatSignalKind {
  /// `message.created` — a published message exists at [ChatSignal.seq].
  messageCreated,

  /// `message.deleted`, `message.updated` (an edit), `reaction.added`,
  /// `reaction.removed`, `approval.decided` — an EXISTING message changed. Its seq is unchanged,
  /// so a catch-up "after my newest seq" would not see it.
  messageChanged,

  /// `conversation.updated` — activity, state or handler moved.
  conversationUpdated,

  /// `conversation.membership_changed` (members joined or left) and
  /// `conversation.added` (sent to the added actor's own room: a conversation
  /// this account belongs to now exists, and it is not subscribed to it yet).
  membershipChanged,

  /// `conversation.access_revoked` — the server removed this socket from the
  /// conversation room because the actor may no longer read it.
  accessRevoked,

  /// Not a server event: the transport (re)connected, so anything may have
  /// been missed while it was down.
  reconnected,
}

class ChatSignal {
  const ChatSignal(this.kind, {this.conversationId, this.seq});

  const ChatSignal.reconnected() : this(ChatSignalKind.reconnected);

  final ChatSignalKind kind;

  /// Null only for [ChatSignalKind.reconnected].
  final String? conversationId;

  /// Server sequence of the new message, for [ChatSignalKind.messageCreated].
  final int? seq;

  @override
  String toString() => 'ChatSignal($kind, $conversationId, $seq)';
}

/// The wire names, in one place.
abstract final class ChatEventNames {
  static const messageCreated = 'message.created';
  static const messageDeleted = 'message.deleted';
  static const messageUpdated = 'message.updated';
  static const reactionAdded = 'reaction.added';
  static const reactionRemoved = 'reaction.removed';
  static const approvalDecided = 'approval.decided';
  static const conversationUpdated = 'conversation.updated';
  static const membershipChanged = 'conversation.membership_changed';
  static const conversationAdded = 'conversation.added';
  static const accessRevoked = 'conversation.access_revoked';

  /// PD-37: the ticks on this account's OWN messages changed (to the author only).
  static const messageStatus = 'message.status';

  /// PD-37: someone seated in the conversation started or stopped typing.
  static const typingStarted = 'typing.started';
  static const typingStopped = 'typing.stopped';

  /// PD-34: this account read the conversation on another device. Sent to the account's
  /// own room only; refetching the conversation clears its unread badge here too.
  static const conversationRead = 'conversation.read';
}

/// Decode a frame. Null when it is not a chat event, or when it names no
/// conversation -- a signal that cannot be routed is dropped, never guessed at.
ChatSignal? decodeChatSignal(String event, Object? payload) {
  final kind = switch (event) {
    ChatEventNames.messageCreated => ChatSignalKind.messageCreated,
    ChatEventNames.messageDeleted ||
    ChatEventNames.messageUpdated ||
    ChatEventNames.reactionAdded ||
    ChatEventNames.reactionRemoved ||
    ChatEventNames.approvalDecided ||
    ChatEventNames.messageStatus =>
      ChatSignalKind.messageChanged,
    ChatEventNames.conversationUpdated ||
    ChatEventNames.conversationRead =>
      ChatSignalKind.conversationUpdated,
    ChatEventNames.membershipChanged ||
    ChatEventNames.conversationAdded =>
      ChatSignalKind.membershipChanged,
    ChatEventNames.accessRevoked => ChatSignalKind.accessRevoked,
    _ => null,
  };
  if (kind == null || payload is! Map) return null;

  final conversationId = payload['conversationId'];
  if (conversationId is! String || conversationId.isEmpty) return null;

  final rawSeq = payload['seq'];
  final seq = rawSeq is int
      ? rawSeq
      : rawSeq is String
          ? int.tryParse(rawSeq)
          : null;

  return ChatSignal(kind, conversationId: conversationId, seq: seq);
}

/// PD-37: "someone is typing" -- ephemeral, never stored. The server sends it
/// only to seated members, and only from a seated member; this client draws it
/// and lets it lapse.
class TypingSignal {
  const TypingSignal({
    required this.conversationId,
    required this.actorId,
    required this.displayName,
    required this.typing,
  });

  final String conversationId;
  final String actorId;
  final String displayName;

  /// True for `typing.started`, false for `typing.stopped`.
  final bool typing;
}

/// Decode a typing frame; null for anything else or anything incomplete.
TypingSignal? decodeTypingSignal(String event, Object? payload) {
  final typing = switch (event) {
    ChatEventNames.typingStarted => true,
    ChatEventNames.typingStopped => false,
    _ => null,
  };
  if (typing == null || payload is! Map) return null;
  final conversationId = payload['conversationId'];
  final actorId = payload['actorId'];
  if (conversationId is! String || conversationId.isEmpty) return null;
  if (actorId is! String || actorId.isEmpty) return null;
  final name = payload['displayName'];
  return TypingSignal(
    conversationId: conversationId,
    actorId: actorId,
    displayName: name is String ? name : '',
    typing: typing,
  );
}
