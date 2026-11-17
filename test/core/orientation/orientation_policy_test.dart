import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/orientation/orientation_policy.dart';

/// LR-39: the app is held portrait; only the full-screen board may turn.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<Object?> sent;
  setUp(() {
    sent = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'SystemChrome.setPreferredOrientations') sent.add(call.arguments);
        return null;
      },
    );
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  test('the app is held portrait only', () async {
    await lockAppOrientation();
    expect(sent, [
      ['DeviceOrientation.portraitUp'],
    ]);
  });

  test('the full-screen board may turn to either landscape, never upside down', () async {
    await allowBoardFullScreenOrientations();
    expect(sent, [
      ['DeviceOrientation.portraitUp', 'DeviceOrientation.landscapeLeft', 'DeviceOrientation.landscapeRight'],
    ]);
  });
}
