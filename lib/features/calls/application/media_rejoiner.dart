import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// CHATSCHED-013 (owner): after our media drops, rejoin -- at once, then after
/// 1, 2, 4 and every 8 s -- until the media is back or the call is over.
///
/// It can only ask for a rejoin. Ending a call is the SERVER's (a drop nobody
/// came back from within 60 s ends as `connection_lost`, by `call.ended`), and
/// nothing here can end one: that is why the waiting lives in this class and
/// not in the controller, whose source guard forbids a timer of any kind.
///
/// ONE BOUND (review of #367): a phone that is offline never hears `call.ended`,
/// and a token request that never reaches the server is no answer either. So after
/// [giveUpAfter] -- the server's grace and then some -- of rejoining without the
/// media coming back, [_giveUp] is told instead of another rejoin: by then the
/// server has ended the call, whether or not this phone heard it.
class MediaRejoiner {
  MediaRejoiner(this._rejoin, {List<Duration>? waits, Duration giveUpAfter = defaultGiveUpAfter, void Function()? onGiveUp})
      : _waits = waits ?? defaultWaits,
        _giveUpAfter = giveUpAfter,
        _giveUp = onGiveUp;

  static const defaultWaits = [Duration.zero, Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 4), Duration(seconds: 8)];

  /// The server's 60 s grace, and 30 s for the answer that never came.
  static const defaultGiveUpAfter = Duration(seconds: 90);

  final void Function() _rejoin;
  final List<Duration> _waits;
  final Duration _giveUpAfter;
  final void Function()? _giveUp;
  final Stopwatch _since = Stopwatch();
  Timer? _timer;
  int _attempts = 0;

  /// How many rejoins were asked for since the media was last live.
  int get attempts => _attempts;

  /// The next rejoin, after its wait. One at a time.
  void schedule() {
    if (_timer != null) return;
    if (_attempts == 0) {
      _since
        ..reset()
        ..start();
    }
    final wait = _waits[_attempts.clamp(0, _waits.length - 1)];
    _attempts++;
    _timer = Timer(wait, () {
      _timer = null;
      if (_since.elapsed >= _giveUpAfter) {
        stop();
        _giveUp?.call();
        return;
      }
      _rejoin();
    });
  }

  /// The media is back, or the call is over: no more rejoining, and the next
  /// drop starts from the first wait again.
  void stop() {
    _timer?.cancel();
    _timer = null;
    _attempts = 0;
    _since
      ..stop()
      ..reset();
  }
}

/// How long the call controller keeps rejoining before it takes the call to be
/// over ([MediaRejoiner.defaultGiveUpAfter]). A provider so a test can shorten it.
final callRejoinLimitProvider = Provider<Duration>((_) => MediaRejoiner.defaultGiveUpAfter);
