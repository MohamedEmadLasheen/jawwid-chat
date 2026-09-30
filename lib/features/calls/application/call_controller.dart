import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/call_media/audio_route.dart';
import '../../../core/call_media/call_media_client.dart';
import '../../../core/call_media/media_room.dart';
import '../../../core/call_native/call_native_providers.dart';
import '../../../core/call_native/call_presentation.dart';
import '../../../core/data/repositories.dart';
import '../../../core/data/wire/wire_vocab.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/realtime/call_event.dart';
import 'call_media_providers.dart';
import 'call_session.dart';

/// What the interface is showing. PRESENTATION ONLY.
///
/// These are not the call's lifecycle. The lifecycle is the server's and has
/// three states — `ringing`, `active`, `ended` — with three outcomes. These are
/// the screens a person sees while that happens, which is a different and larger
/// set: "connecting" and "reconnecting" are both `active` to the server, and
/// `ended` covers answered, missed and declined.
enum CallUiPhase {
  /// No call on this device.
  idle,

  /// `POST /calls` is in flight. Nothing is ringing yet.
  starting,

  /// We placed the call and it is ringing. *"Calling…"*
  outgoingRinging,

  /// Somebody is calling us and we have not answered.
  incomingRinging,

  /// Answered, and the media room is being joined. *"Connecting…"*
  connecting,

  /// In the room with the microphone published.
  live,

  /// The media connection dropped and we are trying again. THE CALL IS NOT OVER:
  /// only the server ends calls.
  reconnecting,

  /// Terminal. [CallUiState.outcome] carries the server's word for it, when the
  /// server has said it.
  ended,

  /// We could not get the call up. Offers a retry.
  failed,
}

/// Why a call could not be established, reduced to the three things a person can
/// act on. Never a `COMM.*` code, and never a technical message.
enum CallUiFailure {
  /// The microphone is unavailable or was refused.
  microphone,

  /// The server refused: the pairing is not authorized, the call is gone, or
  /// this actor may not join it. Not retryable, and not explained further —
  /// `screens/call.md` §2 wants a safe error and a stop.
  notAllowed,

  /// A transport or media failure. Retryable.
  network,
}

/// Everything the call interface renders, in one value.
class CallUiState {
  const CallUiState({
    this.phase = CallUiPhase.idle,
    this.callId,
    this.conversationId,
    this.peerLabel,
    this.isGroup = false,
    this.microphoneMuted = false,
    this.speakerPreferred = false,
    this.canSwitchSpeaker = false,
    this.hasRemoteAudio = false,
    this.outcome,
    this.duration,
    this.failure,
  });

  final CallUiPhase phase;

  /// The server's call id. Never rendered.
  final String? callId;

  /// The conversation this call belongs to. Never rendered.
  final String? conversationId;

  /// A display name, and only ever a display name. No phone number exists in
  /// this product and none can appear here (G-07).
  final String? peerLabel;

  final bool isGroup;

  /// Orthogonal to [phase], exactly as W4's snapshot is: a muted participant is
  /// still connected and still published.
  final bool microphoneMuted;

  final bool speakerPreferred;

  /// Whether this platform can move audio at all. False hides the control rather
  /// than offering one that does nothing.
  final bool canSwitchSpeaker;

  final bool hasRemoteAudio;

  /// The server's outcome, once the server has stated it. NULL IS MEANINGFUL: a
  /// call we ended ourselves is terminal the moment the request succeeds, but
  /// whether it was `answered` or `missed` is the server's to say, and this stays
  /// null until `call.ended` says so. Guessing would be the client writing
  /// history.
  final CallOutcome? outcome;

  /// From the server's `call.ended`, which derives it from `answered_at`. Never
  /// timed locally.
  final Duration? duration;

  final CallUiFailure? failure;

  bool get isTerminal => phase == CallUiPhase.ended || phase == CallUiPhase.failed;

  /// Whether a call is on screen at all.
  bool get isPresent => phase != CallUiPhase.idle;

