import { LiveKitTokenIssuer } from '../../../src/communication/calls/media-token';

/**
 * LR-32: in production the media URL handed to the client must be wss://.
 * A ws:// URL would carry media signalling, and the token itself, unencrypted.
 * Outside production ws:// stays allowed, because local stacks run LiveKit
 * without TLS.
 *
 * The issuer reads its environment when it is constructed, so each case sets
 * the variables first and builds a fresh one.
 */
const grant = { roomName: 'r', identity: 'i', name: 'n', canPublish: true, ttlSeconds: 60 };

const ENV_KEYS = ['APP_ENV', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
let saved: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof saved;
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-characters-long';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const issuerWith = (appEnv: string | undefined, url: string) => {
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  process.env.LIVEKIT_URL = url;
  return new LiveKitTokenIssuer();
};

describe('LR-32: LIVEKIT_URL scheme by environment', () => {
  it.each(['production', ' production ', 'PRODUCTION'])(
    'APP_ENV=%p refuses a ws:// URL with a configuration error',
    async (appEnv) => {
      const url = 'ws://livekit.example.internal:7880';
      const issued = issuerWith(appEnv, url).issue(grant);
      await expect(issued).rejects.toThrow(/LIVEKIT_URL must use wss:\/\/ when APP_ENV=production/);
      // NAMES ONLY: a misconfiguration error never quotes the value.
      await expect(issued).rejects.not.toThrow(/livekit\.example\.internal/);
    },
  );

  it('APP_ENV=production accepts a wss:// URL', async () => {
    const url = 'wss://livekit.example.com';
    await expect(issuerWith('production', url).issue(grant)).resolves.toMatchObject({ url });
  });

  it.each([undefined, '', 'local', 'test', 'ci', 'staging'])(
    'APP_ENV=%p still allows ws:// (local stacks run LiveKit without TLS)',
    async (appEnv) => {
      const url = 'ws://localhost:7880';
      await expect(issuerWith(appEnv, url).issue(grant)).resolves.toMatchObject({ url });
    },
  );

  it('production does not loosen the existing check: https:// is still refused', async () => {
    await expect(issuerWith('production', 'https://livekit.example.com').issue(grant)).rejects.toThrow(
      /LIVEKIT_URL must be a WebSocket URL/,
    );
  });
});
