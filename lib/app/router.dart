import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/push/push_registrar.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/auth/presentation/sign_in_screen.dart';
import '../features/calls/presentation/calls_screen.dart';
import '../features/conversations/presentation/chats_screen.dart';
import '../features/messages/presentation/chat_screen_route.dart';
import '../features/notifications/presentation/announcement_screen.dart';
import '../features/notifications/presentation/notification_center_screen.dart';
import '../features/notifications/presentation/notification_preferences_screen.dart';
import '../features/profile/presentation/profile_screen.dart';
import '../features/settings/presentation/settings_screen.dart';
import 'providers.dart';
import 'shells/app_shell.dart';

/// Route paths, named once so deep links and in-app navigation cannot drift apart (§52).
abstract final class Routes {
  static const splash = '/';
  static const signIn = '/sign-in';
  static const chats = '/chats';
  static const calls = '/calls';
  static const settings = '/settings';

  /// The notification centre. Reached from the bell, and from a push that was
  /// tapped while the app was closed.
  static const notifications = '/notifications';
  static const notificationPreferences = '/settings/notifications';

  static String announcement(String id) => '/announcements/$id';

  /// Retired destinations. They are not routes any more — Home and Groups both dissolved
  /// into Chats — but they are kept named here because notifications, saved links and
  /// earlier installs still point at them, and a stale link must land somewhere sensible
  /// rather than on a 404.
  static const retiredHome = '/home';
  static const retiredGroups = '/groups';

  static String conversation(String id) => '/chats/$id';

  /// A person's profile, or a group's info. Reached only by tapping an avatar or a name —
  /// there is no Profile tab, and there never will be.
  static String conversationProfile(String id) => '/chats/$id/info';

  /// The signed-in user's own account. Deliberately under Settings rather than alongside
  /// the profiles above: "my account" and "someone else's profile" are different things.
  static const myAccount = '/settings/account';
}

/// Rebuilds on every authentication change, so a session ending immediately evicts every
/// protected screen rather than leaving stale data on screen (§7).
final routerProvider = Provider<GoRouter>((ref) {
  final notifier = _AuthRefresh(ref);
  ref.onDispose(notifier.dispose);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: notifier,
    redirect: (context, state) => _redirect(ref, state.matchedLocation),
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (context, state) => const _SplashScreen(),
      ),
      GoRoute(
        path: Routes.signIn,
        builder: (context, state) => const SignInScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => _RoleShell(
          currentRoute: state.matchedLocation,
          child: child,
        ),
        routes: [
          GoRoute(
            path: Routes.chats,
            builder: (context, state) => const ChatsScreen(),
          ),
          GoRoute(
            path: Routes.calls,
            builder: (context, state) => const CallsScreen(),
          ),
          GoRoute(
            path: Routes.settings,
            builder: (context, state) => const SettingsScreen(),
          ),
        ],
      ),
      // Conversations open full-screen, above the tab bar, so the thread gets the whole
      // viewport — the composer and keyboard already claim a large share of a small screen.
      GoRoute(
        path: '${Routes.chats}/:conversationId',
        builder: (context, state) => ChatScreenRoute(
          conversationId: state.pathParameters['conversationId']!,
        ),
      ),
      // The profile sits outside the tab shell, like the conversation it belongs to: it is
      // pushed on top, keeps a back button, and never highlights a tab.
      GoRoute(
        path: '${Routes.chats}/:conversationId/info',
        builder: (context, state) => ConversationProfileScreen(
          conversationId: state.pathParameters['conversationId']!,
        ),
      ),
      GoRoute(
        path: Routes.myAccount,
        builder: (context, state) => const MyAccountScreen(),
      ),
      // The notification centre sits outside the tab shell, like a conversation:
      // it is pushed on top, keeps a back button, and highlights no tab. It is
      // not a destination of its own -- it is somewhere you go and come back
      // from, which is also what a push notification expects when it opens it.
      GoRoute(
        path: Routes.notifications,
        builder: (context, state) => const NotificationCenterScreen(),
      ),
      GoRoute(
        path: Routes.notificationPreferences,
        builder: (context, state) => const NotificationPreferencesScreen(),
      ),
      // An announcement's deep link. The id is NOT validated here -- the screen
      // fetches it and the backend decides whether this user may see it, which
      // is the same rule every other deep link in this router follows.
      GoRoute(
        path: '/announcements/:announcementId',
        builder: (context, state) => AnnouncementScreen(
          announcementId: state.pathParameters['announcementId']!,
        ),
      ),
      // The two retired destinations, registered purely to forward. Declared as real routes
      // rather than left to the top-level redirect so that an old link is *matched* and
      // forwarded, instead of falling through to an error page.
      GoRoute(
        path: Routes.retiredHome,
        redirect: (context, state) => Routes.chats,
      ),
      GoRoute(
        path: Routes.retiredGroups,
        redirect: (context, state) => Routes.chats,
      ),
    ],
  );
});

