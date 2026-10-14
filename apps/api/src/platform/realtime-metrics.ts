/**
 * Process-wide counters for realtime delivery and revocation -- the "metrics"
 * half of "refusals are observable" (each increment sits beside the log line
 * that reports the same event). Counts only: no ids, no content, no names.
 * Reported by the readiness probe (`realtime`); reset only by a restart.
 */
export const realtimeMetrics = {
  /** Sockets refused at delivery because their identity was no longer live. */
  deliveryRefusedIdentity: 0,
  /** Sockets refused at delivery because they may no longer read the conversation. */
  deliveryRefusedRead: 0,
  /** Decisions voided by a fence (a revocation, a lease gap) and re-decided. */
  deliverySuperseded: 0,
  /** Deliveries superseded on every attempt and dropped (fail closed). */
  deliveryDropped: 0,
  /** Deliveries that failed outright (state unreadable, locks unavailable): nothing emitted. */
  deliveryFailed: 0,
  /** Re-validation passes that could not read state (sockets refused, not trusted). */
  revalidationFailed: 0,
  /** Socket handshakes that failed and were closed. */
  handshakeFailed: 0,
  /** Completion barriers that did not confirm (API revocations and deactivations). */
  barrierUnconfirmed: 0,
  /** Deactivations confirmed by RevocationConfirmer. */
  deactivationsConfirmed: 0,
  /** RT-037: participants taken out of a live call room by a confirmed deactivation. */
  mediaParticipantsRemoved: 0,
  /** RT-037: joins by an identity no longer live, ejected on LiveKit's participant_joined. */
  mediaJoinsRefused: 0,
  /** RT-037: room removals that failed (the deactivation stays unconfirmed and is retried). */
  mediaRemovalFailed: 0,
  /** RT-037: media downloads refused at access time (actor not live, or not allowed to read). */
  mediaDownloadsRefused: 0,
};

export type RealtimeMetrics = typeof realtimeMetrics;

/** A copy, so a reader cannot change the counters. */
export function realtimeMetricsSnapshot(): RealtimeMetrics {
  return { ...realtimeMetrics };
}
