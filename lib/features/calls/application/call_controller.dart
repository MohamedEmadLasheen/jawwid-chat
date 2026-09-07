import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../core/data/wire/wire_phase5.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/realtime/realtime_client.dart';
import '../../../core/realtime/realtime_events.dart';
import '../domain/call_session.dart';

/// The call screen's state machine, on the client side.
///
/// ## The rule this class is built around
///
/// **The server owns the call; this owns the screen.** Every transition here is
/// a request whose answer is a [CallView], and the view is applied verbatim.
/// The controller never decides that a call connected, ended, or was missed --
/// it renders what came back. Local state that outranked the server would be a
/// screen showing a call the other person is not on.
///
/// Three consequences the code makes explicit:
///
///  * **Duplicate events are free.** Realtime is a hint, not a source of truth.
///    A `call.ended` that arrives twice, or after the REST response already
///    said the same thing, lands on a call that is already ended and changes
///    nothing.
///  * **Stale invitations are dropped.** A push delivered late, or an app
///    resumed an hour after the fact, must not ring for a call that is over.
///    Every incoming invitation is checked against its own expiry AND
///    reconciled against the server before the ring screen commits.
///  * **Reconnect re-reads.** On resume, the controller asks the server what
///    the call actually is rather than trusting what it had in memory.
class CallController extends Notifier<CallSession> {
  CallController({
    required CallRepository calls,
    RealtimeClient? realtime,
  })  : _calls = calls,
        _realtime = realtime;

  final CallRepository _calls;
  final RealtimeClient? _realtime;

  Timer? _ringTimeout;

  @override
  CallSession build() {
    final subscription = _realtime?.events.listen(_onEvent);
    ref.onDispose(() {
      _ringTimeout?.cancel();
      unawaited(subscription?.cancel());
    });
    return CallSession.idle;
  }

  // --- Outgoing -------------------------------------------------------------

  /// Place a call.
  ///
  /// [followUp] ASKS for a recordable call. Whether it becomes one is the
  /// server's answer, read back off the call view -- so a client that asks and
  /// is refused shows an ordinary call rather than a recording indicator over
  /// a call nobody is recording.
  Future<void> start(String conversationId, {bool followUp = false}) async {
    state = const CallSession(phase: CallPhase.dialling);
    try {
      final grant = await _calls.requestGrant(
        conversationId: conversationId,
        followUp: followUp,
      );
      final call = await _calls.callById(grant.callId);
      state = state.copyWith(
        phase: CallPhase.ringing,
        call: call,
        grant: grant,
        clearError: true,
      );
      _armRingTimeout(call);
    } on AppError catch (error) {
      state = CallSession(phase: CallPhase.ended, errorCode: error.code);
    }
  }

  /// A teacher opens the class.
  Future<void> startClassCall(String conversationId) async {
    state = const CallSession(phase: CallPhase.dialling);
    try {
      final grant = await _calls.startClassCall(conversationId: conversationId);
      final call = await _calls.callById(grant.callId);
      state = state.copyWith(
        phase: CallPhase.ringing,
        call: call,
        grant: grant,
        clearError: true,
      );
      _armRingTimeout(call);
    } on AppError catch (error) {
      state = CallSession(phase: CallPhase.ended, errorCode: error.code);
    }
  }

  // --- Incoming -------------------------------------------------------------

  /// An invitation arrived, by realtime or by push.
  ///
  /// Refuses to ring for anything stale. Both checks matter and neither
  /// subsumes the other: the local expiry catches an invitation that is
  /// obviously over without a round trip, and the server reconciliation catches
  /// one that was declined or cancelled well before its expiry.
  Future<void> presentIncoming(IncomingCall invitation, {DateTime? now}) async {
    if (invitation.isStale(now ?? DateTime.now())) return;
    // Never interrupt a call in progress with an invitation to another one.
    if (state.phase == CallPhase.connected || state.phase == CallPhase.connecting) {
      return;
    }

    state = state.copyWith(phase: CallPhase.incoming, incoming: invitation, clearError: true);

    // The server is the authority on whether this call is still worth ringing
    // for. A push that sat in a queue, or an app resumed from the background,
    // both arrive here looking exactly like a fresh invitation.
    try {
      final call = await _calls.callById(invitation.callId);
      if (!call.isLive) {
        state = CallSession.idle;
        return;
      }
      state = state.copyWith(call: call);
      _armRingTimeout(call);
    } on AppError {
      // Unreachable or gone: do not ring for a call we cannot confirm.
      state = CallSession.idle;
    }
  }

  Future<void> accept() async {
    final callId = state.incoming?.callId ?? state.call?.id;
    if (callId == null) return;

    state = state.copyWith(phase: CallPhase.connecting, clearError: true);
    try {
      final grant = await _calls.acceptIncoming(callId: callId);
      final call = await _calls.callById(callId);
      _ringTimeout?.cancel();
      state = state.copyWith(
        phase: CallPhase.connected,
        call: call,
        grant: grant,
        clearIncoming: true,
      );
    } on AppError catch (error) {
      // The commonest cause is legitimate: somebody else answered, or the call
      // timed out while the ring screen was up. The refusal is the server
      // telling us the screen is out of date.
      state = CallSession(phase: CallPhase.ended, errorCode: error.code);
    }
  }

