/// The realtime event contract, client side.
///
/// Mirrors `apps/api/src/communication/contracts/events.ts`. Names are constants
/// for the same reason they are on the server: no code in this app subscribes to
/// a raw string, so a rename on either side is a compile error rather than an
/// event that silently stops arriving.
library;

/// Server → client event names.
///
/// The full set is declared even though this build only listens to some of
/// them. The transport is shared: when the messages feature subscribes to
/// `messageCreated` it adds a listener, not a second socket.
abstract final class RealtimeEvents {
  static const messageCreated = 'message.created';
  static const messageDeleted = 'message.deleted';
  static const messageReceiptUpdated = 'message.receipt.updated';
  static const reactionAdded = 'reaction.added';
  static const reactionRemoved = 'reaction.removed';
  static const typingStarted = 'typing.started';
  static const typingStopped = 'typing.stopped';
  static const presenceChanged = 'presence.changed';
  static const conversationUpdated = 'conversation.updated';
  static const membershipChanged = 'conversation.membership_changed';
  static const approvalRequested = 'approval.requested';
  static const approvalDecided = 'approval.decided';
  static const callIncoming = 'call.incoming';
  static const callAccepted = 'call.accepted';
  static const callDeclined = 'call.declined';
  static const callEnded = 'call.ended';
  static const callParticipantJoined = 'call.participant_joined';
  static const callParticipantLeft = 'call.participant_left';
  static const notificationCreated = 'notification.created';

  /// The parent read something on ANOTHER of their devices. Published to their
  /// own actor room, so it reaches every device they are signed in on and no
  /// one else's.
  static const notificationRead = 'notification.read';

  /// Every event the transport forwards. Anything outside this set is dropped
  /// rather than passed on: a server that starts emitting something new must
  /// not be able to push an unrecognised payload into this app's event stream.
  static const all = <String>{
    messageCreated,
    messageDeleted,
    messageReceiptUpdated,
    reactionAdded,
    reactionRemoved,
    typingStarted,
    typingStopped,
    presenceChanged,
    conversationUpdated,
    membershipChanged,
    approvalRequested,
    approvalDecided,
    callIncoming,
    callAccepted,
    callDeclined,
    callEnded,
    callParticipantJoined,
    callParticipantLeft,
    notificationCreated,
    notificationRead,
  };
}

/// Client → server event names.
abstract final class RealtimeCommands {
  static const subscribeConversation = 'conversation.subscribe';
  static const unsubscribeConversation = 'conversation.unsubscribe';
  static const typingStart = 'typing.start';
  static const typingStop = 'typing.stop';
  static const presenceHeartbeat = 'presence.heartbeat';
  static const messageDelivered = 'message.delivered';
}

/// One event off the wire.
class RealtimeEvent {
  const RealtimeEvent({required this.name, required this.payload});

  final String name;
  final Map<String, Object?> payload;

  String? get conversationId => payload['conversationId'] as String?;
}

/// What the transport is doing, for the UI that cares.
///
/// `reconnecting` is distinct from `disconnected` deliberately: a parent on a
/// train should see "reconnecting", not "offline", and the two call for
/// different copy.
enum RealtimeStatus { disconnected, connecting, connected, reconnecting }