  /// Whether the in-call controls apply.
  bool get isConnectedish =>
      phase == CallUiPhase.live || phase == CallUiPhase.reconnecting;

  CallUiState copyWith({
    CallUiPhase? phase,
    String? callId,
    String? conversationId,
    String? peerLabel,
    bool? isGroup,
    bool? microphoneMuted,
    bool? speakerPreferred,
    bool? canSwitchSpeaker,
    bool? hasRemoteAudio,
    CallOutcome? outcome,
    Duration? duration,
    CallUiFailure? failure,
    bool clearFailure = false,
  }) {
    return CallUiState(
      phase: phase ?? this.phase,
      callId: callId ?? this.callId,
      conversationId: conversationId ?? this.conversationId,
      peerLabel: peerLabel ?? this.peerLabel,
      isGroup: isGroup ?? this.isGroup,
      microphoneMuted: microphoneMuted ?? this.microphoneMuted,
      speakerPreferred: speakerPreferred ?? this.speakerPreferred,
      canSwitchSpeaker: canSwitchSpeaker ?? this.canSwitchSpeaker,
      hasRemoteAudio: hasRemoteAudio ?? this.hasRemoteAudio,
      outcome: outcome ?? this.outcome,
      duration: duration ?? this.duration,
      failure: clearFailure ? null : (failure ?? this.failure),
    );
  }
}

/// THE CALL EXPERIENCE. One owner, one state machine, no second lifecycle.
///
/// WHAT IT IS NOT. It is not a call lifecycle. W6 locked that one and it lives on
/// the server:
///
///   accept   -> active            end while active  -> ended / answered
///   decline  -> ended / declined  end while ringing -> ended / missed
///   ring timeout -> ended / missed          ENDED is terminal
///
/// This consumes those facts. It does not reconstruct them, and specifically it
/// NEVER treats any of the following as the end of a call:
///
///   * a participant's `left_at`            — never read here at all
///   * a media participant leaving the room — presence, not lifecycle (W5)
///   * our own media connection dropping    — that is [CallUiPhase.reconnecting]
///   * a participant disappearing
///   * a timer of any kind                  — there is no timer in this file, and
///     an ACTIVE call has no deadline in the current contract (W6 carry-forward)
///
/// Terminality arrives from exactly two places: the server's `call.ended` /
/// `call.declined` events, and a successful terminal request we ourselves made.
///
/// IDEMPOTENT AND ORDER-FREE. `call.declined` and `call.ended` are written in ONE
/// server transaction and share a `created_at`, so their delivery order is not a
/// guarantee the outbox makes. Either order settles once: one navigation, one
/// teardown, one terminal state. `call.ended` is the authority on the outcome and
/// may refine a terminal state it did not create; nothing else re-runs teardown.
///
/// THE SESSION OWNS IT. `build()` watches the signed-in account id, so signing
/// out or switching user disposes this notifier — which tears down the media
/// client and drops the room. The structural property W3 established for the
/// realtime client, for the same reason: no call object outlives the principal
/// it belongs to.
class CallController extends Notifier<CallUiState> {
  CallRepository? _calls;
  AudioRoute? _audio;

  CallMediaClient? _media;
  StreamSubscription<CallMediaSnapshot>? _mediaSub;
  StreamSubscription<CallEvent>? _eventSub;

  /// The system call screen (W8-W3). Presentation only -- see
  /// `call_presentation.dart` for why it holds no lifecycle.
  CallPresentation? _native;
  StreamSubscription<NativeCallAction>? _nativeSub;

  /// Calls this device has asked the native layer to take off the screen, so a
  /// second terminal event does not ask again. Bounded by one call at a time.
  final _dismissed = <String>{};

  /// True while WE are taking the media down, so the `disconnected` snapshot that
  /// follows is not mistaken for a drop.
  bool _leavingMedia = false;

  /// One media retry per call, then stop. The same bounded shape W2 settled on
  /// for credential renewal: a client that retries forever turns one failure into
  /// a storm, and a user who is told "reconnecting" indefinitely is being lied to.
  bool _mediaRetryUsed = false;

