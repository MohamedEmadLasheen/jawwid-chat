import 'dart:async';

import '../../../core/realtime/chat_signal.dart';
import '../../../core/realtime/realtime_socket.dart';

/// PD-37: who is typing, as the server tells seated members.
///
/// Chat-owned, and deliberately apart from the call client: it LISTENS to the
/// session's one realtime transport (the same socket, through its public frame
/// stream) and decodes typing frames, nothing else. It opens no connection,
/// subscribes to no room and sends nothing -- the call client keeps all of that.
class ChatTypingChannel {
  ChatTypingChannel(RealtimeSocket socket) {
    _frames = socket.frames.listen((frame) {
      final signal = decodeTypingSignal(frame.event, frame.payload);
      if (signal != null && !_signals.isClosed) _signals.add(signal);
    });
  }

  final _signals = StreamController<TypingSignal>.broadcast();
  late final StreamSubscription<RealtimeFrame> _frames;

  Stream<TypingSignal> get signals => _signals.stream;

  /// Not awaited anywhere: on a broadcast stream a cancel can wait for the
  /// stream to close.
  void dispose() {
    unawaited(_frames.cancel());
    unawaited(_signals.close());
  }
}