  Future<void> decline() async {
    final callId = state.incoming?.callId ?? state.call?.id;
    if (callId == null) return;
    _ringTimeout?.cancel();
    // Optimistic: the screen closes immediately. Declining is idempotent
    // server-side, so a failure here costs nothing and a retry is safe.
    state = const CallSession(phase: CallPhase.ended);
    try {
      await _calls.decline(callId: callId);
    } on AppError {
      // Already ended, or unreachable. Either way the screen is right.
    }
  }

  // --- Ending ---------------------------------------------------------------

  /// Hang up, or withdraw a call nobody answered.
  ///
  /// Which verb to use is decided from the SERVER's view, not from what this
  /// screen thinks it is doing: `cancel` is the initiator withdrawing an
  /// unanswered call, and reporting that as a hang-up would put a missed call
  /// in the recipient's history for a call the caller never let ring.
  Future<void> hangUp({bool failed = false}) async {
    final call = state.call;
    if (call == null) {
      state = const CallSession(phase: CallPhase.ended);
      return;
    }
    _ringTimeout?.cancel();

    try {
      final updated = call.status == CallStatus.ringing && !failed
          ? await _calls.cancel(callId: call.id)
          : await _calls.end(callId: call.id, failed: failed);
      state = state.copyWith(phase: CallPhase.ended, call: updated);
    } on AppError catch (error) {
      // `end` is a no-op on an already-ended call, so a failure here is a
      // network problem rather than a state problem. The screen still closes:
      // the alternative is trapping the user on a call UI they have left.
      state = state.copyWith(phase: CallPhase.ended, errorCode: error.code);
    }
  }

  void toggleMute() => state = state.copyWith(isMuted: !state.isMuted);

  void dismiss() {
    _ringTimeout?.cancel();
    state = CallSession.idle;
  }

  /// Re-read the call from the server.
  ///
  /// Called on realtime reconnect and on app resume. This is the whole recovery
  /// story: whatever happened while the socket was down, the server knows, and
  /// one request replaces every guess this client might otherwise make.
  Future<void> reconcile() async {
    final callId = state.call?.id ?? state.incoming?.callId;
    if (callId == null) return;
    try {
      final call = await _calls.callById(callId);
      if (!call.isLive) {
        state = state.copyWith(phase: CallPhase.ended, call: call, clearIncoming: true);
        return;
      }
      state = state.copyWith(
        call: call,
        phase: call.status == CallStatus.active && state.phase == CallPhase.connected
            ? CallPhase.connected
            : state.phase,
      );
    } on AppError {
      // Leave the screen as it is rather than tearing down a live call because
      // one poll failed.
    }
  }

  // --- Realtime -------------------------------------------------------------

  void _onEvent(RealtimeEnvelope envelope) {
    final callId = envelope.payload['callId'] as String?;

    switch (envelope.event) {
      case RealtimeEvent.callIncoming:
      case RealtimeEvent.classCallStarted:
        unawaited(presentIncoming(WirePhase5.incomingCall(envelope.payload)));

      case RealtimeEvent.callAccepted:
        // Somebody answered. For the CALLER this is the transition to
        // connected; for another invitee it just means the call is live.
        if (callId != null && callId == state.call?.id) {
          _ringTimeout?.cancel();
          if (state.phase == CallPhase.ringing) {
            state = state.copyWith(phase: CallPhase.connected);
          }
        }

      case RealtimeEvent.callEnded:
      case RealtimeEvent.callMissed:
      case RealtimeEvent.callDeclined:
      case RealtimeEvent.callCancelled:
      case RealtimeEvent.callFailed:
        // Idempotent by construction: a repeat of any of these lands on a
        // screen that is already ended and changes nothing.
        if (callId != null &&
            (callId == state.call?.id || callId == state.incoming?.callId)) {
          _ringTimeout?.cancel();
          state = state.copyWith(phase: CallPhase.ended, clearIncoming: true);
        }
    }
  }

  /// Stop ringing when the invitation lapses.
  ///
  /// A LOCAL convenience only. The call becomes MISSED because the server's
  /// sweeper says so -- this just stops the phone ringing at roughly the right
  /// moment instead of until the user gives up. If this timer never fires, the
  /// call is still correctly recorded as missed.
  void _armRingTimeout(CallView call) {
    _ringTimeout?.cancel();
    final expiry = call.ringExpiresAt;
    if (expiry == null) return;
    final remaining = expiry.difference(DateTime.now());
    if (remaining.isNegative) {
      state = state.copyWith(phase: CallPhase.ended, clearIncoming: true);
      return;
    }
    _ringTimeout = Timer(remaining, () {
      if (state.phase == CallPhase.ringing || state.phase == CallPhase.incoming) {
        state = state.copyWith(phase: CallPhase.ended, clearIncoming: true);
        unawaited(reconcile());
      }
    });
  }
}
