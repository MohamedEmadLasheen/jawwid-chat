import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/push/push_opens.dart';
import '../../../shared/models/user_role.dart';
import '../../auth/domain/auth_state.dart';
import '../data/notifications_repository.dart';
import '../domain/inbox.dart';
import '../presentation/notification_center_screen.dart' show routeFor;

/// Where a tap on [open] goes for [role]. Null: nowhere (a call -- it has its own path).
///
/// The Notification Center entry's own button first, through the Center's [routeFor] -- so
/// a push and its entry open the same screen, with the same per-role refusals (a feedback
/// item is a parent's only). Then the conversation a message push names. Then the Center
/// itself, which is never wrong: every push has an entry there.
String? routeForPushOpen(PushOpen open, UserRole? role) {
  if (open.isCall) return null;
  final kind = InboxActionKind.tryParse(open.actionKind);
  if (kind != null) {
    final route = routeFor(
      InboxAction(
        kind,
        conversationId: open.conversationId,
        lessonId: open.lessonId,
        learnerId: open.learnerId,
        taskId: open.taskId,
        feedbackId: open.feedbackId,
      ),
      role,
    );
    if (route != null) return route;
  }
  if (open.conversationId != null) return Routes.conversation(open.conversationId!);
  return Routes.notifications;
}

/// The platform tap source. Overridable so tests never touch a channel.
final pushOpensProvider = Provider<PushOpens>((ref) {
  final opens = PlatformPushOpens();
  ref.onDispose(opens.dispose);
  return opens;
});

/// Opens what a tapped push is about, whatever state the app was in.
///
///   closed      the native side holds the tap until [PushOpens.start]; it arrives while
///               the stored session is still being restored, so it waits here
///               ([AuthUnknown], or [AuthUnreachable] while that retries) and is opened
///               once the session is back.
///   background  the tap arrives with the session live: opened at once.
///   open        the same (iOS shows an ordinary push as a banner while open, Android
///               draws it; a tap on either lands here).
///
/// A tap that finds no session (restored as signed out, or ended) is DROPPED, never
/// carried into whoever signs in next: a notification on this phone may have been meant
/// for the previous account. Even if it were opened, the screen re-reads the item through
/// the new account's own routes and finds nothing of another family's.
class PushOpenCoordinator {
  PushOpenCoordinator(this._container);

  final ProviderContainer _container;
  PushOpen? _pending;
  StreamSubscription<PushOpen>? _sub;
  ProviderSubscription<AuthState>? _auth;

  void start() {
    final opens = _container.read(pushOpensProvider);
    _sub = opens.opens().listen(_onOpen);
    _auth = _container.listen<AuthState>(authControllerProvider, (previous, next) {
      // A session ended: its notifications leave the tray, for whoever uses the phone next.
      if (previous is AuthAuthenticated && next is AuthSignedOut) unawaited(_clear());
      _flush(next);
    });
    unawaited(opens.start());
  }

  void _onOpen(PushOpen open) {
    if (open.isCall) return;
    _pending = open;
    _flush(_container.read(authControllerProvider));
  }

  void _flush(AuthState auth) {
    final open = _pending;
    // The stored session is still being restored (or retried): wait for it.
    if (open == null || auth is AuthUnknown || auth is AuthUnreachable) return;
    _pending = null;
    // Signed out, or someone signing in by hand: not the session the push was for.
    if (auth is! AuthAuthenticated) return;

    final id = open.notificationId;
    if (id != null) unawaited(_recordOpened(id));
    final route = routeForPushOpen(open, _container.read(currentRoleProvider));
    if (route == null) return;
    _goWhenReady(route, 0);
  }

  /// After the frame, and only once the router has left the splash: on a cold start the
  /// router learns the session is back at the same moment this does, and its redirect off
  /// the splash would replace a page pushed before it.
  void _goWhenReady(String route, int frames) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final GoRouter router = _container.read(routerProvider);
      final here = router.routerDelegate.currentConfiguration;
      final onSplash = here.isEmpty || here.last.matchedLocation == Routes.splash;
      if (onSplash && frames < _maxFramesOnSplash) {
        _goWhenReady(route, frames + 1);
        return;
      }
      _go(router, route);
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  /// About two seconds at 60 Hz; a router still on the splash after that opens it anyway.
  static const _maxFramesOnSplash = 120;

  void _go(GoRouter router, String route) {
    if (isShellTab(route)) {
      router.go(route);
    } else {
      unawaited(router.push(route));
    }
  }

  Future<void> _clear() async {
    try {
      await _container.read(pushOpensProvider).clearDelivered();
    } catch (_) {
      // A courtesy; never in the way of signing out.
    }
  }

  Future<void> _recordOpened(String notificationId) async {
    try {
      await _container.read(notificationsRepositoryProvider).pushOpened(notificationId);
    } catch (_) {
      // A courtesy for the delivery record; opening the screen is what was asked for.
    }
  }

  void dispose() {
    unawaited(_sub?.cancel());
    _auth?.close();
  }
}

/// Starts handling push taps for the life of the app. Called once, from `main`.
PushOpenCoordinator startPushOpens(ProviderContainer container) => PushOpenCoordinator(container)..start();
