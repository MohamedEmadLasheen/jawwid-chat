/// The realtime contract, mirroring
/// `apps/api/src/communication/contracts/events.ts`.
///
/// These are the backend's strings, not ours. They exist as constants for the
/// same reason [Wire] does: a listener cannot drift from the contract silently,
/// and an event the backend renames fails visibly at the boundary rather than
/// producing a screen that quietly stops updating.
abstract final class RealtimeEvent {
  static const messageCreated = 'message.created';
  static const messageUpdated = 'message.updated';
  static const messageDeleted = 'message.deleted';
  static const messageReceiptUpdated = 'message.receipt.updated';
  static const reactionAdded = 'reaction.added';
  static const reactionRemoved = 'reaction.removed';
  static const typingStarted = 'typing.started';
  static const typingStopped = 'typing.stopped';
  static const presenceChanged = 'presence.changed';
  static const conversationUpdated = 'conversation.updated';
  static const membershipChanged = 'conversation.membership_changed';
  static const approvalDecided = 'approval.decided';

  // Calls (Phase 5). The lifecycle is server-authoritative: these are how the
  // client LEARNS about a transition, never how one is made.
  static const callIncoming = 'call.incoming';
  static const callAccepted = 'call.accepted';
  static const callDeclined = 'call.declined';
  static const callEnded = 'call.ended';
  static const callParticipantJoined = 'call.participant_joined';
  static const callParticipantLeft = 'call.participant_left';

  /// The invitation window closed with nobody answering.
  ///
  /// Emitted by the SERVER's sweeper, not by a client noticing. A recipient
  /// whose app was killed still gets a missed call in their history.
  static const callMissed = 'call.missed';
  static const callCancelled = 'call.cancelled';
  static const callFailed = 'call.failed';

  /// A teacher opened the class. Carries the group and teacher names so the
  /// ring screen can name the class -- but no SENTENCE: the words come from the
  /// notification the server rendered in the recipient's own locale.
  static const classCallStarted = 'call.class_started';

  // Stories and broadcast (Phase 5).
  static const storyPublished = 'story.published';
  static const storyExpired = 'story.expired';
  static const broadcastQueued = 'broadcast.queued';
  static const broadcastProgress = 'broadcast.progress';
  static const broadcastCompleted = 'broadcast.completed';

  /// Client → server frames. The client never names a room: it asks to
  /// subscribe to a conversation id and the server runs the same authorization
  /// the REST path does before joining it.
  static const subscribe = 'conversation.subscribe';
  static const unsubscribe = 'conversation.unsubscribe';
  static const typingStart = 'typing.start';
  static const typingStop = 'typing.stop';
  static const delivered = 'message.delivered';
  static const heartbeat = 'presence.heartbeat';
}

/// Where the realtime connection is.
///
/// [reconnecting] is distinct from [disconnected] on purpose: the first is a
/// transient state the user should not be alarmed by, the second is worth
/// showing an offline banner for.
enum RealtimeStatus { idle, connecting, connected, reconnecting, disconnected }

/// One event as it arrived, before any interpretation.
///
/// Kept as a name plus a raw map rather than a sealed hierarchy of payload
/// types. Events are SIGNALS: most handlers care about two or three fields, an
/// unknown event must be ignorable rather than a parse failure, and a payload
/// the backend extends must not break a client that has not been rebuilt.
class RealtimeEnvelope {
  const RealtimeEnvelope(this.event, this.payload);

  final String event;
  final Map<String, Object?> payload;

  String? get conversationId => payload['conversationId'] as String?;
  String? get messageId => payload['messageId'] as String?;
  String? get actorId => payload['actorId'] as String?;

  @override
  String toString() => 'RealtimeEnvelope($event)';
}
