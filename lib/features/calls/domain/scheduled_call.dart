/// Scheduled calls and call links (PD-13), as the client reads them.
///
/// AN ANNOUNCEMENT, NEVER A GRANT. A scheduled call belongs to exactly one
/// conversation and is posted into it as a card. Nothing about it authorizes a
/// call: the first Join starts the call through the ordinary call path and every
/// later Join takes a seat in it, and the server decides each of those again.
/// See `docs/communication/scheduled-calls.md`.
library;

/// `scheduled` is set for a time; `link` starts now and is joinable at once.
enum ScheduledCallKind { scheduled, link }

/// The server's word for where the call is, computed with ITS clock at response
/// time. The client re-derives "can I join yet" from the window instead of
/// trusting this to still be true when the row is tapped.
enum ScheduledCallState { upcoming, open, cancelled, over }

class ScheduledCall {
  const ScheduledCall({
    required this.id,
    required this.conversationId,
    required this.kind,
    required this.startsAt,
    required this.joinableFrom,
    required this.joinableUntil,
    required this.state,
    required this.canCancel,
    this.title,
    this.createdByName,
  });

  final String id;
  final String conversationId;
  final ScheduledCallKind kind;

  /// Optional, at most 120 characters. Null when the creator gave none.
  final String? title;

  final DateTime startsAt;
  final DateTime joinableFrom;
  final DateTime joinableUntil;
  final ScheduledCallState state;

  /// A display name, and only ever a display name. Null when unresolved.
  final String? createdByName;

  /// Whether the server says this viewer may cancel it (the creator only).
  final bool canCancel;

  bool get isLink => kind == ScheduledCallKind.link;

  /// Whether Join should be offered at [now]. Advisory: the server's answer to
  /// Join is final, and a cancellation can arrive between this and the tap.
  bool isJoinableAt(DateTime now) =>
      state != ScheduledCallState.cancelled &&
      state != ScheduledCallState.over &&
      isWithinWindow(now, joinableFrom, joinableUntil);
}

/// `[from, until]`, inclusive at both ends, as the server defines the window.
bool isWithinWindow(DateTime now, DateTime from, DateTime until) =>
    !now.isBefore(from) && !now.isAfter(until);

/// What `POST /scheduled-calls/:id/join` decided.
enum ScheduledJoinMode {
  /// This member started the call; it is ringing the others.
  started,

  /// A call is already live and this member has a seat in it.
  joined,
}

class ScheduledJoin {
  const ScheduledJoin({
    required this.callId,
    required this.conversationId,
    required this.mode,
  });

  final String callId;
  final String conversationId;
  final ScheduledJoinMode mode;
}

/// What a Join produced, reduced to what a person can be told.
///
/// Never a `COMM.*` code on screen: the code picks one of these and the screen
/// picks the sentence.
enum ScheduledJoinResult {
  /// The call is on screen now (ringing out, or connecting).
  joined,

  /// Cancelled, not open yet, or already over (`COMM.SCHEDULED_CALL_NOT_JOINABLE`).
  notJoinable,

  /// A parent's Join on a group call nobody has started yet
  /// (`COMM.PARENT_CANNOT_START_GROUP_CALL`): the call starts when staff or the
  /// teacher join.
  waitingForHost,

  /// Any other refusal: not a member, no seat, not found.
  notAllowed,

  /// Another call is already on this device.
  busy,

  /// This build has no call or scheduled-call repository registered.
  unavailable,

  /// The request did not complete. Retryable.
  network,
}

/// The `COMM.*` codes this feature reacts to specifically. Mirrors
/// `apps/api/src/platform/errors.ts`.
abstract final class ScheduledCallCodes {
  static const notFound = 'COMM.SCHEDULED_CALL_NOT_FOUND';
  static const denied = 'COMM.SCHEDULED_CALL_DENIED';
  static const notJoinable = 'COMM.SCHEDULED_CALL_NOT_JOINABLE';
  static const parentCannotStartGroupCall =
      'COMM.PARENT_CANNOT_START_GROUP_CALL';
}

/// The card kinds a scheduled call posts into its conversation.
abstract final class ScheduledCallCards {
  static const scheduled = 'call_scheduled';
  static const link = 'call_link';
  static const cancelled = 'call_schedule_cancelled';

  static const all = {scheduled, link, cancelled};
}
