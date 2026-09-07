import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_state.dart';
import '../features/auth/presentation/sign_in_screen.dart';
import '../features/calls/presentation/call_history_screen.dart';
import '../features/calls/presentation/call_screen.dart';
import '../features/conversations/presentation/conversations_screen.dart';
import '../features/conversations/presentation/groups_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/messages/presentation/chat_screen_route.dart';
import '../features/messages/presentation/search_screen.dart';
import '../features/settings/presentation/settings_screen.dart';
import '../features/stories/presentation/stories_screen.dart';
import '../shared/models/user_role.dart';
import 'providers.dart';
import 'shells/app_shell.dart';

/// Route paths, named once so deep links and in-app navigation cannot drift apart (§52).
abstract final class Routes {
  static const splash = '/';
  static const signIn = '/sign-in';
  static const home = '/home';
  static const chats = '/chats';
  static const groups = '/groups';
  static const settings = '/settings';
  static const search = '/search';

  /// The live call surface. ONE route, because a device is in at most one call
  /// and modelling it per conversation is how two ring screens end up stacked.
  static const call = '/call';
  static const stories = '/stories';

  static String conversation(String id) => '/chats/$id';

  /// Call history for one conversation. Scoped exactly as the server scopes
  /// it -- per conversation, because that is the scope it authorizes.
  static String conversationCalls(String id) => '/chats/$id/calls';

  /// Search inside one conversation. The server authorizes the scope exactly as
  /// it authorizes opening the conversation.
  static String conversationSearch(String id) => '/chats/$id/search';
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
            path: Routes.home,
            builder: (context, state) => const HomeScreen(),
          ),
          GoRoute(
            path: Routes.chats,
            builder: (context, state) => const ConversationsScreen(),
          ),
          GoRoute(
            path: Routes.groups,
            builder: (context, state) => const GroupsScreen(),
          ),
          GoRoute(
            path: Routes.settings,
            builder: (context, state) => const SettingsScreen(),
          ),
        ],
      ),
      // Search opens full-screen: it takes over the keyboard and the viewport,
      // and returning to where you were is the back gesture.
      GoRoute(
        path: Routes.search,
        builder: (context, state) => const SearchScreen(),
      ),
      // A call takes the whole screen and sits above everything, including the
      // tab bar: it is the only thing the user is doing while it is up.
      GoRoute(
        path: Routes.call,
        builder: (context, state) => const CallScreen(),
      ),
      GoRoute(
        path: Routes.stories,
        builder: (context, state) => const StoriesScreen(),
      ),
      // Conversations open full-screen, above the tab bar, so the thread gets the whole
      // viewport — the composer and keyboard already claim a large share of a small screen.
      GoRoute(
        path: '${Routes.chats}/:conversationId',
        builder: (context, state) => ChatScreenRoute(
          conversationId: state.pathParameters['conversationId']!,
        ),
        routes: [
          GoRoute(
            path: 'search',
            builder: (context, state) => SearchScreen(
              conversationId: state.pathParameters['conversationId'],
            ),
          ),
          GoRoute(
            path: 'calls',
            builder: (context, state) => CallHistoryScreen(
              conversationId: state.pathParameters['conversationId']!,
            ),
          ),
        ],
      ),
    ],
  );
});

/// Where an unauthenticated or undecided session may go.
///
/// A deep link's target id is *not* validated here — the backend remains the authority on
/// whether this user may see that conversation (§52). This only decides signed-in vs not.
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
  if (atEntry) return Routes.home;

  // A teacher has no Jawwid tab; landing on it via a stale deep link goes home rather than
  // rendering a tab their shell does not contain.
  final role = ref.read(currentRoleProvider);
  if (role == UserRole.teacher && location == Routes.chats) return Routes.home;

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
