/**
 * The shared presence/typing Redis client is closed at application shutdown.
 * Before RedisClientShutdown it was a bare factory provider with no lifecycle:
 * its socket outlived app.close() and kept the process alive.
 */
import { RedisClientShutdown } from '@communication/realtime/redis.provider';

function fakeClient(status: string, quit: () => Promise<unknown> = async () => 'OK') {
  return { status, quit: jest.fn(quit), disconnect: jest.fn() };
}

describe('RedisClientShutdown', () => {
  it('quits a connected client', async () => {
    const client = fakeClient('ready');
    await new RedisClientShutdown(client as never).onApplicationShutdown();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('only disconnects a lazy client that never connected (no command is sent)', async () => {
    const client = fakeClient('wait');
    await new RedisClientShutdown(client as never).onApplicationShutdown();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to disconnect when QUIT fails, and never throws from shutdown', async () => {
    const client = fakeClient('reconnecting', async () => {
      throw new Error('connection lost');
    });
    await expect(new RedisClientShutdown(client as never).onApplicationShutdown()).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
