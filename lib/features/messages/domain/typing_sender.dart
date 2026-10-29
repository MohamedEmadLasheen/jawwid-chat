import 'dart:async';

/// PD-37: says "typing" for one conversation while the draft changes, and
/// "stopped" on send, an empty draft, a pause, or leaving.
///
/// Throttled here (one ping per [pingEvery]) and debounced again on the
/// server, which also decides whether this person may type there at all (a
/// seated member) and who hears it (seated members only). Pure Dart: the screen
/// hands it a [send] and the clock, so it is tested without a socket.
class TypingSender {
  TypingSender({
    required this.send,
    this.pingEvery = const Duration(seconds: 3),
    this.stopAfter = const Duration(seconds: 5),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  /// `true` for typing.start, `false` for typing.stop.
  final void Function(bool typing) send;
  final Duration pingEvery;
  final Duration stopAfter;
  final DateTime Function() _now;

  DateTime? _lastPing;
  Timer? _idle;
  bool _active = false;

  /// Every change of the draft.
  void typed(String draft) {
    if (draft.trim().isEmpty) {
      stop();
      return;
    }
    final now = _now();
    final last = _lastPing;
    if (last == null || now.difference(last) >= pingEvery) {
      send(true);
      _lastPing = now;
      _active = true;
    }
    _idle?.cancel();
    _idle = Timer(stopAfter, stop);
  }

  void stop() {
    _idle?.cancel();
    _idle = null;
    if (!_active) return;
    _active = false;
    _lastPing = null;
    send(false);
  }

  void dispose() => stop();
}