  /// True between a drop and audio coming back.
  ///
  /// It is what separates *"Connecting…"* from *"Reconnecting…"*: the media phases
  /// are identical in both cases — join, publish — and only the history
  /// distinguishes them. `screens/call.md` §3 asks for different words and for the
  /// controls to stay, so the difference has to be held somewhere.
  bool _rejoining = false;

  @override
  CallUiState build() {
    // THE IDENTITY IS THE LIFECYCLE. Watching the account id means a sign-out or
    // a user switch recreates this notifier, and the dispose below runs first.
    ref.watch(authControllerProvider.select((state) => state.user?.id));

    try {
      _calls = ref.watch(callRepositoryProvider);
    } catch (_) {
      // A build with no call repository registered has no call experience. Not a
      // fault; the affordance is absent and nothing here can be started.
      _calls = null;
    }
    _audio = ref.watch(audioRouteProvider);

    // Terminal events, and incoming calls, from the session's own client (W3).
    //
    // A REAL SUBSCRIPTION, NOT `ref.listen`. Measured, not assumed: a `ref.listen`
    // registered here only delivers while something is listening to THIS provider,
    // so an incoming call would be noticed or missed depending on whether a widget
    // happened to be watching. A ringing phone cannot depend on that. Subscribing
    // to the client's own stream makes the delivery independent of Riverpod's
    // listener bookkeeping, and `ref.onDispose` below still ties it to the session.
    final client = ref.watch(callRealtimeClientProvider);
    _eventSub = client?.events.listen(_onServerEvent);

    // The system call screen, subscribed the same way and for the same reason:
    // a CallKit answer arrives whenever the person taps it, not when a widget
    // happens to be watching this provider. NOT session-scoped -- on a cold
    // VoIP wake the screen is up before this app knows it has a session.
    _native = ref.watch(callPresentationProvider);
    _nativeSub = _native?.actions().listen(_onNativeAction);
    unawaited(_native?.start());

    ref.onDispose(() {
      unawaited(_eventSub?.cancel());
      _eventSub = null;
      unawaited(_nativeSub?.cancel());
      _nativeSub = null;
      unawaited(_mediaSub?.cancel());
      _mediaSub = null;
      // Release the room. `dispose()` is idempotent in W4 and guards its own
      // double-release, so this is safe however we got here.
      unawaited(_media?.dispose());
      _media = null;
    });

    return CallUiState(canSwitchSpeaker: _audio?.canSwitch ?? false);
  }

  bool get _alive => ref.mounted;

  // ---------------------------------------------------------------- outgoing

  /// Place a call in a conversation.
  ///
  /// The server decides whether it may happen. The capability answer that drew
  /// the button is advisory and may already be stale, so a refusal here is
  /// normal and is rendered as [CallUiFailure.notAllowed] — never as a retry.
  Future<void> start({
    required String conversationId,
    required String peerLabel,
    required bool isGroup,
  }) async {
    final calls = _calls;
    if (calls == null || state.isPresent) return;

    state = CallUiState(
      phase: CallUiPhase.starting,
      conversationId: conversationId,
      peerLabel: peerLabel,
      isGroup: isGroup,
      canSwitchSpeaker: _audio?.canSwitch ?? false,
      speakerPreferred: _audio?.speakerPreferred ?? false,
    );

    try {
      final started = await calls.start(conversationId: conversationId);
      if (!_alive || state.phase != CallUiPhase.starting) return;
      // `started.roomName` is deliberately dropped. The room is signed into the
      // media token by the server; nothing here needs its name and nothing
      // renders it.
      state = state.copyWith(
        phase: CallUiPhase.outgoingRinging,
        callId: started.callId,
      );
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(phase: CallUiPhase.failed, failure: _classify(error));
    }
  }

  // ---------------------------------------------------------------- incoming

