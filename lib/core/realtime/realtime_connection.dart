import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../features/auth/domain/auth_state.dart';
import '../../features/notifications/application/notifications_controller.dart';
import 'realtime_client.dart';
import 'realtime_events.dart';

/// Ties the realtime transport to the session's lifetime, and re-syncs after a gap.
///
/// TWO JOBS, both of which are about correctness rather than convenience.
///
/// 1. THE SOCKET LIVES EXACTLY AS LONG AS THE SESSION. It connects when a
///    session exists and disconnects the moment one ends, so a revoked session's
///    socket does not outlive it. The token is read from the store rather than
///    held here, so a refresh is picked up on the next connect instead of
///    leaving a stale credential in a field.
///
/// 2. A RECONNECT TRIGGERS A RE-SYNC. This is the offline case, and it is the
///    reason realtime is a convenience and not the source of truth: anything
///    that happened while the socket was down was never delivered to this
///    device. On reconnect the notification list and the unread count are
///    refetched from the database, which DOES have it. Without this a parent who
///    lost signal for ten minutes would come back to a stale badge and would
///    never learn what arrived in the gap.
class RealtimeConnection {
  RealtimeConnection({required Ref ref}) : _ref = ref;

  final Ref _ref;
  StreamSubscription<RealtimeStatus>? _statusSubscription;
  bool _wasConnected = false;

  RealtimeClient get _client => _ref.read(realtimeClientProvider);

  /// Begin following the session. Called once, from the composition root.
  void start() {
    _statusSubscription = _client.status.listen(_onStatusChanged);

    _ref.listen<AuthState>(
      authControllerProvider,
      (previous, next) => unawaited(_apply(next)),
      fireImmediately: true,
    );
  }

  Future<void> _apply(AuthState state) async {
    if (!state.isAuthenticated) {
      await _client.disconnect();
      return;
    }

    final session = await _ref.read(tokenStoreProvider).read();
    final token = session?.accessToken;
    // No token means the session is mid-restore or already gone. Connecting
    // without one would be refused by the server anyway; not trying keeps the
    // reconnect backoff from being spent on a handshake that cannot succeed.
    if (token == null || token.isEmpty) return;

    await _client.connect(token);
  }

  /// A transition from "not connected" to "connected" is a gap that just closed.
  void _onStatusChanged(RealtimeStatus status) {
    final isConnected = status == RealtimeStatus.connected;

    if (isConnected && !_wasConnected) {
      // Everything that happened while the socket was down is in the database
      // and was never delivered here. Refetch rather than hope.
      _ref.invalidate(unreadCountsProvider);
      _ref.read(notificationsControllerProvider.notifier).refresh().catchError((Object _) {
        // A failed re-sync is not worth an error screen: the next pull-to-refresh
        // or the next event tries again, and the badge is already conservative.
      });
    }

    _wasConnected = isConnected;
  }

  void dispose() {
    _statusSubscription?.cancel();
    _statusSubscription = null;
  }
}

/// The transport. Overridden at startup: an inert client in a fixture build, a
/// real Socket.IO client when the app has a backend to talk to.
final realtimeClientProvider = Provider<RealtimeClient>((ref) {
  final client = InertRealtimeClient();
  ref.onDispose(client.dispose);
  return client;
});

/// Transport state, for any surface that wants to say "reconnecting".
final realtimeStatusProvider = StreamProvider<RealtimeStatus>((ref) {
  return ref.watch(realtimeClientProvider).status;
});

/// Started once, from the composition root.
final realtimeConnectionProvider = Provider<RealtimeConnection>((ref) {
  final connection = RealtimeConnection(ref: ref);
  ref.onDispose(connection.dispose);
  return connection;
});
