
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/audio/voice_recorder.dart';
import 'package:jawwid_chat/features/messages/application/voice_composer_controller.dart';

import 'fake_voice_devices.dart';

/// The recording flow, including every way it can refuse to produce a message.
void main() {
  late FakeVoiceRecorder recorder;
  late ProviderContainer container;

  const conversationId = 'conv_1';

  setUp(() {
    recorder = FakeVoiceRecorder();
    container = ProviderContainer(
      overrides: [voiceRecorderProvider.overrideWithValue(recorder)],
    );
  });

  tearDown(() {
    container.dispose();
    recorder.dispose();
  });

  VoiceComposerController controller() =>
      container.read(voiceComposerProvider(conversationId).notifier);
  VoiceComposerState state() => container.read(voiceComposerProvider(conversationId));

  group('the happy path', () {
    test('records, reviews, and hands over a draft exactly once', () async {
      await controller().start();
      expect(state().isRecording, isTrue);

      await controller().stop();
      expect(state().isReviewing, isTrue);
      expect(state().draft, isNotNull);
      expect(state().draft!.duration, const Duration(seconds: 3));
      expect(state().draft!.mimeType, 'audio/ogg');
      expect(state().draft!.byteSize, greaterThan(0));

      final draft = controller().takeDraft();
      expect(draft, isNotNull);
      // Taking the draft clears it, so a double tap on send cannot enqueue the
      // same recording twice.
      expect(controller().takeDraft(), isNull);
      expect(state().isActive, isFalse);
    });
  });

  group('the recording cannot be started twice', () {
    test('a second press while recording is a no-op', () async {
      await controller().start();
      await controller().start();
      await controller().start();

      expect(recorder.startCount, 1);
    });

    test('a press while a draft is under review does not discard it', () async {
      await controller().start();
      await controller().stop();

      await controller().start();

      expect(recorder.startCount, 1);
      expect(state().isReviewing, isTrue);
    });
  });

  group('permissions', () {
    test('a refused microphone reports a denial and records nothing', () async {
      recorder.permitted = false;

      await controller().start();

      expect(state().failure, VoiceRecorderFailure.permissionDenied);
      expect(state().isActive, isFalse);
      expect(recorder.startCount, 0);
    });

    test('permission is requested only when it is not already granted', () async {
      recorder.permitted = true;
      await controller().start();
      expect(recorder.permissionPrompts, 0);

      await controller().cancel();
      recorder.permitted = false;
      await controller().start();
      // Now it had to ask, and was refused.
      expect(recorder.permissionPrompts, 1);
    });

    test('a device with no capture support says so rather than failing opaquely', () async {
      recorder.supported = false;

      await controller().start();

      expect(state().failure, VoiceRecorderFailure.unsupported);
      expect(recorder.startCount, 0);
    });
  });

  group('recordings that must not become messages', () {
    test('a too-short capture is reported, not sent', () async {
      recorder.stopFailure = VoiceRecorderFailure.tooShort;

      await controller().start();
      await controller().stop();

      expect(state().failure, VoiceRecorderFailure.tooShort);
      expect(state().draft, isNull);
      expect(state().isReviewing, isFalse);
    });

    test('a hardware failure mid-recording leaves no draft', () async {
      recorder.stopFailure = VoiceRecorderFailure.failed;

      await controller().start();
      await controller().stop();

      expect(state().failure, VoiceRecorderFailure.failed);
      expect(state().draft, isNull);
    });

    test('a failure to start is surfaced with its reason', () async {
      recorder.startFailure = VoiceRecorderFailure.failed;

      await controller().start();

      expect(state().failure, VoiceRecorderFailure.failed);
      expect(state().isActive, isFalse);
    });
  });

  group('cancelling', () {
    test('cancelling a live recording deletes the file', () async {
      await controller().start();
      final file = recorder.createdFiles.single;
      expect(file.existsSync(), isTrue);

      await controller().cancel();

      // The user believed they discarded it, so it must not survive on disk.
      expect(file.existsSync(), isFalse);
      expect(state().isActive, isFalse);
    });

    test('cancelling a reviewed draft discards it', () async {
      await controller().start();
      await controller().stop();
      expect(state().draft, isNotNull);

      await controller().cancel();

      expect(state().draft, isNull);
      expect(state().isActive, isFalse);
    });

    test('cancelling when idle is harmless', () async {
      await controller().cancel();
      expect(state().isActive, isFalse);
      expect(recorder.cancelCount, 0);
    });

    test('leaving the conversation abandons the recording', () async {
      await controller().start();
      final file = recorder.createdFiles.single;

      container.dispose();
      await Future<void>.delayed(Duration.zero);

      expect(file.existsSync(), isFalse);
    });
  });

  group('a failure can be dismissed without starting a new recording', () {
    test('acknowledging clears the reason and leaves the composer idle', () async {
      recorder.permitted = false;
      await controller().start();
      expect(state().failure, isNotNull);

      controller().acknowledgeFailure();

      expect(state().failure, isNull);
      expect(state().isActive, isFalse);
      expect(recorder.startCount, 0);
    });

    test('starting again after a failure clears the previous reason', () async {
      recorder.permitted = false;
      await controller().start();
      expect(state().failure, VoiceRecorderFailure.permissionDenied);

      recorder.permitted = true;
      await controller().start();

      expect(state().failure, isNull);
      expect(state().isRecording, isTrue);
    });
  });

  group('the elapsed timer', () {
    test('advances while recording', () async {
      await controller().start();
      expect(state().elapsed, Duration.zero);

      // The controller ticks on a real timer; a short wait is enough to prove it
      // is running without asserting a precise value.
      await Future<void>.delayed(const Duration(milliseconds: 250));

      expect(state().elapsed, greaterThan(Duration.zero));
      await controller().cancel();
    });

    test('the client ceiling stays under the backend voice-note limit', () {
      // The backend rejects a voice note past ten minutes; recording up to the
      // limit and only then discovering the refusal would waste the whole take.
      expect(VoiceComposerController.maxDuration, lessThan(const Duration(minutes: 10)));
    });
  });

  tearDownAll(() {
    for (final file in recorder.createdFiles) {
      final directory = file.parent;
      if (directory.existsSync()) directory.deleteSync(recursive: true);
    }
  });
}
