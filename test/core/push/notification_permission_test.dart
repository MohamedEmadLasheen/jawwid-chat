/// LR-11b: the notification permission's status and its recovery, without a widget.
///
/// The status mapping (what the native side says -> what the Settings row does), the
/// channel half (#557's `jawwid/push_tokens`, extended), and the row's tap: the first
/// ask goes through #557's explanation and nothing else; Android 13+'s "refused once"
/// asks again directly; everything else opens the phone's settings. The screen half is
/// `test/features/notifications/notification_permission_tile_test.dart`.
library;

import 'dart:async';

import 'package:flutter/foundation.dart' show TargetPlatform, debugDefaultTargetPlatformOverride;
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

  /// While set and not completed, every status read hangs (a native side that
  /// never answers).
  Completer<void>? hold;

  @override
  Future<NotificationPermissionStatus> status() async {
    reads++;
    final waitFor = hold;
    if (waitFor != null) await waitFor.future;
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

    test('iOS: never asked, but Continue was already pressed on this device: no second explanation',
        () async {
      // iOS knows "never asked" itself, so its answer is trusted as it is.
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final c = build(
        NotificationPermissionStatus.notDetermined,
        initialStore: FakePushExplainerStore(hasContinued: true),
      );
      expect(await row(c).refresh(), NotificationPermissionStatus.notDetermined);
      await row(c).activate(explainer(true));

      expect(explained, 0);
      expect(tokens.starts, 1);
    });

    group('upgrade path (Android): Continue already pressed counts as "already asked"', () {
      setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.android);
      tearDown(() => debugDefaultTargetPlatformOverride = null);

      test('the native side says "never asked" (no saved request from an older build), but '
          'Continue was pressed: blocked, and the tap opens Settings', () async {
        final c = build(
          NotificationPermissionStatus.notDetermined,
          initialStore: FakePushExplainerStore(hasContinued: true),
        );
        expect(await row(c).refresh(), NotificationPermissionStatus.blocked);
        expect(c.read(notificationPermissionProvider), NotificationPermissionStatus.blocked);

        await row(c).activate(explainer(true));
        expect(platform.opens, 1);
        expect(tokens.starts, 0, reason: 'the OS would show nothing: a silent no-op tap');
        expect(explained, 0);
      });

      test('Continue never pressed: "never asked" stands', () async {
        final c = build(NotificationPermissionStatus.notDetermined);
        expect(await row(c).refresh(), NotificationPermissionStatus.notDetermined);
      });

      test('the store unreadable: the native answer stands', () async {
        final c = build(
          NotificationPermissionStatus.notDetermined,
          initialStore: FakePushExplainerStore(hasContinued: true, readThrows: true),
        );
        expect(await row(c).refresh(), NotificationPermissionStatus.notDetermined);
      });

      test('only "never asked" is reinterpreted: every other native answer stands', () async {
        for (final status in [
          NotificationPermissionStatus.granted,
          NotificationPermissionStatus.denied,
          NotificationPermissionStatus.blocked,
          NotificationPermissionStatus.unknown,
        ]) {
          final c = build(status, initialStore: FakePushExplainerStore(hasContinued: true));
          expect(await row(c).refresh(), status, reason: status.name);
        }
      });
    });

    test('a native status read that never answers: unknown after the timeout (the row shows, '
        'neutral, and Open settings works)', () async {
      final c = build(NotificationPermissionStatus.granted);
      platform.hold = Completer<void>();

      final read = row(c).refresh();
      expect(await read, NotificationPermissionStatus.unknown);
      expect(c.read(notificationPermissionProvider), NotificationPermissionStatus.unknown);
      expect(notificationPermissionReadTimeout, const Duration(seconds: 2));
      platform.hold!.complete();
    }, timeout: const Timeout(Duration(seconds: 10)));

    // testWidgets for its fake clock: it fails any test that ends with a timer still
    // pending, which is exactly what these three guard against.
    testWidgets('the row goes while a native read still hangs: the read ends at once, its timeout '
        'cancelled, and nothing is written', (tester) async {
      final c = build(NotificationPermissionStatus.granted);
      platform.hold = Completer<void>();
      NotificationPermissionStatus? result;
      unawaited(row(c).refresh().then((s) => result = s));
      await tester.pump();
      expect(result, isNull, reason: 'still waiting on the native side');

      // What the row's `dispose` does.
      row(c).stopWaiting();
      await tester.pump();
      expect(result, NotificationPermissionStatus.unknown, reason: 'nothing known yet');
      expect(c.read(notificationPermissionProvider), isNull, reason: 'nothing written');

      // The native side answering late changes nothing either.
      platform.hold!.complete();
      await tester.pump();
      expect(c.read(notificationPermissionProvider), isNull);
    });

    testWidgets('disposing the controller cancels a hanging read\'s timeout too', (tester) async {
      final c = build(NotificationPermissionStatus.granted);
      platform.hold = Completer<void>();
      var ended = false;
      unawaited(row(c).refresh().then((_) => ended = true));
      await tester.pump();

      c.dispose();
      await tester.pump();
      expect(ended, isTrue);
      platform.hold!.complete();
      await tester.pump();
    });

    testWidgets('the row goes during a tap\'s first read: nothing is opened or asked, and the row '
        'is not left busy', (tester) async {
      final c = build(NotificationPermissionStatus.denied);
      platform.hold = Completer<void>();
      var finished = false;
      unawaited(row(c).activate(explainer(true)).then((_) => finished = true));
      await tester.pump();

      row(c).stopWaiting();
      await tester.pump();
      expect(finished, isTrue);
      expect(tokens.starts, 0);
      expect(platform.opens, 0);
      platform.hold!.complete();
      await tester.pump();
    });

    group('the row\'s explanation torn down unanswered (its navigator removed: the dialog\'s '
        'future never completes)', () {
      test('the claim is handed back, a new session\'s explanation still shows, and the row works',
          () async {
        final c = build(NotificationPermissionStatus.notDetermined);
        final explainerNotifier = c.read(pushExplainerProvider.notifier);
        final never = Completer<bool?>();
        final stuck = row(c).activate(() {
          explained++;
          return never.future;
        });
        await pumpEventQueue();
        expect(c.read(pushExplainerProvider), PushExplainerPhase.onScreen);

        // What the row's `dispose` does.
        row(c).dialogAbandoned();
        expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);

        // A new session (the same person signing in again) is still explained to.
        final waiting = explainerNotifier.clearToStart();
        await pumpEventQueue();
        expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);
        expect(explainerNotifier.claim(), isTrue, reason: 'the host can show it');
        await explainerNotifier.answer(proceed: false);
        expect(await waiting, isFalse);

        // And the row is not stuck busy.
        await row(c).activate(explainer(true));
        expect(explained, 2);
        expect(tokens.starts, 1);

        // The old dialog's late answer is no longer anybody's: nothing more is asked.
        never.complete(true);
        await stuck;
        expect(tokens.starts, 1);
        expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);
      });

      test('a session that was already waiting goes on waiting, and its host can ask', () async {
        final c = build(NotificationPermissionStatus.notDetermined);
        final explainerNotifier = c.read(pushExplainerProvider.notifier);
        final waiting = explainerNotifier.clearToStart();
        await pumpEventQueue();
        unawaited(row(c).activate(() => Completer<bool?>().future));
        await pumpEventQueue();
        expect(c.read(pushExplainerProvider), PushExplainerPhase.onScreen);

        row(c).dialogAbandoned();

        expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);
        expect(explainerNotifier.claim(), isTrue);
        await explainerNotifier.answer(proceed: true);
        expect(await waiting, isTrue);
        expect(tokens.starts, 0, reason: 'the waiting session calls start itself');
      });

      test('a late answer after a host took the screen does not disturb the host', () async {
        final c = build(NotificationPermissionStatus.notDetermined);
        final explainerNotifier = c.read(pushExplainerProvider.notifier);
        final never = Completer<bool?>();
        final stuck = row(c).activate(() => never.future);
        await pumpEventQueue();
        row(c).dialogAbandoned();

        final waiting = explainerNotifier.clearToStart();
        await pumpEventQueue();
        expect(explainerNotifier.claim(), isTrue);

        never.complete(null);
        await stuck;
        expect(c.read(pushExplainerProvider), PushExplainerPhase.onScreen,
            reason: 'the host\'s dialog is still the one on screen');
        await explainerNotifier.answer(proceed: true);
        expect(await waiting, isTrue);
      });
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
