import '../../../core/data/repositories.dart';

/// What the call UI is doing right now.
///
/// Distinct from [CallStatus], which is the SERVER's view of the call. This is
/// the client's view of its own participation, and the two are deliberately
/// separate: `connecting` and `joining` are facts about this device that the
/// server neither knows nor needs to.
enum CallPhase {
  /// No call on screen.
  idle,

  /// We are placing a call and waiting for the server to authorize it.
  dialling,

  /// Our outgoing call is ringing at the other end.
  ringing,

  /// Somebody is calling US.
  incoming,

  /// Authorized; attaching to the media room.
  connecting,

  /// In the call.
  connected,

  /// Terminal for this screen.
  ended,
}

/// The whole state of the call screen.
///
/// Immutable, and always carries [call] -- the SERVER's view -- alongside the
/// local [phase]. When the two disagree the server wins, and having both on one
/// object is what makes that reconciliation a single obvious line rather than
/// something spread across a controller.
class CallSession {
  const CallSession({
    this.phase = CallPhase.idle,
    this.call,
    this.incoming,
    this.grant,
    this.errorCode,
    this.isMuted = false,
  });

  final CallPhase phase;

  /// The authoritative record. Null before the server has created the call.
  final CallView? call;

  /// Set while an invitation is on screen.
  final IncomingCall? incoming;

  /// The media credential. Short-lived and never persisted.
  final CallGrant? grant;

  /// A stable error code, never prose: the UI branches on it.
  final String? errorCode;
  final bool isMuted;

  bool get isActive => phase != CallPhase.idle && phase != CallPhase.ended;

  /// Whether to show the recording indicator.
  ///
  /// Driven off the SERVER's mode, never off whether this device asked for a
  /// recorded call. A participant who joined a follow-up call somebody else
  /// started must see the indicator too -- that is the entire point of it.
  bool get isRecordable => call?.mode == CallMode.followUp;

  CallSession copyWith({
    CallPhase? phase,
    CallView? call,
    IncomingCall? incoming,
    CallGrant? grant,
    String? errorCode,
    bool? isMuted,
    bool clearIncoming = false,
    bool clearError = false,
  }) =>
      CallSession(
        phase: phase ?? this.phase,
        call: call ?? this.call,
        incoming: clearIncoming ? null : (incoming ?? this.incoming),
        grant: grant ?? this.grant,
        errorCode: clearError ? null : (errorCode ?? this.errorCode),
        isMuted: isMuted ?? this.isMuted,
      );

  static const idle = CallSession();
}
