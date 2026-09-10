import 'dart:async';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// Why a recording attempt could not start or finish.
///
/// The UI branches on these rather than on an exception type, because each one
/// needs a *different* thing said to the user: a denied permission is a settings
/// trip, an unsupported device is a dead end, and a hardware failure is worth
/// retrying.
enum VoiceRecorderFailure {
  permissionDenied,
  unsupported,
  tooShort,
  failed,
}

class VoiceRecorderException implements Exception {
  const VoiceRecorderException(this.reason, {this.detail});

  final VoiceRecorderFailure reason;
  final String? detail;

  @override
  String toString() =>
      detail == null ? 'VoiceRecorderException($reason)' : 'VoiceRecorderException($reason): $detail';
}

/// A finished recording, before it is anything to do with a message.
class RecordedAudio {
  const RecordedAudio({
    required this.path,
    required this.duration,
    required this.byteSize,
    required this.mimeType,
  });

  final String path;
  final Duration duration;
  final int byteSize;
  final String mimeType;
}

/// The recording seam.
///
/// Everything above this line is testable without a microphone, a platform
/// channel or a permission dialog — which is the only reason the cancel, denial
/// and failure paths can be covered at all.
abstract interface class VoiceRecorder {
  /// Whether this device can record at all. False on a browser without
  /// MediaRecorder, or a desktop with no capture device.
  Future<bool> isSupported();

  /// True when permission is already granted. Does not prompt.
  Future<bool> hasPermission();

  /// Prompts if needed. Returns false when the user refuses.
  Future<bool> requestPermission();

  /// Begins capture. Throws [VoiceRecorderException] rather than returning a
  /// sentinel, so a caller cannot forget to check.
  Future<void> start();

  /// Ends capture and returns the file. Throws when nothing usable was captured.
  Future<RecordedAudio> stop();

  /// Ends capture and destroys the file. Safe to call when not recording.
  Future<void> cancel();

  /// Live input level in 0..1, for the recording indicator.
  Stream<double> get amplitude;

  Future<void> dispose();
}

/// [VoiceRecorder] over the `record` plugin.
///
/// **Format: AAC in an MP4 container, with Opus as a fallback.**
///
/// Opus is the smaller codec and the tempting default, but it loses on the two
/// things that actually matter here:
///
/// * **Safari cannot play Ogg/Opus.** A note recorded on a parent's phone is
///   played back by staff in the admin console, and a format half the audience
///   cannot open is not a saving.
/// * On iOS the encoder reports itself supported and then produces a zero-byte
///   file, so the note is lost at the moment the user presses stop.
///
/// AAC/MP4 plays in every current browser and on both mobile platforms, and at
/// 32 kbps mono is still an order of magnitude smaller than WAV. Both are in the
/// backend's voice MIME allowlist. Opus stays as a fallback for a platform that
/// cannot do AAC at all.
class PluginVoiceRecorder implements VoiceRecorder {
  PluginVoiceRecorder({AudioRecorder? recorder, this.minimumDuration = const Duration(seconds: 1)})
      : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;

  /// Below this, a recording is a mis-tap rather than a message.
  final Duration minimumDuration;

  String? _path;
  DateTime? _startedAt;
  String _mimeType = 'audio/mp4';

  /// Order is the preference order. Do not reorder without re-reading the class
  /// comment: putting Opus first is what made iOS produce empty recordings.
  static const _preferred = <AudioEncoder, ({String extension, String mimeType})>{
    AudioEncoder.aacLc: (extension: 'm4a', mimeType: 'audio/mp4'),
    AudioEncoder.opus: (extension: 'ogg', mimeType: 'audio/ogg'),
  };

  @override
  Future<bool> isSupported() async {
    for (final encoder in _preferred.keys) {
      if (await _recorder.isEncoderSupported(encoder)) return true;
    }
    return false;
  }

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Future<bool> requestPermission() => _recorder.hasPermission();

  @override
  Future<void> start() async {
    // Guard here as well as in the controller: a second start would silently
    // orphan the first file and leak the capture session.
    if (await _recorder.isRecording()) return;

    if (!await _recorder.hasPermission()) {
      throw const VoiceRecorderException(VoiceRecorderFailure.permissionDenied);
    }

    AudioEncoder? chosen;
    for (final entry in _preferred.entries) {
      if (await _recorder.isEncoderSupported(entry.key)) {
        chosen = entry.key;
        _mimeType = entry.value.mimeType;
        break;
      }
    }
    if (chosen == null) {
      throw const VoiceRecorderException(VoiceRecorderFailure.unsupported);
    }

    final directory = await getTemporaryDirectory();
    final path = p.join(
      directory.path,
      'voice_${DateTime.now().microsecondsSinceEpoch}.${_preferred[chosen]!.extension}',
    );

    try {
      await _recorder.start(
        RecordConfig(
          encoder: chosen,
          // Speech, not music: mono at 32 kbps keeps a two-minute note well
          // inside the backend's 16 MB voice ceiling and cheap on mobile data.
          bitRate: 32000,
          sampleRate: 24000,
          numChannels: 1,
        ),
        path: path,
      );
    } catch (error) {
      throw VoiceRecorderException(VoiceRecorderFailure.failed, detail: '$error');
    }

    _path = path;
    _startedAt = DateTime.now();
  }

  @override
  Future<RecordedAudio> stop() async {
    final startedAt = _startedAt;
    final produced = await _recorder.stop();
    final path = produced ?? _path;
    _startedAt = null;
    _path = null;

    if (path == null || startedAt == null) {
      throw const VoiceRecorderException(VoiceRecorderFailure.failed);
    }

    final duration = DateTime.now().difference(startedAt);
    final file = File(path);
    final byteSize = await file.exists() ? await file.length() : 0;

    if (byteSize <= 0) {
      await _delete(path);
      throw const VoiceRecorderException(VoiceRecorderFailure.failed);
    }
    if (duration < minimumDuration) {
      // Discard rather than send: a 200 ms note is a mis-tap, and leaving the
      // file behind would leak a recording the user never meant to make.
      await _delete(path);
      throw const VoiceRecorderException(VoiceRecorderFailure.tooShort);
    }

    return RecordedAudio(
      path: path,
      duration: duration,
      byteSize: byteSize,
      mimeType: _mimeType,
    );
  }

  @override
  Future<void> cancel() async {
    final path = _path;
    _path = null;
    _startedAt = null;
    try {
      await _recorder.stop();
    } catch (_) {
      // Cancelling must never throw: it is what the user reaches for when
      // something has already gone wrong.
    }
    if (path != null) await _delete(path);
  }

  @override
  Stream<double> get amplitude => _recorder
      .onAmplitudeChanged(const Duration(milliseconds: 200))
      // dBFS, roughly -45 (silence) to 0 (clipping), mapped to 0..1.
      .map((a) => ((a.current + 45) / 45).clamp(0.0, 1.0));

  @override
  Future<void> dispose() async {
    await cancel();
    await _recorder.dispose();
  }

  static Future<void> _delete(String path) async {
    try {
      final file = File(path);
      if (await file.exists()) await file.delete();
    } catch (_) {
      // A temp file we could not remove is not worth failing a send over; the
      // OS reclaims the cache directory.
    }
  }
}