  /// Answer a ringing call.
  Future<void> accept() async {
    final calls = _calls;
    final callId = state.callId;
    if (calls == null || callId == null) return;
    if (state.phase != CallUiPhase.incomingRinging) return;

    state = state.copyWith(phase: CallUiPhase.connecting, clearFailure: true);
    try {
      await calls.accept(callId: callId);
    } catch (error) {
      if (!_alive) return;
      // THE SYSTEM SCREEN CANNOT STAY UP ON A FAILED ANSWER (W8-W3). The
      // in-app screen offers a retry and is the place for one; CallKit has no
      // such affordance, so a call it can no longer do anything with must come
      // off it either way. An already-ended call is the server's 409 -- the W6
      // contract, not an inference here.
      _dismissNative(
        callId,
        _alreadyOver(error is AppError ? error.code : null)
            ? CallDismissReason.remoteEnded
            : CallDismissReason.failed,
      );
      state = state.copyWith(phase: CallUiPhase.failed, failure: _classify(error));
      return;
    }
    if (!_alive || state.phase != CallUiPhase.connecting) return;
    await _joinMedia(callId);
  }

  /// Refuse a ringing call.
  ///
  /// A 200 here is the server telling us the call is over: W6 makes decline the
  /// terminal transition, `ended` with `outcome = declined`, unconditionally —
  /// group calls included. So this is terminal locally too, and the
  /// `call.declined` / `call.ended` pair that follows settles onto the same
  /// state instead of doing it again.
  Future<void> decline() async {
    final calls = _calls;
    final callId = state.callId;
    if (calls == null || callId == null) return;
    if (state.phase != CallUiPhase.incomingRinging) return;

    try {
      await calls.decline(callId: callId);
      if (!_alive) return;
      _goTerminal(outcome: CallOutcome.declined);
    } catch (error) {
      if (!_alive) return;
      // A call that has already ended is not an error worth a red screen: the
      // refusal is moot because the call is over either way.
      if (error is AppError && _alreadyOver(error.code)) {
        _goTerminal(outcome: null);
        return;
      }
      state = state.copyWith(phase: CallUiPhase.failed, failure: _classify(error));
    }
  }

  // ------------------------------------------------------------------ in-call

  /// Hang up.
  ///
  /// The OUTCOME IS NOT DECIDED HERE. A successful `POST /calls/:id/end` is the
  /// server telling us the call is terminal, so the screen may close — but
  /// whether history will read `answered` or `missed` is derived server-side from
  /// `answered_at`, and this leaves [CallUiState.outcome] null until `call.ended`
  /// says which. Choosing one here is exactly the "client writes history" defect
  /// W6 removed from the HTTP surface.
  Future<void> hangUp() async {
    final calls = _calls;
    final callId = state.callId;
    if (calls == null || callId == null || state.isTerminal) return;

    try {
      await calls.end(callId: callId);
    } catch (error) {
      if (!_alive) return;
      if (!(error is AppError && _alreadyOver(error.code))) {
        // Ending is cleanup; a failure to reach the server must not strand the
        // user in a call screen they cannot leave. The call may still be live on
        // the server, and its own `call.ended` will arrive when it ends.
        state = state.copyWith(phase: CallUiPhase.failed, failure: _classify(error));
        return;
      }
    }
    if (!_alive) return;
    _goTerminal(outcome: null);
  }

  /// Mute or unmute this device's microphone.
  Future<void> toggleMute() async {
    final media = _media;
    if (media == null || !state.isConnectedish) return;
    state.microphoneMuted ? await media.unmute() : await media.mute();
  }

  /// Move audio between the earpiece and the loudspeaker.
  Future<void> toggleSpeaker() async {
    final audio = _audio;
    if (audio == null || !audio.canSwitch) return;
    final next = !state.speakerPreferred;
    await audio.setSpeakerPreferred(next);
    if (!_alive) return;
    state = state.copyWith(speakerPreferred: audio.speakerPreferred);
  }

