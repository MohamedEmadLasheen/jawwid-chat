import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

import '../../../core/logging/redacting_logger.dart';
import '../../../core/realtime/realtime_events.dart';
import 'outbox_courier.dart';

/// Decides WHEN the queue is drained.
///
/// Kept apart from [OutboxCourier], which decides what "drain" means, because
/// the two change for different reasons: the courier's rules are about
/// ordering and idempotency, and these are about a phone's radio.
///
/// ## The three signals, and why all three
///
/// * **Startup.** Anything restored from the database was composed in a
///   previous run and never acknowledged. Nothing else will notice it: the
///   socket may already be connected and the radio may never change state
///   again, so waiting for an edge would leave the message queued until the
///   user happened to type another one.
/// * **Connectivity returning.** The cheapest and earliest signal that the
///   network is back. It is necessary and NOT sufficient — `connectivity_plus`
///   reports the radio, not reachability, so a captive portal or a dead uplink
///   both look like connectivity.
/// * **The socket connecting.** The strongest signal available: the socket
///   authenticated against the API, so the API is reachable and this session is
///   valid. It is also not sufficient on its own, because a build with realtime
///   disabled never emits it and must still send.
///
/// Draining more often than necessary costs one query of an in-memory queue and
/// is usually a no-op; draining less often leaves somebody's message unsent, so
/// the redundancy is deliberate.
class OutboxDrainPolicy {
  OutboxDrainPolicy({
    required OutboxCourier courier,
    required Stream<RealtimeStatus> realtimeStatus,
    Stream<List<ConnectivityResult>>? connectivity,
    RedactingLogger logger = const RedactingLogger(),
  })  : _courier = courier,
        _realtimeStatus = realtimeStatus,
        _connectivity = connectivity,
        _logger = logger;

  final OutboxCourier _courier;
  final Stream<RealtimeStatus> _realtimeStatus;
  final Stream<List<ConnectivityResult>>? _connectivity;
  final RedactingLogger _logger;

  StreamSubscription<RealtimeStatus>? _realtimeSub;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  /// Restore the queue and start watching. Safe to call once per session.
  Future<void> start() async {
    final restored = await _courier.restore();
    if (restored > 0) {
      // Deliberately a count, never the messages: this line ends up in a log.
      _logger.debug('outbox restored $restored queued message(s) from a previous run');
    }

    _realtimeSub = _realtimeStatus.listen((status) {
      if (status == RealtimeStatus.connected) unawaited(_courier.drain());
    });

    final connectivity = _connectivity ?? Connectivity().onConnectivityChanged;
    _connectivitySub = connectivity.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online) unawaited(_courier.drain());
    });

    // And now, whatever the radio and the socket are doing.
    await _courier.drain();
  }

  Future<void> dispose() async {
    await _realtimeSub?.cancel();
    await _connectivitySub?.cancel();
    _realtimeSub = null;
    _connectivitySub = null;
  }
}
