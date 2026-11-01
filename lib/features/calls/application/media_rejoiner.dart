import 'dart:async';

/// CHATSCHED-013 (owner): after our media drops, rejoin -- at once, then after
/// 1, 2, 4 and every 8 s -- until the media is back or the call is over.
///
/// It can only ask for a rejoin. Ending a call is the SERVER's (a drop nobody
/// came back from within 60 s ends as `connection_lost`, by `call.ended`), and
/// nothing here can end one: that is why the waiting lives in this class and
/// not in the controller, whose source guard forbids a timer of any kind.
class MediaRejoiner {
  MediaRejoiner(this._rejoin, {List<Duration>? waits}) : _waits = waits ?? defaultWaits;

  static const defaultWaits = [Duration.zero, Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 4), Duration(seconds: 8)];

  final void Function() _rejoin;
  final List<Duration> _waits;
  Timer? _timer;
  int _attempts = 0;

  /// How many rejoins were asked for since the media was last live.
  int get attempts => _attempts;

  /// The next rejoin, after its wait. One at a time.
  void schedule() {
    if (_timer != null) return;
    final wait = _waits[_attempts.clamp(0, _waits.length - 1)];
    _attempts++;
    _timer = Timer(wait, () {
      _timer = null;
      _rejoin();
    });
  }

  /// The media is back, or the call is over: no more rejoining, and the next
  /// drop starts from the first wait again.
  void stop() {
    _timer?.cancel();
    _timer = null;
    _attempts = 0;
  }
}
