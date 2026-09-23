import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/push/push_registrar.dart';
import 'package:jawwid_chat/core/push/push_tokens.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';

import '../../support/auth_harness.dart';

/// THE DEVICE HALF OF PUSH.
///
/// Registration, rotation, sign-out, and what a tap does in each of the three
/// app states the product is judged on: open, backgrounded, and terminated.
///
/// Every failure path here asserts the same rule: losing push is a degraded
/// channel, never a broken app. A parent who denied the prompt, is on a
/// de-Googled phone, or is offline still gets every notification in the app.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// A controllable auth state, so the registrar can be driven through sign-in
  /// and sign-out without standing up the real controller.
  ({
    ProviderContainer container,
    FakeNotificationRepository repository,
    InertPushTokens tokens,
    void Function(AuthState) setAuth,
  }) harness({PushPermission permission = PushPermission.granted, String? token}) {
    final repository = FakeNotificationRepository();
    addTearDown(repository.dispose);

    final tokens = InertPushTokens(availableToken: token)..permission = permission;
    addTearDown(tokens.dispose);

    final auth = TestAuthController();

    final container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        notificationRepositoryProvider.overrideWithValue(repository),
        pushTokensProvider.overrideWithValue(tokens),
        authControllerProvider.overrideWith(() => auth),
      ],
    );
    addTearDown(container.dispose);

    return (
      container: container,
      repository: repository,
      tokens: tokens,
      // Read the provider first: a Notifier has no state until something
      // mounts it, and setting state on an unmounted one throws.
      setAuth: (AuthState next) {
        container.read(authControllerProvider);
        auth.set(next);
      },
    );
  }

  const signedIn = signedInParent;

  group('token registration', () {
    test('a signed-in launch registers this device', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);

      await h.container.read(pushRegistrarProvider).start();

      // Registered on every launch: FCM does not promise the same token twice,
      // and a device whose token is never re-reported goes quiet with nothing
      // appearing broken.
      expect(h.repository.registeredTokens, contains('device-token-1'));
    });

    test('a signed-out launch registers nothing', () async {
      final h = harness(token: 'device-token-1');
      await h.container.read(pushRegistrarProvider).start();

      expect(h.repository.registeredTokens, isEmpty);
    });

    test('a refused permission is not an error, and costs only the buzz', () async {
      final h = harness(permission: PushPermission.denied, token: 'device-token-1');
      h.setAuth(signedIn);

      await h.container.read(pushRegistrarProvider).start();

      expect(h.repository.registeredTokens, isEmpty);
      // The app is intact: nothing threw, and the notification centre is
      // unaffected because in-app delivery does not depend on push.
      expect(await h.repository.unreadCounts(), isNotNull);
    });

    test('a device with no token at all is handled, not crashed on', () async {
      // A de-Googled Android, or an iOS simulator with no APNs token.
      final h = harness(token: null);
      h.setAuth(signedIn);

      await expectLater(h.container.read(pushRegistrarProvider).start(), completes);
      expect(h.repository.registeredTokens, isEmpty);
    });

    test('a failed registration does not take the app down', () async {
      final h = harness(token: 'device-token-1');
      h.repository.persistentFailure = const AppError(AppErrorKind.network);
      h.setAuth(signedIn);

      await expectLater(h.container.read(pushRegistrarProvider).start(), completes);
    });

    test('registering twice with the same token does not register twice', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);
      final registrar = h.container.read(pushRegistrarProvider);

      await registrar.start();
      await registrar.register();

      expect(h.repository.registeredTokens, hasLength(1));
    });
  });

  group('token rotation', () {
    test('a rotated token is reported, and the old one is replaced', () async {
      final h = harness(token: 'old-token');
      h.setAuth(signedIn);
      await h.container.read(pushRegistrarProvider).start();
      expect(h.repository.registeredTokens, contains('old-token'));

      // FCM rotates on reinstall, on restore to a new device, and sometimes on
      // its own. An unreported rotation leaves the backend pushing to an
      // address that no longer exists.
      h.tokens.rotateToken('new-token');
      await Future<void>.delayed(Duration.zero);

      expect(h.repository.registeredTokens, contains('new-token'));
    });

    test('a rotation while signed out is ignored', () async {
      final h = harness(token: 'old-token');
      await h.container.read(pushRegistrarProvider).start();

      h.tokens.rotateToken('new-token');
      await Future<void>.delayed(Duration.zero);

      // Registering a token against no session would address it to nobody.
      expect(h.repository.registeredTokens, isEmpty);
    });
  });

  group('sign-out', () {
    test('unregisters the device and destroys the token', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);
      await h.container.read(pushRegistrarProvider).start();
      expect(h.repository.registeredTokens, contains('device-token-1'));

      h.setAuth(const AuthSignedOut());
      await Future<void>.delayed(Duration.zero);

      // Both halves. The backend stops addressing this device, AND the token is
      // destroyed locally -- a handed-down phone must stop receiving the
      // previous account's notifications immediately, not when the backend
      // eventually notices.
      expect(h.repository.registeredTokens, isEmpty);
      expect(h.tokens.deleted, isTrue);
    });

    test('still destroys the token when the backend call fails', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);
      await h.container.read(pushRegistrarProvider).start();

      h.repository.persistentFailure = const AppError(AppErrorKind.network);
      h.setAuth(const AuthSignedOut());
      await Future<void>.delayed(Duration.zero);

      // A push to a deleted token is dropped by the platform, so the previous
      // account's data does not follow them off the device even offline.
      expect(h.tokens.deleted, isTrue);
    });
  });

  group('a push arriving while the app is OPEN', () {
    test('is reported delivered and moves the badge, and shows no banner', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);
      await h.container.read(pushRegistrarProvider).start();

      h.tokens.arriveInForeground(
        const PushPayload(data: {'notificationId': 'n1', 'conversationId': 'c1'}),
      );
      await Future<void>.delayed(Duration.zero);

      // The server infers delivery from nothing, so this report is the only
      // evidence it will ever have.
      expect(h.repository.reportedDelivered, contains('n1'));
      // NOT opened: arriving is not acting on it.
      expect(h.repository.reportedOpened, isEmpty);
    });
  });

  group('a tap while the app is BACKGROUNDED', () {
    test('reports opened, marks read, and produces a route', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);
      final registrar = h.container.read(pushRegistrarProvider);
      await registrar.start();

      final routes = <String>[];
      registrar.deepLinks.listen((link) => routes.add(link.route));

      h.tokens.tap(
        const PushPayload(data: {'notificationId': 'n1', 'conversationId': 'c-abc'}),
      );
      await Future<void>.delayed(Duration.zero);

      expect(h.repository.reportedOpened, contains('n1'));
      // A tapped push certainly arrived, and on a cold start this is the only
      // delivery report the server will get.
      expect(h.repository.reportedDelivered, contains('n1'));
      expect(routes, ['/chats/c-abc']);
    });
  });

  group('a tap that STARTS a terminated app', () {
    test('is read at startup and held until the router can follow it', () async {
      final h = harness(token: 'device-token-1');
      h.tokens.launchPayload = const PushPayload(
        data: {'notificationId': 'n9', 'conversationId': 'c-launch'},
      );
      h.setAuth(signedIn);

      final registrar = h.container.read(pushRegistrarProvider);
      await registrar.start();

      // Held, not navigated: the OS started this process BECAUSE of the tap, so
      // there is no router yet. This is the case the whole feature is judged on.
      final pending = registrar.takePendingDeepLink();
      expect(pending, isNotNull);
      expect(pending!.route, '/chats/c-launch');
      expect(pending.notificationId, 'n9');
    });

    test('is taken exactly once', () async {
      final h = harness(token: 'device-token-1');
      h.tokens.launchPayload = const PushPayload(
        data: {'notificationId': 'n9', 'conversationId': 'c-launch'},
      );
      h.setAuth(signedIn);

      final registrar = h.container.read(pushRegistrarProvider);
      await registrar.start();

      expect(registrar.takePendingDeepLink(), isNotNull);
      // A link followed twice pushes the same screen twice onto the stack.
      expect(registrar.takePendingDeepLink(), isNull);
    });

    test('an ordinary launch holds nothing', () async {
      final h = harness(token: 'device-token-1');
      h.setAuth(signedIn);
      final registrar = h.container.read(pushRegistrarProvider);
      await registrar.start();

      expect(registrar.takePendingDeepLink(), isNull);
    });
  });

  group('what a push payload is allowed to route to', () {
    PushPayload payload(Map<String, String> data) => PushPayload(data: data);

    test('an announcement, from its id', () {
      expect(
        PushDeepLink.resolve(payload({'notificationId': 'n', 'announcementId': 'a1'})),
        '/announcements/a1',
      );
    });

    test('a conversation, from its id', () {
      expect(
        PushDeepLink.resolve(payload({'notificationId': 'n', 'conversationId': 'c1'})),
        '/chats/c1',
      );
    });

    test('the centre, when there is nothing more specific', () {
      // A parent who tapped must always land somewhere that explains why their
      // phone buzzed.
      expect(PushDeepLink.resolve(payload({'notificationId': 'n'})), '/notifications');
    });

    test('nowhere at all, for a payload with no notification', () {
      expect(PushDeepLink.resolve(payload({})), isNull);
    });

    test('ids win over the deeplink string the payload carried', () {
      // A push payload is the least trustworthy route source in the product: it
      // has crossed two platform vendors and arrives as a bare string map. A
      // rebuilt route cannot name a screen that does not exist; an arbitrary
      // string can name anything.
      expect(
        PushDeepLink.resolve(payload({
          'notificationId': 'n',
          'conversationId': 'c1',
          'deeplink': '/admin/all-families',
        })),
        '/chats/c1',
      );
    });

    test('a hostile deeplink with no ids leads to the centre, not to it', () {
      expect(
        PushDeepLink.resolve(payload({
          'notificationId': 'n',
          'deeplink': 'https://evil.example/steal',
        })),
        '/notifications',
      );
    });
  });

  group('the payload carries no private content', () {
    test('a real backend payload has ids and nothing to read', () {
      // Mirrors DeliveryService.payloadFor exactly.
      const p = PushPayload(data: {
        'notificationId': 'n1',
        'type': 'MESSAGE_RECEIVED',
        'category': 'messaging',
        'priority': 'normal',
        'entityType': 'message',
        'entityId': 'm1',
        'conversationId': 'c1',
        'learnerId': 'l1',
      });

      expect(p.notificationId, 'n1');
      expect(p.conversationId, 'c1');

      // Every value is an id or an enum token -- no value contains a space,
      // because prose is what a name or a message body looks like and the
      // backend never puts either in a payload. PushPayload models only what
      // DeliveryService sends, so there is nowhere for content to arrive even
      // if a future payload tried.
      for (final value in p.data.values) {
        expect(value, isNot(contains(' ')), reason: '"$value" reads like content, not an id');
      }
    });
  });
}
