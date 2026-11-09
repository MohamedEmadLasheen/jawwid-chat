/// The channel between the native token plumbing and Dart (W8-W1).
///
/// A HALF-FORMED TOKEN IS DROPPED HERE, and that is the point of the file. A
/// device address the server cannot use would fail every push and eventually be
/// deactivated as permanently invalid — which looks exactly like a phone that
/// has stopped working, and is far harder to diagnose than a token that never
/// arrived.
///
/// No native side is involved: the channel is driven directly, which is what the
/// seam exists for.
library;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/push/push_tokens.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(PlatformPushTokens.channelName);

  /// Deliver what the native side would send.
  Future<void> nativeSends(Object? arguments) async {
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      channel.name,
      const StandardMethodCodec().encodeMethodCall(
        MethodCall('onToken', arguments),
      ),
      (_) {},
    );
  }

  test('a well-formed VoIP token arrives as one', () async {
    final tokens = PlatformPushTokens();
    addTearDown(tokens.dispose);
    final received = <PushToken>[];
    tokens.tokens().listen(received.add);

    await nativeSends({'token': 'abc123', 'platform': 'ios', 'kind': 'voip'});
    await pumpEventQueue();

    expect(received, hasLength(1));
    expect(received.single.value, 'abc123');
    expect(received.single.platform, 'ios');
    expect(received.single.isVoip, isTrue);
  });

  test('an unknown kind is treated as a standard token, never as VoIP', () async {
    // Failing the other way would put ordinary notifications on the PushKit
    // channel, which is the one thing the routing exists to prevent.
    final tokens = PlatformPushTokens();
    addTearDown(tokens.dispose);
    final received = <PushToken>[];
    tokens.tokens().listen(received.add);

    await nativeSends({'token': 'abc', 'platform': 'android', 'kind': 'something'});
    await nativeSends({'token': 'def', 'platform': 'android'});
    await pumpEventQueue();

    expect(received.map((t) => t.isVoip), [false, false]);
  });

  test('a malformed message is dropped, not forwarded', () async {
    final tokens = PlatformPushTokens();
    addTearDown(tokens.dispose);
    final received = <PushToken>[];
    tokens.tokens().listen(received.add);

    await nativeSends({'platform': 'ios', 'kind': 'voip'}); // no token
    await nativeSends({'token': '', 'platform': 'ios'}); // empty token
    await nativeSends({'token': 'abc'}); // no platform
    await nativeSends({'token': 'abc', 'platform': ''}); // empty platform
    await nativeSends({'token': 42, 'platform': 'ios'}); // wrong type
    await nativeSends('not a map');
    await nativeSends(null);
    await pumpEventQueue();

    expect(received, isEmpty);
  });

  test('start does not throw when there is no native side', () async {
    // A unit test, or a platform W8-W1 did not wire. The app works without
    // push; it simply will not notify while closed.
    final tokens = PlatformPushTokens();
    addTearDown(tokens.dispose);

    await expectLater(tokens.start(), completes);
  });

  group('LR-11: register (tokens, no prompt) is a separate native call from start', () {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

    test('register calls `register`, never `start`, and passes on its answer', () async {
      final calls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return call.method == 'register' ? false : null;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
      final tokens = PlatformPushTokens();
      addTearDown(tokens.dispose);

      expect(await tokens.register(), isFalse, reason: 'nothing left for the OS to ask');
      expect(calls, ['register']);

      await tokens.start();
      expect(calls, ['register', 'start']);
    });

    test('an answer without a value, or a native error: a prompt is assumed possible',
        () async {
      Object? answer;
      messenger.setMockMethodCallHandler(channel, (call) async {
        if (answer is PlatformException) throw answer;
        return answer;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
      final tokens = PlatformPushTokens();
      addTearDown(tokens.dispose);

      answer = null;
      expect(await tokens.register(), isTrue);
      answer = PlatformException(code: 'boom');
      expect(await tokens.register(), isTrue);
    });

    test('no native side: register does not throw, and assumes a prompt is possible',
        () async {
      final tokens = PlatformPushTokens();
      addTearDown(tokens.dispose);

      expect(await tokens.register(), isTrue);
    });
  });

  test('the stream is terminal after dispose', () async {
    final tokens = PlatformPushTokens();
    await tokens.dispose();

    await expectLater(tokens.dispose(), completes);
  });
}
