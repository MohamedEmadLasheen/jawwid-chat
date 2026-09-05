import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_state.dart';
import 'providers.dart';

/// Route paths, named once so deep links and in-app navigation cannot drift apart (§52).
abstract final class Routes {
  static const splash = '/';
  static const signIn = '/sign-in';
  static const chats = '/chats';
  static const calls = '/calls';
  static const updates = '/updates';
  static const profile = '/profile';

  static String conversation(String id) => '/chats/$id';
  static String groupMembers(String id) => '/chats/$id/members';
  static String call(String id) => '/calls/$id';
}

/// Rebuilds the router whenever authentication changes, so a session ending immediately
/// evicts every protected screen rather than leaving stale data on screen (§7).
final routerProvider = Provider<GoRouter>((ref) {
  final notifier = _AuthRefresh(ref);
  ref.onDispose(notifier.dispose);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: notifier,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final location = state.matchedLocation;

      // Decide nothing until the stored session has been read.
      if (auth is AuthUnknown) {
        return location == Routes.splash ? null : Routes.splash;
      }

      final signedIn = auth.isAuthenticated;
      final atEntry = location == Routes.signIn || location == Routes.splash;

      if (!signedIn) return atEntry ? Routes.signIn : Routes.signIn;
      if (atEntry) return Routes.chats;

      return null;
    },
    routes: routes,
  );
});

/// Route table, exposed for tests.
final List<RouteBase> routes = <RouteBase>[
  GoRoute(
    path: Routes.splash,
    builder: (context, state) => const _SplashScreen(),
  ),
  GoRoute(
    path: Routes.signIn,
    builder: (context, state) => const _Placeholder('sign-in'),
  ),
  GoRoute(
    path: Routes.chats,
    builder: (context, state) => const _Placeholder('chats'),
    routes: [
      GoRoute(
        path: ':conversationId',
        builder: (context, state) =>
            _Placeholder('conversation ${state.pathParameters['conversationId']}'),
      ),
    ],
  ),
];

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
}

class _Placeholder extends StatelessWidget {
  const _Placeholder(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Text(label)));
}

class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(this._ref) {
    _subscription = _ref.listen(
      authControllerProvider,
      (_, __) => notifyListeners(),
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
