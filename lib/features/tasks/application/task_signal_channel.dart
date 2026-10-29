import 'dart:async';

import '../../../core/realtime/realtime_socket.dart';

/// PD-47 PR-4: `task.changed` -- a task of this account's changed (it was given,
/// handed on, returned, closed, re-dated...). A SIGNAL, never content: ids only,
/// and the To do refetches through its own authorized route.
///
/// Like PD-37's typing channel it only LISTENS to the session's one realtime
/// transport (the server sends this to the actor's own room); it opens no
/// connection, subscribes to no room and sends nothing.
class TaskSignalChannel {
  TaskSignalChannel(RealtimeSocket socket) {
    _frames = socket.frames.listen((frame) {
      final taskId = decodeTaskSignal(frame.event, frame.payload);
      if (taskId != null && !_signals.isClosed) _signals.add(taskId);
    });
  }

  final _signals = StreamController<String>.broadcast();
  late final StreamSubscription<RealtimeFrame> _frames;

  /// The id of each task that changed.
  Stream<String> get signals => _signals.stream;

  /// Not awaited anywhere: on a broadcast stream a cancel can wait for the
  /// stream to close.
  void dispose() {
    unawaited(_frames.cancel());
    unawaited(_signals.close());
  }
}

/// The task a `task.changed` frame names, or null for any other frame.
String? decodeTaskSignal(String event, Object? payload) {
  if (event != 'task.changed' || payload is! Map) return null;
  final taskId = payload['taskId'];
  return taskId is String && taskId.isNotEmpty ? taskId : null;
}