/// Where an unauthenticated or undecided session may go.
///
/// A deep link's target id is *not* validated here — the backend remains the authority on
/// whether this user may see that conversation (§52). This only decides signed-in vs not,
/// and forwards the two retired destinations.
String? _redirect(Ref ref, String location) {
  final auth = ref.read(authControllerProvider);

  // Decide nothing until the stored session has been read, or the app flashes the login
  // screen on every cold start.
  if (auth is AuthUnknown) {
    return location == Routes.splash ? null : Routes.splash;
  }

  final atEntry = location == Routes.signIn || location == Routes.splash;

  // Signed out: go to sign-in unless already there. Treating the splash as an acceptable
  // destination here is what stranded the app on the loading spinner — the splash is a
  // waiting state for AuthUnknown only, never somewhere to come to rest.
  if (!auth.isAuthenticated) {
    return location == Routes.signIn ? null : Routes.signIn;
  }

  // Signing in lands on the conversations, with nothing in between. "I opened Jawwid Chat,
  // so I see my chats" is the whole mental model, and a dashboard stop on the way would
  // undo it on every single launch.
  if (atEntry) return Routes.chats;

  // Home and Groups are gone. Both were views of the same conversations, so both forward
  // to the list that now holds them; Groups arrives at Chats, where the Groups chip is one
  // tap away.
  if (location == Routes.retiredHome || location == Routes.retiredGroups) {
    return Routes.chats;
  }

  return null;
}

/// Follows a notification tap once there is somewhere to go.
///
/// A tap can arrive BEFORE the router exists: when the app is terminated, the OS
/// starts the process because of the tap, and `PushRegistrar` has already read
/// and held the route by the time the first frame is built. So this drains the
/// held link on mount as well as listening for later ones.
///
/// The route is followed only once authenticated. A tap on a signed-out app
/// lands on sign-in and the link is kept, so the parent arrives where they were
/// going after signing in rather than on the chat list wondering what buzzed.
class PushDeepLinkNavigator extends ConsumerStatefulWidget {
  const PushDeepLinkNavigator({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<PushDeepLinkNavigator> createState() => _PushDeepLinkNavigatorState();
}

class _PushDeepLinkNavigatorState extends ConsumerState<PushDeepLinkNavigator> {
  @override
  void initState() {
    super.initState();
    // After the first frame: GoRouter cannot navigate during a build.
    WidgetsBinding.instance.addPostFrameCallback((_) => _drain());
  }

  void _drain() {
    if (!mounted) return;
    final registrar = ref.read(pushRegistrarProvider);
    // Held only while signed out. Taking it before there is a session would
    // navigate to a screen the redirect immediately replaces, losing the link.
    if (!ref.read(authControllerProvider).isAuthenticated) return;

    final link = registrar.takePendingDeepLink();
    if (link != null && mounted) _router.push(link.route);
  }

  /// The router, from the provider that owns it rather than from the context.
  ///
  /// NOT `GoRouter.of(context)`. This widget is mounted in
  /// `MaterialApp.router`'s builder, which wraps the Router and is therefore an
  /// ANCESTOR of the `InheritedGoRouter` that `GoRouter.of` looks up -- so that
  /// call throws "No GoRouter found in context" at the exact moment a parent
  /// taps a notification, which is the one moment this widget exists for.
  /// `routerProvider` holds the same instance and is reachable from here.
  GoRouter get _router => ref.read(routerProvider);

  @override
  Widget build(BuildContext context) {
    // A tap while the app is running.
    ref.listen(pushDeepLinkStreamProvider, (previous, next) {
      final link = next.value;
      if (link == null || !mounted) return;
      if (!ref.read(authControllerProvider).isAuthenticated) return;
      ref.read(pushRegistrarProvider).takePendingDeepLink();
      _router.push(link.route);
    });

    // Signing in drains anything held from a tap taken while signed out.
    ref.listen(authControllerProvider, (previous, next) {
      if (next.isAuthenticated && previous?.isAuthenticated != true) _drain();
    });

    return widget.child;
  }
}

/// Taps that arrive while the app is running.
final pushDeepLinkStreamProvider = StreamProvider<PendingDeepLink>((ref) {
  return ref.watch(pushRegistrarProvider).deepLinks;
});

class _RoleShell extends ConsumerWidget {
  const _RoleShell({required this.currentRoute, required this.child});

  final String currentRoute;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(currentRoleProvider);
    if (role == null) return const _SplashScreen();

    return AppShell(
      role: role,
      currentRoute: currentRoute,
      onDestinationSelected: (route) => context.go(route),
      child: child,
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
}

class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(this._ref) {
    _subscription = _ref.listen(
      authControllerProvider,
      (_, _) => notifyListeners(),
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}
