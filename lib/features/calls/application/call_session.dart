import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/realtime/call_event.dart';
import '../../../core/realtime/call_realtime_client.dart';

/// The realtime call client, owned by the authenticated session.
///
/// ONE OWNER. This provider is the only place a [CallRealtimeClient] is built.
/// No widget, screen, conversation page or callback constructs one, so there is
/// no second connection for the same user and no listener that outlives the
/// thing that registered it.
///
/// THE LIFECYCLE IS THE IDENTITY. It watches the signed-in account id and
/// nothing else. Riverpod disposes and rebuilds a provider when what it watches
/// changes, so:
///
///   * signed out or still unknown  -> null, and no socket is opened;
///   * a user signs in              -> one client, connected;
///   * the session ends             -> the watched id becomes null, this is
///                                     disposed, and `dispose()` closes the
///                                     socket and drops every listener;
///   * a different user signs in    -> the id CHANGED, so the old client was
///                                     already disposed before the new one
///                                     exists.
///
/// That last case is the security property, and it is structural rather than
/// remembered: there is no path where user B's client is user A's object,
/// because the identity is what the provider is keyed on. Watching the whole
/// auth state instead would rebuild on unrelated changes and churn the socket;
/// watching the id rebuilds exactly when the principal changes.
///
/// IDENTITY IS STILL THE SERVER'S. The account id is used to decide WHEN to
/// hold a client, never to say who the client is. Authentication is the bearer
/// token, through TokenProvider, exactly as W2 built it — nothing here adds an
/// actorId to a handshake, and there is no anonymous branch.
final callRealtimeClientProvider = Provider<CallRealtimeClient?>((ref) {
  final accountId = ref.watch(
    authControllerProvider.select((state) => state.user?.id),
  );
  if (accountId == null) return null;

  final client = CallRealtimeClient(
    socket: ref.watch(realtimeSocketProvider),
    tokens: ref.watch(realtimeTokenProvider),
    logger: ref.watch(loggerProvider),
  );

  // Disposal is registered BEFORE the connect below, so a failure while
  // connecting still leaves a client that will be torn down.
  ref.onDispose(client.dispose);

  // Connect on creation. The session already exists — this provider is not
  // reached otherwise — so there is nothing to wait for and no loop polling for
  // a state that has already arrived.
  client.connect();

  return client;
});

/// Typed call events for the application layer.
///
/// Empty while signed out, rather than an error: no session is not a fault.
///
/// This is where W2's events surface and where W3 stops. Nothing subscribes to
/// it yet — the call experience is a later workstream — and nothing here
/// touches a widget, a route or a dialog.
final callEventsProvider = StreamProvider<CallEvent>((ref) {
  final client = ref.watch(callRealtimeClientProvider);
  return client?.events ?? const Stream<CallEvent>.empty();
});

/// The connection's state, for whatever later needs to show it.
final callRealtimeStateProvider = Provider<CallRealtimeState>((ref) {
  final client = ref.watch(callRealtimeClientProvider);
  return client?.state ?? CallRealtimeState.idle;
});
