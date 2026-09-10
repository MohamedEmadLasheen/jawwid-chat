import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/audio/voice_recorder.dart';
import 'package:mocktail/mocktail.dart';
import 'package:record/record.dart';

class _MockAudioRecorder extends Mock implements AudioRecorder {}

/// path_provider's channel, answered locally.
///
/// Mocked at the channel rather than by importing the platform-interface
/// package: those are transitive dependencies, and depending on them directly
/// just to reach a test seam is what `depend_on_referenced_packages` warns
/// about.
const _pathProviderChannel = MethodChannel('plugins.flutter.io/path_provider');

/// iOS codec selection.
///
/// This exists because of a defect that only a real device showed: on iOS the
/// Opus encoder reports itself **supported** and then writes a zero-byte file,
/// so the note was lost at the moment the user pressed stop. AAC/MP4 is
/// therefore preferred wherever both are available — which is also what Safari
/// needs, since it cannot play Ogg/Opus and staff replay these notes in the
/// browser.
///
/// The guard is the *preference order*, and until now that was protected by
/// nothing but the order of a map literal and a comment. A dependency bump or a
/// well-meaning tidy could silently put Opus back in front. These tests fail if
/// it does.
void main() {
  late _MockAudioRecorder plugin;
  late Directory tempDir;

  setUpAll(() => registerFallbackValue(const RecordConfig()));

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    plugin = _MockAudioRecorder();
    tempDir = Directory.systemTemp.createTempSync('jawwid_codec_test');

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_pathProviderChannel, (call) async => tempDir.path);

    when(() => plugin.isRecording()).thenAnswer((_) async => false);
    when(() => plugin.hasPermission()).thenAnswer((_) async => true);
    when(() => plugin.start(any(), path: any(named: 'path'))).thenAnswer((invocation) async {
      // A real recorder creates the file; stop() reads its length.
      File(invocation.namedArguments[#path] as String).writeAsBytesSync(List.filled(4096, 1));
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_pathProviderChannel, null);
    if (tempDir.existsSync()) tempDir.deleteSync(recursive: true);
  });

  void supports({required bool aac, required bool opus}) {
    when(() => plugin.isEncoderSupported(AudioEncoder.aacLc)).thenAnswer((_) async => aac);
    when(() => plugin.isEncoderSupported(AudioEncoder.opus)).thenAnswer((_) async => opus);
  }

  /// The encoder the recorder actually asked the platform for.
  AudioEncoder capturedEncoder() {
    final config = verify(() => plugin.start(captureAny(), path: any(named: 'path')))
        .captured
        .single as RecordConfig;
    return config.encoder;
  }

  group('when the platform offers both encoders', () {
    test('AAC is chosen, never Opus', () async {
      supports(aac: true, opus: true);
      final recorder = PluginVoiceRecorder(recorder: plugin);

      await recorder.start();

      // Captured once: verify() consumes the recorded invocation.
      final chosen = capturedEncoder();

      // This is the regression. iOS answers true for Opus and then produces
      // nothing, so "supported" is not sufficient grounds to choose it.
      expect(chosen, AudioEncoder.aacLc);
      expect(chosen, isNot(AudioEncoder.opus));
    });

    test('the recording is declared as audio/mp4 in an .m4a container', () async {
      supports(aac: true, opus: true);
      final recorder = PluginVoiceRecorder(
        recorder: plugin,
        minimumDuration: Duration.zero,
      );

      await recorder.start();
      when(() => plugin.stop()).thenAnswer((_) async => _startedPath(plugin));
      final audio = await recorder.stop();

      // audio/mp4 is in the backend's voice MIME allowlist and is the container
      // every current browser can play.
      expect(audio.mimeType, 'audio/mp4');
      expect(audio.path, endsWith('.m4a'));
      expect(audio.byteSize, greaterThan(0));
    });
  });

  group('the fallback still works', () {
    test('Opus is used only when AAC is genuinely unavailable', () async {
      supports(aac: false, opus: true);
      final recorder = PluginVoiceRecorder(recorder: plugin);

      await recorder.start();

      expect(capturedEncoder(), AudioEncoder.opus);
    });

    test('a device offering neither reports unsupported rather than failing later', () async {
      supports(aac: false, opus: false);
      final recorder = PluginVoiceRecorder(recorder: plugin);

      expect(await recorder.isSupported(), isFalse);
      await expectLater(
        recorder.start(),
        throwsA(
          isA<VoiceRecorderException>().having(
            (e) => e.reason,
            'reason',
            VoiceRecorderFailure.unsupported,
          ),
        ),
      );
      verifyNever(() => plugin.start(any(), path: any(named: 'path')));
    });
  });

  group('a zero-byte recording never becomes a message', () {
    test('an encoder that produced nothing is reported as a failure', () async {
      supports(aac: true, opus: true);
      // The exact iOS Opus symptom: start succeeds, the file is empty.
      when(() => plugin.start(any(), path: any(named: 'path'))).thenAnswer((invocation) async {
        File(invocation.namedArguments[#path] as String).writeAsBytesSync(<int>[]);
      });
      final recorder = PluginVoiceRecorder(recorder: plugin, minimumDuration: Duration.zero);

      await recorder.start();
      final path = _startedPath(plugin);
      when(() => plugin.stop()).thenAnswer((_) async => path);

      await expectLater(
        recorder.stop(),
        throwsA(
          isA<VoiceRecorderException>().having(
            (e) => e.reason,
            'reason',
            VoiceRecorderFailure.failed,
          ),
        ),
      );
      // And the empty file is not left behind for an upload to pick up.
      expect(File(path).existsSync(), isFalse);
    });
  });
}

/// The path the recorder handed the platform.
String _startedPath(_MockAudioRecorder plugin) =>
    verify(() => plugin.start(any(), path: captureAny(named: 'path'))).captured.single as String;
