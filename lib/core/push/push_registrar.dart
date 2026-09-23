import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../features/auth/domain/auth_state.dart';
import '../../features/notifications/application/notifications_controller.dart';
import '../logging/redacting_logger.dart';
import 'push_tokens.dart';

/// Where a tapped notification wants the app to go.
///
/// Held rather than navigated to directly, because a tap can arrive before the
/// router exists — the terminated-app case, where the OS starts the process
/// *because* of the tap. The navigator drains it once there is somewhere to go.
class PendingDeepLink {
  const PendingDeepLink({required this.route, this.notificationId});

  final String route;
  final String? notificationId;
}

/// The device half of push: token lifecycle, and what a tap does.
///
/// FIVE THINGS, and each exists because leaving it out breaks a real case.
///
/// REGISTER on every launch with a session. FCM does not guarantee a token is
/// the same across launches, and a device whose token is never re-reported goes
/// quiet without anything appearing broken.
///
/// FOLLOW ROTATIONS. FCM rotates on reinstall, on restore to a new device, and
/// sometimes on its own. An unreported rotation leaves the backend pushing to an
/// address that no longer exists.
///
/// UNREGISTER on sign-out, and delete the token. A shared or handed-down phone
/// must stop receiving the previous account's notifications immediately, not
/// when the backend eventually notices.
///
/// HANDLE THE TAP in all three app states. Foreground: the realtime channel has
/// already updated the screen, so the push is only told "delivered". Background:
/// the parent tapped, so navigate. Terminated: the tap STARTED the process, so
/// the route is held until the router exists and then followed.
///
/// REPORT HONESTLY. `delivered` is reported when a push actually reaches the
/// device, and `opened` when the parent acts on it. The server infers neither,
/// so these reports are the only evidence those states have — and reporting them
/// optimistically would make every delivery metric a lie.
class PushRegistrar {
  PushRegistrar({
    required Ref ref,
    RedactingLogger logger = const RedactingLogger(),
  })  : _ref = ref,
        _logger = logger;

  final Ref _ref;
  final RedactingLogger _logger;

  final _subscriptions = <StreamSubscription<Object?>>[];
  final _deepLinks = StreamController<PendingDeepLink>.broadcast();

  /// Set when a tap arrived before the router could handle it. Read and cleared
  /// by the navigator on its first frame.
  PendingDeepLink? pendingDeepLink;

  /// The token currently registered with the backend, so a duplicate refresh
  /// does not produce a duplicate registration.
  String? _registeredToken;

  Stream<PendingDeepLink> get deepLinks => _deepLinks.stream;

  PushTokens get _tokens => _ref.read(pushTokensProvider);

  /// Begin. Called once, from the composition root.
  Future<void> start() async {
    _subscriptions.add(_tokens.tokenRefreshes.listen(_onTokenRefreshed));
    _subscriptions.add(_tokens.onForegroundMessage.listen(_onForeground));
    _subscriptions.add(_tokens.onNotificationOpened.listen(_onOpened));

    // Later session changes. The CURRENT one is applied below and awaited:
    // start() is asked to start, and a caller that awaits it should be able to
    // rely on this device being registered when it returns -- `fireImmediately`
    // would hand that work to an unawaited future instead.
    _ref.listen<AuthState>(
      authControllerProvider,
      (previous, next) => unawaited(_onAuthChanged(previous, next)),
    );
    await _onAuthChanged(null, _ref.read(authControllerProvider));

    // The terminated-app case. Read once, before anything else can navigate:
    // the parent tapped a notification and the app must open on that, not on
    // the chat list. This is the case the whole feature is judged on.
    final launch = await _tokens.initialMessage();
    if (launch != null) _onOpened(launch);
  }

  Future<void> _onAuthChanged(AuthState? previous, AuthState next) async {
    if (next.isAuthenticated) {
      // Only when it actually changed. `fireImmediately` plus every unrelated
      // auth rebuild would otherwise re-register on each one.
      if (previous?.isAuthenticated != true) await register();
      return;
    }
    if (previous?.isAuthenticated == true) await unregister();
  }

  /// Ask for permission if needed, then report this device's token.
  ///
  /// Every failure path here is a no-op rather than an error: no permission, no
  /// Play Services, no APNs token yet, no network. The parent still gets every
  /// notification in the app; they just do not get buzzed.
  Future<void> register() async {
    var permission = await _tokens.currentPermission();
    if (permission == PushPermission.notDetermined) {
      permission = await _tokens.requestPermission();
    }
    if (permission == PushPermission.denied) {
      _logger.debug('push permission refused; in-app notifications are unaffected');
      return;
    }

    final token = await _tokens.token();
    if (token == null || token.isEmpty) return;
    await _register(token);
  }

