/**
 * PD-37: TypingService decides when "started" is worth broadcasting -- in
 * Redis alone, before the gateway authorizes anything:
 *   - the first ping announces; repeats inside the TTL do not...
 *   - ...except once every 5 s while typing goes on, so a long burst keeps
 *     the indicator alive on clients that drop what they have not heard of;
 *   - stop-then-start toggling cannot announce more than once per 3 s.
 */
import { TypingService } from '@communication/realtime/typing.service';

/** Just enough Redis: SET with EX/NX, EXPIRE, DEL -- on a clock the test moves. */
class FakeRedis {
  now = 0;
  private store = new Map<string, number>(); // key -> expiry (ms)
  private live(key: string) {
    const exp = this.store.get(key);
    if (exp !== undefined && exp <= this.now) this.store.delete(key);
    return this.store.has(key);
  }
  async set(key: string, _v: string, ex: 'EX', seconds: number, nx?: 'NX') {
    if (nx === 'NX' && this.live(key)) return null;
    this.store.set(key, this.now + seconds * 1000);
    return 'OK';
  }
  async expire(key: string, seconds: number) {
    if (!this.live(key)) return 0;
    this.store.set(key, this.now + seconds * 1000);
    return 1;
  }
  async del(key: string) {
    const had = this.live(key);
    this.store.delete(key);
    return had ? 1 : 0;
  }
}

function service() {
  const redis = new FakeRedis();
  const config = { get: async () => 8 } as never; // realtime.typing_ttl_seconds
  return { redis, typing: new TypingService(redis as never, config) };
}

describe('PD-37 TypingService', () => {
  it('announces the first ping, not the repeats -- then again every 5 s while typing continues', async () => {
    const { redis, typing } = service();
    expect(await typing.start('c', 'u')).toBe(true);
    for (const t of [1000, 2000, 3000, 4000]) {
      redis.now = t;
      expect(await typing.start('c', 'u')).toBe(false);
    }
    redis.now = 5001;
    expect(await typing.start('c', 'u')).toBe(true); // still typing: say so again
    redis.now = 6000;
    expect(await typing.start('c', 'u')).toBe(false);
  });

  it('stop-then-start toggling announces at most once per 3 s', async () => {
    const { redis, typing } = service();
    expect(await typing.start('c', 'u')).toBe(true);
    expect(await typing.stop('c', 'u')).toBe(true);
    redis.now = 1000;
    expect(await typing.start('c', 'u')).toBe(false); // inside the floor
    redis.now = 3001;
    expect(await typing.start('c', 'u')).toBe(true);
  });

  it('a stop is reported only for a start that was announced', async () => {
    const { typing } = service();
    expect(await typing.stop('c', 'u')).toBe(false);
    await typing.start('c', 'u');
    expect(await typing.stop('c', 'u')).toBe(true);
    expect(await typing.stop('c', 'u')).toBe(false);
  });
});
