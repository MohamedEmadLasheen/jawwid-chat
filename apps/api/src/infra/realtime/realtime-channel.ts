/**
 * The Redis channel the worker publishes realtime events onto, and that every
 * API instance relays into its own Socket.IO server. Owner: AI #7.
 *
 * Why a channel of our own rather than the Socket.IO Redis adapter's:
 * the adapter's wire protocol is internal to socket.io and emitting into it
 * requires either a Socket.IO server (which the worker must not fake) or the
 * separate @socket.io/redis-emitter package. A named channel of our own is
 * explicit, needs no new dependency, and -- the part that matters -- lets the
 * publisher observe how many API instances actually received the event, which
 * the emitter package cannot tell us.
 */
export function realtimeChannel(env: NodeJS.ProcessEnv = process.env): string {
  // Namespaced exactly like BullMQ keys are, and for the same reason: Redis
  // pub/sub is global to the SERVER, not to the selected database, so two
  // environments sharing one Redis would deliver each other's realtime events.
  // Selecting a different database index does NOT isolate pub/sub -- a fact
  // worth stating, because it looks like it should.
  return `${env.QUEUE_PREFIX ?? 'jawwid'}:realtime:v1`;
}

/** Convenience for call sites that do not re-read the environment. */
export const REALTIME_CHANNEL = realtimeChannel();

/** What travels on the channel. Deliberately flat and JSON-safe. */
export interface RealtimeEnvelope {
  /** `room` addresses a conversation; `users` addresses actor rooms. */
  readonly target: 'room' | 'users';
  /** A conversation id, or the list of actor ids. */
  readonly ids: string[];
  readonly event: string;
  readonly payload: unknown;
}

export function encodeEnvelope(e: RealtimeEnvelope): string {
  return JSON.stringify(e);
}

export function decodeEnvelope(raw: string): RealtimeEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as RealtimeEnvelope;
    if (parsed && (parsed.target === 'room' || parsed.target === 'users') && Array.isArray(parsed.ids)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