  Future<void> _onTokenRefreshed(String token) async {
    // A rotation must reach the backend even mid-session; that is the whole
    // point of subscribing to it.
    if (!_ref.read(authControllerProvider).isAuthenticated) return;
    await _register(token);
  }

  Future<void> _register(String token) async {
    if (token == _registeredToken) return;
    try {
      await _ref.read(notificationRepositoryProvider).registerDevice(
            token: token,
            platform: Platform.isIOS ? 'ios' : 'android',
            locale: _ref.read(localeCodeProvider),
          );
      _registeredToken = token;
    } catch (_) {
      // Left unregistered rather than retried here: the next launch registers
      // again, and a retry loop around a token the backend may already have is
      // effort spent on a duplicate.
      _logger.debug('device registration failed; will retry on next launch');
    }
  }

  /// Sign-out. Both halves matter: the backend stops addressing this device, and
  /// the token is destroyed locally so the OS stops accepting pushes for it.
  Future<void> unregister() async {
    final token = _registeredToken;
    _registeredToken = null;
    if (token != null) {
      try {
        await _ref.read(notificationRepositoryProvider).unregisterDevice(token);
      } catch (_) {
        // The token is deleted below regardless. A push to a deleted token is
        // dropped by the platform, so the parent's data does not follow them
        // off the device even if this call failed.
      }
    }
    await _tokens.delete();
  }

  /// A push that arrived while the app was open.
  ///
  /// The OS shows nothing for these, which is correct: the realtime channel has
  /// already updated the badge and the list, and a banner over the conversation
  /// the parent is reading is noise. The only thing to do is tell the server it
  /// arrived, because nothing else can.
  void _onForeground(PushPayload payload) {
    final id = payload.notificationId;
    if (id == null) return;
    unawaited(
      _ref
          .read(notificationRepositoryProvider)
          .reportDelivered(id)
          .catchError((Object _) {}),
    );
    _ref.invalidate(unreadCountsProvider);
  }

  /// The parent tapped.
  void _onOpened(PushPayload payload) {
    final id = payload.notificationId;
    if (id != null) {
      final repository = _ref.read(notificationRepositoryProvider);
      // Delivered as well as opened: a push that was tapped certainly arrived,
      // and on a cold start this is the only report the server will ever get.
      unawaited(repository.reportDelivered(id).catchError((Object _) {}));
      unawaited(repository.reportOpened(id).catchError((Object _) {}));
      unawaited(repository.markRead(id).catchError((Object _) {}));
      _ref.invalidate(unreadCountsProvider);
    }

    final route = PushDeepLink.resolve(payload);
    if (route == null) return;

    final link = PendingDeepLink(route: route, notificationId: id);
    // Held AND emitted. On a cold start there is no listener yet, so the held
    // value is what the router reads on its first frame; while running, the
    // listener navigates immediately.
    pendingDeepLink = link;
    _deepLinks.add(link);
  }

  /// Called by the navigator once it is able to route. Clears as it reads, so a
  /// link is followed once and not again on the next rebuild.
  PendingDeepLink? takePendingDeepLink() {
    final link = pendingDeepLink;
    pendingDeepLink = null;
    return link;
  }

  void dispose() {
    for (final subscription in _subscriptions) {
      subscription.cancel();
    }
    _subscriptions.clear();
    _deepLinks.close();
  }
}

/// Where a push payload leads.
///
/// SEPARATE FROM THE IN-APP RESOLVER ON PURPOSE. A push payload is the least
/// trustworthy route source in the product: it has travelled through Google's
/// and Apple's infrastructure and arrives as a bare string map. So this accepts
/// only routes this build actually has a screen for, and prefers rebuilding one
/// from the payload's ids over following the string it was handed.
abstract final class PushDeepLink {
  static String? resolve(PushPayload payload) {
    // Ids first. A reconstructed route cannot name a screen that does not exist,
    // whereas a `deeplink` string can name anything at all.
    final announcementId = payload.announcementId;
    if (announcementId != null && announcementId.isNotEmpty) {
      return '/announcements/$announcementId';
    }

    final conversationId = payload.conversationId;
    if (conversationId != null && conversationId.isNotEmpty) {
      return '/chats/$conversationId';
    }

    // Nothing routable: open the centre, where the notification itself is. A
    // parent who tapped must always land somewhere that explains why their phone
    // buzzed.
    return payload.notificationId != null ? '/notifications' : null;
  }
}

/// The device's push seam. Inert by default, so no test opens a platform
/// channel and a fixture build needs no Firebase configuration.
final pushTokensProvider = Provider<PushTokens>((ref) {
  final tokens = InertPushTokens();
  ref.onDispose(tokens.dispose);
  return tokens;
});

final pushRegistrarProvider = Provider<PushRegistrar>((ref) {
  final registrar = PushRegistrar(ref: ref);
  ref.onDispose(registrar.dispose);
  return registrar;
});
