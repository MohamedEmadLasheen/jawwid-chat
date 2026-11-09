import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/call_native/call_presentation.dart';

/// The native call-presentation seam (W8-W3), over a real MethodChannel.
///
/// The binding IS initialized here, deliberately: these tests are about what
/// crosses the channel, and the contract with `CallKitBridge.swift` is a set of
/// method names and argument keys that only a channel can check.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(PlatformCallPresentation.channelName);
  final sentToNative = <MethodCall>[];

  setUp(() {
    sentToNative.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      sentToNative.add(call);
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  /// Deliver a message as the platform would.
  Future<void> fromNative(String method, Object? arguments) async {
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      PlatformCallPresentation.channelName,
      const StandardMethodCodec().encodeMethodCall(
        MethodCall(method, arguments),
      ),
      (_) {},
    );
  }

  group('the channel contract with the native side', () {
    test('start announces readiness so native can drain its queue', () async {
      // On a cold VoIP wake the push ALWAYS precedes Dart. Without this the
      // call is on the screen with nothing behind it.
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);

      await presentation.start();

      expect(sentToNative.single.method, 'ready');
    });

    test('start is idempotent', () async {
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);

      await presentation.start();
      await presentation.start();

      expect(sentToNative.where((c) => c.method == 'ready'), hasLength(1));
    });

    test('dismiss names the call and the reason', () async {
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      await presentation.dismiss(
        callId: 'call_1',
        reason: CallDismissReason.answeredElsewhere,
      );

      final call = sentToNative.last;
      expect(call.method, 'dismiss');
      expect(call.arguments, {
        'callId': 'call_1',
        'reason': 'answeredElsewhere',
      });
    });

    test('a native refusal to dismiss never reaches the caller', () async {
      // The screen belongs to the platform and may already be gone. That must
      // not propagate into a lifecycle that has already moved on.
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        throw PlatformException(code: 'NO_SUCH_CALL');
      });
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      await expectLater(
        presentation.dismiss(
          callId: 'call_1',
          reason: CallDismissReason.remoteEnded,
        ),
        completes,
      );
    });
  });

  group('actions arriving from the system call screen', () {
    for (final (method, kind) in [
      ('onIncoming', NativeCallActionKind.incoming),
      ('onAnswer', NativeCallActionKind.answer),
      ('onDecline', NativeCallActionKind.decline),
      ('onEnd', NativeCallActionKind.end),
    ]) {
      test('$method becomes ${kind.name}', () async {
        final presentation = PlatformCallPresentation();
        addTearDown(presentation.dispose);
        await presentation.start();
        final seen = <NativeCallAction>[];
        presentation.actions().listen(seen.add);

        await fromNative(method, {'callId': 'call_1'});
        await Future<void>.delayed(Duration.zero);

        expect(seen.single.kind, kind);
        expect(seen.single.callId, 'call_1');
      });
    }

    test('onIncoming carries the conversation from the push payload', () async {
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();
      final seen = <NativeCallAction>[];
      presentation.actions().listen(seen.add);

      await fromNative('onIncoming', {
        'callId': 'call_1',
        'conversationId': 'conv_1',
      });
      await Future<void>.delayed(Duration.zero);

      expect(seen.single.conversationId, 'conv_1');
    });

    test('A MESSAGE WITH NO callId IS DROPPED, never guessed at', () async {
      // Answering a call whose identity we do not know is worse than not
      // answering: it would address the wrong call on the server.
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();
      final seen = <NativeCallAction>[];
      presentation.actions().listen(seen.add);

      await fromNative('onAnswer', {'conversationId': 'conv_1'});
      await fromNative('onAnswer', {'callId': ''});
      await fromNative('onAnswer', 'not-a-map');
      await fromNative('onAnswer', null);
      await Future<void>.delayed(Duration.zero);

      expect(seen, isEmpty);
    });

    test('an unknown method is ignored, not an error', () async {
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();
      final seen = <NativeCallAction>[];
      presentation.actions().listen(seen.add);

      await fromNative('onSomethingElse', {'callId': 'call_1'});
      await Future<void>.delayed(Duration.zero);

      expect(seen, isEmpty);
    });
  });

  group('LR-27: the full-screen intent permission (Android 14+)', () {
    void nativeAnswers(Object? Function(MethodCall call) answer) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        sentToNative.add(call);
        return answer(call);
      });
    }

    test('asks native, and reports a refusal', () async {
      nativeAnswers((call) => call.method == 'canUseFullScreenIntent' ? false : null);
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      expect(await presentation.canUseFullScreenIntent(), isFalse);
      expect(sentToNative.last.method, 'canUseFullScreenIntent');
    });

    test('opens the settings screen and says whether it opened', () async {
      nativeAnswers((call) => call.method == 'openFullScreenIntentSettings' ? true : null);
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      expect(await presentation.openFullScreenIntentSettings(), isTrue);
      expect(sentToNative.last.method, 'openFullScreenIntentSettings');
    });

    test('a platform without the method (iOS) counts as allowed, never throws', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'ready') return null;
        throw MissingPluginException();
      });
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      expect(await presentation.canUseFullScreenIntent(), isTrue);
      expect(await presentation.openFullScreenIntentSettings(), isFalse);
    });

    test('before start nothing is asked', () async {
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);

      expect(await presentation.canUseFullScreenIntent(), isTrue);
      expect(await presentation.openFullScreenIntentSettings(), isFalse);
      expect(sentToNative, isEmpty);
    });
  });

  group('LR-46: the phone lock screen (Android)', () {
    void nativeAnswers(Object? Function(MethodCall call) answer) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        sentToNative.add(call);
        return answer(call);
      });
    }

    test('asks native whether the phone is locked', () async {
      nativeAnswers((call) => call.method == 'isKeyguardLocked' ? true : null);
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      expect(await presentation.isLocked(), isTrue);
      expect(sentToNative.last.method, 'isKeyguardLocked');
    });

    test('asks native to unlock, and reports the answer', () async {
      var unlocked = false;
      nativeAnswers((call) => call.method == 'requestDismissKeyguard' ? unlocked : null);
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      expect(await presentation.requestUnlock(), isFalse);
      expect(sentToNative.last.method, 'requestDismissKeyguard');
      unlocked = true;
      expect(await presentation.requestUnlock(), isTrue);
    });

    test('returns to the lock screen through native', () async {
      nativeAnswers((_) => null);
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      await presentation.returnToLockScreen();
      expect(sentToNative.last.method, 'returnToLockScreen');
    });

    test('a failed unlock is not an unlock; a platform without the methods (iOS) is never locked', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'ready') return null;
        throw MissingPluginException();
      });
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);
      await presentation.start();

      expect(await presentation.isLocked(), isFalse);
      expect(await presentation.requestUnlock(), isFalse);
      await presentation.returnToLockScreen();
    });

    test('before start nothing is asked, and nothing is locked', () async {
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);

      expect(await presentation.isLocked(), isFalse);
      expect(sentToNative, isEmpty);
    });
  });

  group('a build with no platform side', () {
    test('the seam is inert rather than throwing', () async {
      // A fixture build, or a platform W8-W3 has not reached. Nothing can have
      // presented a call there, so there is nothing to answer or take down.
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
      final presentation = PlatformCallPresentation();
      addTearDown(presentation.dispose);

      await expectLater(presentation.start(), completes);
      await expectLater(
        presentation.dismiss(
          callId: 'call_1',
          reason: CallDismissReason.failed,
        ),
        completes,
      );
    });
  });
}
