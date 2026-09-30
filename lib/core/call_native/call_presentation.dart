import 'dart:async';

import 'package:flutter/services.dart';

/// What the person did on the system call screen, or what the system reported.
///
/// These are INTENTIONS, not transitions. Nothing here says a call is ringing,
/// active or over: the server decides that and the client learns it over the
/// realtime connection. A native action is a request to be forwarded, and the
/// forwarding is what `CallController` does with the endpoints W6 already has.
enum NativeCallActionKind {
  /// A VoIP push arrived and the native layer reported a call to CallKit. It
  /// says a call was PRESENTED, never that one exists -- the server is asked.
  incoming,

  /// Answer, from the system call screen.
  answer,

  /// Decline, from the system call screen.
  decline,

  /// Hang up an in-progress call from the system call screen.
  end,
}

/// One action, naming the call it is about.
class NativeCallAction {
  const NativeCallAction({
    required this.kind,
    required this.callId,
    this.conversationId,
  });

  final NativeCallActionKind kind;

  /// The call the native layer is talking about. Correlation only: it
  /// authorizes nothing, and every action it leads to re-runs the full
  /// server-side chain.
  final String callId;

  /// Present for [NativeCallActionKind.incoming], from the push payload.
  final String? conversationId;

  @override
  bool operator ==(Object other) =>
      other is NativeCallAction &&
      other.kind == kind &&
      other.callId == callId &&
      other.conversationId == conversationId;

  @override
  int get hashCode => Object.hash(kind, callId, conversationId);

  @override
  String toString() => 'NativeCallAction(${kind.name}, $callId)';
}

/// Why a system call screen is being taken down.
///
/// The native layer maps these onto the platform's own end reasons. They are
/// descriptive, and none of them is a lifecycle decision: the call was already
/// over, or was never this device's, before any of these is sent.
enum CallDismissReason {
  /// The server said the call ended -- `call.ended`, whatever the outcome.
  remoteEnded,

  /// This device declined it.
  declined,

  /// ANOTHER of this account's devices answered. The call is alive; it is
  /// simply not here. Without this a second phone rings on after the first one
  /// picked up, because `call.ended` is not coming -- the call is ACTIVE.
  answeredElsewhere,

  /// The client could not get far enough to present the call honestly: the
  /// engine, the session or the payload failed. Never left on screen.
  failed,
}

/// THE NATIVE CALL-PRESENTATION SEAM.
///
/// Above it is Jawwid's, and is tested with no simulator, no CallKit and no
/// push; below it is `CXProvider`, `PKPushRegistry` and (later) Android's own
/// presentation. The same arrangement as `RealtimeSocket`, `MediaRoom` and
/// `PushTokens`.
///
/// ## What this is NOT
///
/// It is not a call lifecycle. It holds no ringing/active/ended state, computes
/// no outcome and no duration, and decides nothing about who may call whom. The
/// native side keeps exactly one fact -- which system call object corresponds to
/// which `callId` -- because it has to know what to take off the screen.
///
/// Every action that matters travels back through `CallController` to the same
/// HTTP endpoints a tap on the in-app screen uses, so there is one lifecycle and
/// the server remains its only authority.
abstract interface class CallPresentation {
  /// Begin delivering actions. Idempotent.
  Future<void> start();

  /// Actions from the system call screen.
  Stream<NativeCallAction> actions();

  /// Take a call off the system screen. Safe to call for a call the native
  /// layer no longer knows about, and safe to call twice.
  Future<void> dismiss({
    required String callId,
    required CallDismissReason reason,
  });
}

/// The platform implementation, over one method channel.
class PlatformCallPresentation implements CallPresentation {
  PlatformCallPresentation({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(channelName);

  /// Shared with `CallKitBridge.swift`. One string, two places.
  static const channelName = 'jawwid/call_native';

  final MethodChannel _channel;
  final _actions = StreamController<NativeCallAction>.broadcast();

  /// True once a handler is installed, which is also the proof that this build
  /// HAS a platform side to talk to.
  ///
  /// Without it every channel call has to guess at its own failure mode: a
  /// missing plugin raises `MissingPluginException`, a missing binding raises a
  /// bare `FlutterError`, and catching the second one everywhere reads like
  /// superstition. One flag, set in one place, and the seam is simply inert
  /// where there is nothing beneath it -- a pure-Dart test, a fixture build, a
  /// platform W8-W3 has not reached. Nothing can have presented a call there,
  /// so there is nothing to answer and nothing to take down.
  bool _available = false;

  @override
  Future<void> start() async {
    if (_available) return;

    try {
      _channel.setMethodCallHandler(_onCall);
    } catch (_) {
      // No binary messenger. See [_available].
      return;
    }
    _available = true;

    // Tells native that Dart is listening, which is its cue to drain anything
    // that arrived while the engine was still starting. On a cold wake the push
    // ALWAYS precedes this, so without the drain the call would be on the
    // screen with nothing behind it.
    try {
      await _channel.invokeMethod<void>('ready');
    } catch (_) {
      // Native refused the drain, or there is no native side. It will still
      // deliver live actions; a failed drain must not take the call experience
      // down with it.
    }
  }

  Future<dynamic> _onCall(MethodCall call) async {
    final kind = switch (call.method) {
      'onIncoming' => NativeCallActionKind.incoming,
      'onAnswer' => NativeCallActionKind.answer,
      'onDecline' => NativeCallActionKind.decline,
      'onEnd' => NativeCallActionKind.end,
      _ => null,
    };
    if (kind == null) return null;

    // A malformed message is DROPPED, not guessed at. The alternative is
    // presenting or answering a call whose identity we do not actually know.
    final arguments = call.arguments;
    if (arguments is! Map) return null;
    final callId = arguments['callId'];
    if (callId is! String || callId.isEmpty) return null;
    final conversationId = arguments['conversationId'];

    _actions.add(
      NativeCallAction(
        kind: kind,
        callId: callId,
        conversationId: conversationId is String && conversationId.isNotEmpty
            ? conversationId
            : null,
      ),
    );
    return null;
  }

  @override
  Stream<NativeCallAction> actions() => _actions.stream;

  @override
  Future<void> dismiss({
    required String callId,
    required CallDismissReason reason,
  }) async {
    if (!_available) return;
    try {
      await _channel.invokeMethod<void>('dismiss', {
        'callId': callId,
        'reason': reason.name,
      });
    } catch (_) {
      // The screen is the platform's, and it may already be gone. A failure to
      // remove something that is not there must not propagate into the call
      // lifecycle, which has already moved on.
    }
  }

  void dispose() {
    // Only clear a handler we actually installed: asking the channel again
    // where there is no binary messenger hits the same failure on the way out.
    if (_available) {
      try {
        _channel.setMethodCallHandler(null);
      } catch (_) {
        // The binding went away before we did. Nothing left to detach from.
      }
    }
    _available = false;
    unawaited(_actions.close());
  }
}
