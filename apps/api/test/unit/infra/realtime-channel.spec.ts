/**
 * The worker -> Redis -> API relay envelope (infra/realtime/realtime-channel.ts).
 *
 * PD-57 (found by test/e2e/pd057-lifecycle.e2e.ts against the real API and
 * worker): a `room-audience` delivery whose audience is ONLY `perActor` -- the
 * whole room, with a payload of its own for some people (the blocker's copy of
 * a blocked author's message, marked hiddenByBlock) -- was discarded as "no
 * usable audience", so after any block nobody in the room received that
 * person's message.created live. perActor never widens who receives the event
 * (the room, as a plain `room` delivery); it only replaces the payload for the
 * people it names, so it is a usable audience on its own.
 */
import { CommEvent } from '../../../src/communication/contracts/events';
import { decodeEnvelope, encodeEnvelope } from '../../../src/infra/realtime/realtime-channel';

const base = { target: 'room-audience' as const, ids: ['c1'], event: CommEvent.MESSAGE_CREATED, payload: { messageId: 'm1' } };

describe('decodeEnvelope: room-audience', () => {
  it('a perActor-only audience is usable and arrives intact', () => {
    const audience = { perActor: { blocker: { messageId: 'm1', hiddenByBlock: true } } };
    expect(decodeEnvelope(encodeEnvelope({ ...base, audience }))).toEqual({ ...base, audience });
  });

  it('still refuses an audience that names nothing usable, and a malformed perActor', () => {
    expect(decodeEnvelope(JSON.stringify(base))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: {} }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: { perActor: null } }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: { perActor: ['x'] } }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: { perActor: 'x' } }))).toBeNull();
  });

  it('the existing usable audiences are unchanged', () => {
    for (const audience of [{ onlyActors: ['a'] }, { countableOnly: true }, { exceptActors: ['a'] }, { onlyActors: ['a'], perActor: { a: {} } }]) {
      expect(decodeEnvelope(JSON.stringify({ ...base, audience }))?.audience).toEqual(audience);
    }
  });
});