  /// Retry after a failure, from the beginning.
  ///
  /// A failed call is not resumed: the call it belonged to may be long gone, and
  /// rejoining a room for it would be the client deciding a dead call is alive.
  /// This starts a NEW call in the same conversation, which is what the user
  /// pressing "Try again" means.
  Future<void> retry() async {
    if (state.phase != CallUiPhase.failed) return;
    final conversationId = state.conversationId;
    final peerLabel = state.peerLabel;
    if (conversationId == null) return;

    await _teardownMedia();
    if (!_alive) return;
    final isGroup = state.isGroup;
    state = CallUiState(canSwitchSpeaker: _audio?.canSwitch ?? false);
    await start(
      conversationId: conversationId,
      peerLabel: peerLabel ?? '',
      isGroup: isGroup,
    );
  }

  /// Leave the terminal screen and return to idle.
  void dismiss() {
    if (!state.isTerminal) return;
    state = CallUiState(canSwitchSpeaker: _audio?.canSwitch ?? false);
  }

  // ------------------------------------------------------------ server events

  void _onServerEvent(CallEvent event) {
    switch (event) {
      case CallIncoming(
          :final callId,
          :final isGroup,
          :final initiatorName,
          :final conversationId,
        ):
        // One call at a time. `screens/call.md` §7: a second call arriving during
        // a call is declined with a missed entry — there is no call waiting in
        // MVP — and the SERVER records that, so this simply does not present it.
        if (state.isPresent) return;
        state = CallUiState(
          phase: CallUiPhase.incomingRinging,
          callId: callId,
          conversationId: conversationId,
          peerLabel: initiatorName,
          isGroup: isGroup,
          canSwitchSpeaker: _audio?.canSwitch ?? false,
          speakerPreferred: _audio?.speakerPreferred ?? false,
        );

      case CallAccepted(:final callId):
        if (callId != state.callId) return;

        // THE CALLER'S CUE TO JOIN MEDIA, and phase is what identifies it as ours
        // to act on rather than an actor-id comparison: the account id is not the
        // actor id (W3), and comparing them would be exactly the identity
        // conflation W3 refused. Only a device that is still ringing an outgoing
        // call joins here; the answering device already joined in `accept()`.
        if (state.phase == CallUiPhase.outgoingRinging) {
          state = state.copyWith(phase: CallUiPhase.connecting);
          unawaited(_joinMedia(callId));
          return;
        }

        // ANOTHER OF THIS ACCOUNT'S DEVICES ANSWERED (W8-W3).
        //
        // Still ringing here means it was answered somewhere else -- this
        // device's own accept() would have left `incomingRinging` already. The
        // call is now ACTIVE, so `call.ended` is NOT coming, and without this a
        // second phone rings on after the first one picked up.
        //
        // Server-driven, not inferred: `call.accepted` is the server's word,
        // delivered to this actor's room by W8-W0b. Nothing is timed and
        // nothing is guessed.
        if (state.phase == CallUiPhase.incomingRinging) {
          _dismissNative(callId, CallDismissReason.answeredElsewhere);
          _goTerminal(outcome: CallOutcome.answered, authoritative: true);
        }

      case CallDeclined(:final callId):
        if (callId != state.callId) return;
        _goTerminal(outcome: CallOutcome.declined);

      case CallEnded(:final callId, :final outcome, :final duration):
        if (callId != state.callId) return;
        // The authority on the outcome, even for a state it did not create.
        _goTerminal(outcome: outcome, duration: duration, authoritative: true);
    }
  }

  // ------------------------------------------------------------ native calls

