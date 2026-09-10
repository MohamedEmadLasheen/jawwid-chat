import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_state.dart';
import '../features/auth/presentation/sign_in_screen.dart';
import '../features/calls/presentation/calls_screen.dart';
import '../features/conversations/presentation/chats_screen.dart';
import '../features/messages/presentation/chat_screen_route.dart';
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
