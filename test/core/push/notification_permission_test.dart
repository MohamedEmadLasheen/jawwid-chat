/// LR-11b: the notification permission's status and its recovery, without a widget.
///
/// The status mapping (what the native side says -> what the Settings row does), the
/// channel half (#557's `jawwid/push_tokens`, extended), and the row's tap: the first
/// ask goes through #557's explanation and nothing else; Android 13+'s "refused once"
/// asks again directly; everything else opens the phone's settings. The screen half is
/// `test/features/notifications/notification_permission_tile_test.dart`.
library;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/push/notification_permission.dart';
import 'package:jawwid_chat/core/push/push_permission_explainer.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/core/push/push_tokens.dart';

import 'push_registration_test.dart' as h;

/// The native status and settings screen, scripted.
class FakeNotificationPermission implements NotificationPermissionPlatform {
  FakeNotificationPermission(this.current);

  NotificationPermissionStatus current;
  int reads = 0;
  int opens = 0;

  @override
  Future<NotificationPermissionStatus> status() async {
    reads++;
    return current;
  }

  @override
  Future<bool> openSettings() async {
    opens++;
    return true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('status mapping', () {
    test('every native answer maps to its status; anything else is unknown', () {
      expect(parseNotificationPermissionStatus('granted'), NotificationPermissionStatus.granted);
      expect(parseNotificationPermissionStatus('notDetermined'), NotificationPermissionStatus.notDetermined);
      expect(parseNotificationPermissionStatus('denied'), NotificationPermissionStatus.denied);
      expect(parseNotificationPermissionStatus('blocked'), NotificationPermissionStatus.blocked);
      expect(parseNotificationPermissionStatus('provisional'), NotificationPermissionStatus.unknown);
      expect(parseNotificationPermissionStatus(null), NotificationPermissionStatus.unknown);
      expect(parseNotificationPermissionStatus(3), NotificationPermissionStatus.unknown);
    });

    test('what a tap does in each status', () {
      const expected = {
        NotificationPermissionStatus.notDetermined: NotificationPermissionAction.explainThenAsk,
        NotificationPermissionStatus.denied: NotificationPermissionAction.askAgain,
        NotificationPermissionStatus.granted: NotificationPermissionAction.openSettings,
        NotificationPermissionStatus.blocked: NotificationPermissionAction.openSettings,
        NotificationPermissionStatus.unknown: NotificationPermissionAction.openSettings,
        NotificationPermissionStatus.unsupported: NotificationPermissionAction.none,
      };
      for (final status in NotificationPermissionStatus.values) {
        expect(notificationPermissionActionFor(status), expected[status], reason: status.name);
      }
    });
  });

  group('the channel (#557 push channel, extended)', () {
    const channel = MethodChannel(PlatformPushTokens.channelName);
    final calls = <String>[];

    void answer(Object? Function(MethodCall call) reply) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (call) async {
          calls.add(call.method);
          return reply(call);
        },
      );
    }

    setUp(calls.clear);
    tearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null),
    );

    test('permissionStatus is read on the same channel as the tokens', () async {
      answer((_) => 'denied');
      expect(await PlatformNotificationPermission().status(), NotificationPermissionStatus.denied);
      expect(calls, ['permissionStatus']);
    });

    test('openNotificationSettings is asked for, and its answer returned', () async {
      answer((_) => true);
      expect(await PlatformNotificationPermission().openSettings(), isTrue);
      expect(calls, ['openNotificationSettings']);
    });

    test('a native error is unknown (the row still opens settings)', () async {
      answer((_) => throw PlatformException(code: 'boom'));
      expect(await PlatformNotificationPermission().status(), NotificationPermissionStatus.unknown);
      expect(await PlatformNotificationPermission().openSettings(), isFalse);
    });

    test('no native side is unsupported (the row is hidden)', () async {
      expect(await PlatformNotificationPermission().status(), NotificationPermissionStatus.unsupported);
      expect(await PlatformNotificationPermission().openSettings(), isFalse);
    });
  });

  group('a tap on the row', () {
    late h.FakeTokens tokens;
    late FakeNotificationPermission platform;
    late FakePushExplainerStore store;
    late int explained;

    ProviderContainer build(NotificationPermissionStatus status, {FakePushExplainerStore? initialStore}) {
      tokens = h.FakeTokens();
      platform = FakeNotificationPermission(status);
      store = initialStore ?? FakePushExplainerStore();
      explained = 0;
      final c = ProviderContainer(overrides: [
        pushTokensProvider.overrideWithValue(tokens),
        notificationPermissionPlatformProvider.overrideWithValue(platform),
        pushExplainerStoreProvider.overrideWithValue(store),
        pushExplainerClockProvider.overrideWithValue(() => DateTime.utc(2026, 3, 10, 12)),
      ]);
      addTearDown(c.dispose);
      addTearDown(tokens.close);
      return c;
    }

    Future<bool?> Function() explainer(bool? answer) => () async {
          explained++;
          return answer;
        };

    NotificationPermissionController row(ProviderContainer c) => c.read(notificationPermissionProvider.notifier);

    test('refresh reads the OS and publishes it', () async {
      final c = build(NotificationPermissionStatus.blocked);
      expect(c.read(notificationPermissionProvider), isNull);
      await row(c).refresh();
      expect(c.read(notificationPermissionProvider), NotificationPermissionStatus.blocked);

      platform.current = NotificationPermissionStatus.granted;
      await row(c).refresh();
      expect(c.read(notificationPermissionProvider), NotificationPermissionStatus.granted);
    });

    test('never asked: the FIRST ask is the explanation, then (Continue) the system prompt once', () async {
      final c = build(NotificationPermissionStatus.notDetermined);
      await row(c).activate(explainer(true));

      expect(explained, 1);
      expect(tokens.starts, 1);
      expect(store.hasContinued, isTrue);
      expect(platform.opens, 0);
      expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);
    });

    test('never asked, Not now: no system prompt, and the answer is kept', () async {
      final c = build(NotificationPermissionStatus.notDetermined);
      await row(c).activate(explainer(false));

      expect(explained, 1);
      expect(tokens.starts, 0);
      expect(store.lastDeclined, isNotNull);
    });

    test('never asked, the dialog removed unanswered: nothing is asked', () async {
      final c = build(NotificationPermissionStatus.notDetermined);
      await row(c).activate(explainer(null));

      expect(tokens.starts, 0);
      expect(store.hasContinued, isFalse);
      expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);
    });

    test('never asked, but Continue was already pressed on this device: no second explanation', () async {
      final c = build(
        NotificationPermissionStatus.notDetermined,
        initialStore: FakePushExplainerStore(hasContinued: true),
      );
      await row(c).activate(explainer(true));

      expect(explained, 0);
      expect(tokens.starts, 1);
    });

    test('a session already waiting on the explanation gets the answer, and the platform is '
        'asked once, by that session', () async {
      final c = build(NotificationPermissionStatus.notDetermined);
      // What a signed-in session's registrar does at start.
      final waiting = c.read(pushExplainerProvider.notifier).clearToStart();
      await pumpEventQueue();
      expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);

      await row(c).activate(explainer(true));

      expect(await waiting, isTrue, reason: 'the waiting session calls start itself');
      expect(tokens.starts, 0, reason: 'the row must not ask a second time');
      expect(explained, 1);
    });

    test('while the explanation is already on screen, the row does not stack a second one', () async {
      final c = build(NotificationPermissionStatus.notDetermined);
      final explainerNotifier = c.read(pushExplainerProvider.notifier);
      final waiting = explainerNotifier.clearToStart();
      await pumpEventQueue();
      expect(explainerNotifier.claim(), isTrue);

      await row(c).activate(explainer(true));

      expect(explained, 0);
      expect(tokens.starts, 0);
      await explainerNotifier.answer(proceed: false);
      expect(await waiting, isFalse);
    });

    test('Android 13+, refused once: Allow asks again straight away, with no explanation', () async {
      final c = build(NotificationPermissionStatus.denied);
      await row(c).activate(explainer(true));

      expect(explained, 0);
      expect(tokens.starts, 1);
      expect(platform.opens, 0);
    });

    for (final status in [
      NotificationPermissionStatus.blocked,
      NotificationPermissionStatus.granted,
      NotificationPermissionStatus.unknown,
    ]) {
      test('${status.name}: Open settings, and nothing is asked', () async {
        final c = build(status);
        await row(c).activate(explainer(true));

        expect(platform.opens, 1);
        expect(tokens.starts, 0);
        expect(explained, 0);
      });
    }

    test('the status is read again after the tap', () async {
      final c = build(NotificationPermissionStatus.denied);
      await row(c).refresh();
      platform.current = NotificationPermissionStatus.granted;

      await row(c).activate(explainer(true));

      expect(c.read(notificationPermissionProvider), NotificationPermissionStatus.granted);
    });
  });
}