  /// An action from the system call screen (W8-W3).
  ///
  /// EVERY ONE OF THESE IS FORWARDED, never acted on locally. Answer becomes
  /// the same `POST /calls/:id/accept` the in-app button sends; decline and end
  /// likewise. The server re-runs the full authorization chain and remains the
  /// only thing that decides what a call is doing, so a native tap cannot move
  /// a call by itself and a forged one cannot move it at all.
  void _onNativeAction(NativeCallAction action) {
    if (!_alive) return;

    switch (action.kind) {
      case NativeCallActionKind.incoming:
        // A VoIP push was reported to CallKit before this engine existed. The
        // realtime `call.incoming` is the authority and usually arrives too,
        // so this only fills the gap when the socket is not up yet.
        //
        // NO PEER NAME. The push payload carries none (B-3 is a separate
        // authorization), and inventing one here would put a guess on a lock
        // screen. The realtime event supersedes this state when it lands.
        if (state.isPresent) return;
        state = CallUiState(
          phase: CallUiPhase.incomingRinging,
          callId: action.callId,
          conversationId: action.conversationId,
          isGroup: false,
          canSwitchSpeaker: _audio?.canSwitch ?? false,
          speakerPreferred: _audio?.speakerPreferred ?? false,
        );

      case NativeCallActionKind.answer:
        if (action.callId != state.callId) return;
        unawaited(accept());

      case NativeCallActionKind.decline:
        if (action.callId != state.callId) return;
        unawaited(decline());

      case NativeCallActionKind.end:
        if (action.callId != state.callId) return;
        // CallKit HAS ONE END ACTION for both "refuse this ringing call" and
        // "hang up this one", and those are different server operations --
        // decline writes outcome `declined`, end on a ringing call writes
        // `missed`. The phase decides, and the phase came from the server.
        //
        // Deciding it HERE is what keeps the native side stateless: it would
        // otherwise have to remember whether this call had been answered,
        // which is the first step towards a second lifecycle.
        if (state.phase == CallUiPhase.incomingRinging) {
          unawaited(decline());
        } else {
          unawaited(hangUp());
        }
    }
  }

  /// Ask the native layer to take one call off the system screen, once.
  ///
  /// Idempotent by callId: `_goTerminal` is reachable from several directions
  /// and an already-dismissed call must not be dismissed again. The native side
  /// tolerates a repeat anyway -- this keeps the channel quiet rather than
  /// relying on that.
  void _dismissNative(String callId, CallDismissReason reason) {
    if (!_dismissed.add(callId)) return;
    unawaited(_native?.dismiss(callId: callId, reason: reason));
  }

  /// The one way into a terminal state.
  ///
  /// Called by every terminal path — our own decline, our own hang-up,
  /// `call.declined`, `call.ended` — and safe from all of them in any order.
  void _goTerminal({
    required CallOutcome? outcome,
    Duration? duration,
    bool authoritative = false,
  }) {
    if (state.phase == CallUiPhase.ended) {
      // Already terminal: no second navigation and no second teardown. An
      // authoritative event may still fill in what the server knows and we did
      // not — the outcome, and the duration it derived from `answered_at`.
      if (authoritative) {
        state = state.copyWith(outcome: outcome, duration: duration);
      }
      return;
    }

    // THE SYSTEM SCREEN COMES DOWN HERE, on the one terminal path, so every
    // route to terminal -- our decline, our hang-up, `call.declined`,
    // `call.ended`, the ring timeout -- takes it down exactly once.
    final callId = state.callId;
    if (callId != null) {
      _dismissNative(
        callId,
        outcome == CallOutcome.declined
            ? CallDismissReason.declined
            : CallDismissReason.remoteEnded,
      );
    }

    state = state.copyWith(
      phase: CallUiPhase.ended,
      outcome: outcome,
      duration: duration,
      clearFailure: true,
    );
    unawaited(_teardownMedia());
  }

  // -------------------------------------------------------------------- media

  Future<void> _joinMedia(String callId) async {
    if (_media != null) return;

    final media = ref.read(callMediaClientFactoryProvider)();
    _media = media;
    _leavingMedia = false;
    _mediaSub = media.snapshots.listen(_onMediaSnapshot);
    await media.connect(callId: callId);
  }

