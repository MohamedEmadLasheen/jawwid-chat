import 'dart:async';
import 'dart:io';

import 'package:jawwid_chat/core/audio/voice_player.dart';
import 'package:jawwid_chat/core/audio/voice_recorder.dart';

/// A microphone that never exists.
///
/// Every failure path a real device has — refused permission, no capture
/// hardware, a mis-tap too short to be a message, a driver that simply fails —
/// is reachable here by setting a field. None of them can be reached on CI with
/// a real recorder, which is the whole reason the seam exists.
class FakeVoiceRecorder implements VoiceRecorder {
  FakeVoiceRecorder({this.supported = true, this.permitted = true});

  bool supported;
  bool permitted;

  /// Thrown from [start] when set.
  VoiceRecorderFailure? startFailure;

  /// Thrown from [stop] when set — a too-short or empty capture.
  VoiceRecorderFailure? stopFailure;

  Duration recordedDuration = const Duration(seconds: 3);
  String mimeType = 'audio/ogg';

  int startCount = 0;
  int cancelCount = 0;
  int permissionPrompts = 0;

  /// Files this recorder created, so a test can assert a cancel deleted one.
  final createdFiles = <File>[];

  final _amplitude = StreamController<double>.broadcast();
  File? _current;

  @override
  Future<bool> isSupported() async => supported;

  @override
  Future<bool> hasPermission() async => permitted;

  @override
  Future<bool> requestPermission() async {
    permissionPrompts++;
    return permitted;
  }

  @override
  Future<void> start() async {
    startCount++;
    if (startFailure != null) throw VoiceRecorderException(startFailure!);

    final file = File(
      '${Directory.systemTemp.createTempSync('jawwid_voice_test').path}/note.ogg',
    )..writeAsBytesSync(List<int>.filled(2048, 7));
    _current = file;
    createdFiles.add(file);
  }

  @override
  Future<RecordedAudio> stop() async {
    if (stopFailure != null) {
      _deleteCurrent();
      throw VoiceRecorderException(stopFailure!);
    }
    final file = _current;
    if (file == null) throw const VoiceRecorderException(VoiceRecorderFailure.failed);
    _current = null;
    return RecordedAudio(
      path: file.path,
      duration: recordedDuration,
      byteSize: file.lengthSync(),
      mimeType: mimeType,
    );
  }

  @override
  Future<void> cancel() async {
    cancelCount++;
    _deleteCurrent();
  }

  /// Synchronous on purpose. A widget test runs under a fake clock, and real
  /// file I/O never completes inside one — an awaited `delete()` here would hang
  /// the very failure paths these fakes exist to exercise.
  void _deleteCurrent() {
    final file = _current;
    _current = null;
    if (file != null && file.existsSync()) file.deleteSync();
  }

  void emitAmplitude(double value) => _amplitude.add(value);

  @override
  Stream<double> get amplitude => _amplitude.stream;

  @override
  Future<void> dispose() async {
    _deleteCurrent();
    await _amplitude.close();
  }
}

/// A player that opens no audio session.
class FakeVoicePlayer implements VoicePlayer {
  final _controller = StreamController<VoicePlaybackStatus>.broadcast();

  final loaded = <String>[];
  int playCount = 0;
  int pauseCount = 0;
  Duration? seekedTo;

  /// Set to make [load] report a failure, as an expired signed URL would.
  bool failOnLoad = false;

  VoicePlaybackStatus current = const VoicePlaybackStatus();

  void _emit(VoicePlaybackStatus status) {
    current = status;
    if (!_controller.isClosed) _controller.add(status);
  }

  @override
  Stream<VoicePlaybackStatus> get status => _controller.stream;

  @override
  Future<void> load(String url) async {
    loaded.add(url);
    if (failOnLoad) {
      _emit(const VoicePlaybackStatus(state: VoicePlaybackState.failed));
      return;
    }
    _emit(const VoicePlaybackStatus(state: VoicePlaybackState.paused));
  }

  @override
  Future<void> play() async {
    playCount++;
    _emit(current.copyWith(state: VoicePlaybackState.playing));
  }

  @override
  Future<void> pause() async {
    pauseCount++;
    _emit(current.copyWith(state: VoicePlaybackState.paused));
  }

  @override
  Future<void> seek(Duration position) async {
    seekedTo = position;
    _emit(current.copyWith(position: position));
  }

  @override
  Future<void> stop() async {
    _emit(const VoicePlaybackStatus());
  }

  /// Drive a position update as the real player would while playing.
  void advanceTo(Duration position, {Duration? duration}) =>
      _emit(current.copyWith(position: position, duration: duration));

  @override
  Future<void> dispose() async => _controller.close();
}