  void _onMediaSnapshot(CallMediaSnapshot snapshot) {
    if (!_alive || state.isTerminal) return;

    // Mute travels with every snapshot, whatever the phase: it is orthogonal.
    var next = state.copyWith(
      microphoneMuted: snapshot.microphoneMuted,
      hasRemoteAudio: snapshot.hasRemoteAudio,
    );

    switch (snapshot.phase) {
      case CallMediaPhase.connecting:
      case CallMediaPhase.roomConnected:
      case CallMediaPhase.microphonePublishing:
        next = next.copyWith(
          phase: _rejoining ? CallUiPhase.reconnecting : CallUiPhase.connecting,
        );

      case CallMediaPhase.live:
        _rejoining = false;
        next = next.copyWith(phase: CallUiPhase.live, clearFailure: true);

      case CallMediaPhase.failed:
        next = next.copyWith(
          phase: CallUiPhase.failed,
          failure: _classifyMedia(snapshot.failure),
        );

      case CallMediaPhase.disconnected:
        if (_leavingMedia) return;
        // A DROP IS NOT AN ENDING. W4 does not retry — deliberately, so that no
        // second lifecycle lives in the media layer — so the retry is here, once.
        if (!_mediaRetryUsed) {
          _mediaRetryUsed = true;
          _rejoining = true;
          next = next.copyWith(phase: CallUiPhase.reconnecting);
          state = next;
          final callId = state.callId;
          if (callId != null) unawaited(_media?.connect(callId: callId));
          return;
        }
        next = next.copyWith(
          phase: CallUiPhase.reconnecting,
          failure: CallUiFailure.network,
        );

      case CallMediaPhase.idle:
      case CallMediaPhase.disconnecting:
        // Nothing to say. `disconnecting` is a step on the way out and the phase
        // we are already showing is the truthful one.
        break;
    }

    state = next;
  }

  /// Take the media down exactly once.
  Future<void> _teardownMedia() async {
    final media = _media;
    if (media == null) return;
    _leavingMedia = true;
    _media = null;
    await _mediaSub?.cancel();
    _mediaSub = null;
    // `disconnect` then `dispose` is safe: W4 guards the double release that
    // otherwise tore the SDK down on top of itself.
    await media.disconnect();
    await media.dispose();
  }

  // ------------------------------------------------------------ classification

  /// A server refusal, reduced to something a person can act on.
  ///
  /// The `COMM.*` code decides which of three sentences to show and is never
  /// rendered itself — `screens/call.md` §3 forbids a technical code on this
  /// screen.
  CallUiFailure _classify(Object error) {
    if (error is! AppError) return CallUiFailure.network;
    final code = error.code;
    if (code != null && _notAllowedCodes.contains(code)) {
      return CallUiFailure.notAllowed;
    }
    return switch (error.kind) {
      AppErrorKind.forbidden => CallUiFailure.notAllowed,
      AppErrorKind.unauthenticated => CallUiFailure.notAllowed,
      AppErrorKind.validation => CallUiFailure.notAllowed,
      _ => CallUiFailure.network,
    };
  }

  CallUiFailure _classifyMedia(CallMediaFailure? failure) {
    return switch (failure) {
      CallMediaFailure.microphonePermissionDenied ||
      CallMediaFailure.microphoneUnavailable =>
        CallUiFailure.microphone,
      CallMediaFailure.tokenUnavailable => CallUiFailure.notAllowed,
      CallMediaFailure.connectionFailed ||
      CallMediaFailure.publishFailed =>
        CallUiFailure.network,
      null => CallUiFailure.network,
    };
  }

  bool _alreadyOver(String? code) =>
      code == WireErrors.callAlreadyEnded ||
      code == WireErrors.callNotFound ||
      code == WireErrors.callParticipantLeft ||
      code == WireErrors.callNotRinging ||
      code == WireErrors.callAlreadyDeclined;

  static const _notAllowedCodes = <String>{
    WireErrors.teacherParentNotAuthorized,
    WireErrors.br1TeacherParentDirect,
    WireErrors.notConversationMember,
    WireErrors.actorInactive,
    WireErrors.memberIsSilent,
    WireErrors.callNotAParticipant,
    WireErrors.callAlreadyEnded,
    WireErrors.callNotFound,
    WireErrors.callParticipantLeft,
    WireErrors.conversationArchived,
  };
}

/// The one call controller. Session-scoped, because [CallController.build]
/// watches the signed-in account.
final callControllerProvider =
    NotifierProvider<CallController, CallUiState>(CallController.new);
