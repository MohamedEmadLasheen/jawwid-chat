/**
 * PHASE 5 CLOSURE -- the token this API mints is accepted by a REAL LiveKit.
 *
 * Every other calling test asserts our own behaviour against our own
 * assumptions about LiveKit's token format. That is exactly the class of
 * assumption that is wrong silently: a token this repository considers
 * perfectly formed, refused by the server, fails as a connection timeout on a
 * parent's phone and as nothing at all in CI.
 *
 * So this presents a real, freshly minted token to a real LiveKit server's
 * validation endpoint. It SKIPS when no server is reachable -- most developers
 * and CI have none -- and the skip is loud rather than a silent pass.
 *
 *   docker run -d --name jawwid-lk -p 7880:7880 \
 *     -v "$PWD/infra/livekit/livekit.yaml:/etc/livekit.yaml:ro" \
 *     livekit/livekit-server:v1.8 --config /etc/livekit.yaml
 *
 * or `docker compose up -d livekit`, which uses the same config file.
 */
import { LiveKitTokenIssuer } from '@communication/calls/media-token';
import { PrismaService } from '@platform/prisma.service';
import { AppConfigService } from '@platform/app-config.service';

const LIVEKIT_HTTP = process.env.LIVEKIT_TEST_URL ?? 'http://localhost:7880';

/** The development key pair in infra/livekit/livekit.yaml and .env.example. */
const DEV_KEY = 'devkey';
const DEV_SECRET = 'devsecret-local-only';

async function livekitReachable(): Promise<boolean> {
  try {
    const response = await fetch(LIVEKIT_HTTP, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let reachable = false;

/**
 * Whether an unreachable server is a skip or a failure.
 *
 * The skip below was described as "loud", and it is not: each test does
 * `if (!reachable) return`, so Jest prints a green tick either way and the run
 * with no server is INDISTINGUISHABLE from the run that actually validated a
 * token against LiveKit 1.8.4. A console.warn scrolls past; a tick is what gets
 * believed. That is the same "green while doing nothing" shape Phase 8 removed
 * from the mobile CI job.
 *
 * Making it fail unconditionally would be wrong -- most developers have no
 * LiveKit, and a suite that fails on every laptop gets deleted. So the choice is
 * explicit instead: set JAWWID_REQUIRE_LIVEKIT=1 wherever the verification is
 * meant to be real (a release gate that starts the server first), and absence
 * becomes a failure rather than a silent pass.
 */
const REQUIRED = process.env.JAWWID_REQUIRE_LIVEKIT === '1';

beforeAll(async () => {
  reachable = await livekitReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      `SKIPPING the LiveKit contract suite: no server at ${LIVEKIT_HTTP}. ` +
        'Start one with `docker compose up -d livekit`.',
    );
  }
});

describe('the contract suite must actually have run', () => {
  it('reached a real LiveKit server, or is explicitly allowed not to', () => {
    if (REQUIRED) {
      // The assertion carries the remedy: a failure here means the server was
      // not started, not that the token format is wrong.
      expect(
        reachable
          ? 'reached LiveKit'
          : `JAWWID_REQUIRE_LIVEKIT=1 but no server at ${LIVEKIT_HTTP} -- start one with \`docker compose up -d livekit\``,
      ).toBe('reached LiveKit');
    }
    // Not required: record which of the two runs this was, so the log says
    // whether the ticks below mean anything.
    // eslint-disable-next-line no-console
    console.log(
      reachable
        ? 'LiveKit contract: VERIFIED against a real server'
        : 'LiveKit contract: NOT VERIFIED (no server) -- the passes below assert nothing',
    );
  });
});

function issuer(): LiveKitTokenIssuer {
  process.env.LIVEKIT_API_KEY = DEV_KEY;
  process.env.LIVEKIT_API_SECRET = DEV_SECRET;
  process.env.LIVEKIT_URL = 'ws://localhost:7880';
  // Read at construction, so the issuer is built after the environment is set.
  return new LiveKitTokenIssuer();
}

/** LiveKit's own token validation endpoint. */
async function validate(token: string): Promise<number> {
  const response = await fetch(`${LIVEKIT_HTTP}/rtc/validate?access_token=${token}`);
  return response.status;
}

describe('the media token TTL has ONE source', () => {
  /**
   * The acceptance audit found the closure pass's environment-variable
   * fallback was UNREACHABLE: `AppConfigService.get` returns the stored row, or
   * its own compile-time default when there is no row, so it always yields a
   * finite number and nothing below it could ever run. An operator setting
   * LIVEKIT_TOKEN_TTL_SECONDS=999 still got 120.
   *
   * This locks the resolution: the config ROW decides, and an environment
   * variable does not silently become a second source of truth for the same
   * threshold. If somebody reintroduces a fallback, the first case fails.
   */
  it('is the config row, and the environment cannot override it', async () => {
    const prisma = new PrismaService();
    const config = new AppConfigService(prisma);
    try {
      process.env.LIVEKIT_TOKEN_TTL_SECONDS = '999';

      const resolved = await config.get('call.token_ttl_seconds');
      const row = await prisma.config.findUnique({
        where: { key: 'call.token_ttl_seconds' },
      });

      // The row is what applies...
      expect(row).not.toBeNull();
      expect(resolved).toBe(Number(row!.value));
      // ...and the environment variable is not consulted at all.
      expect(resolved).not.toBe(999);
    } finally {
      delete process.env.LIVEKIT_TOKEN_TTL_SECONDS;
      await prisma.$disconnect();
    }
  });
});

describe('the LiveKit deployment contract', () => {
  it('a token this API mints is ACCEPTED by a real LiveKit server', async () => {
    if (!reachable) return;

    const grant = await issuer().issue({
      roomName: 'jawwid-contract-room',
      identity: 'actor-under-test',
      name: 'admin_a',
      canPublish: true,
      ttlSeconds: 120,
    });

    expect(await validate(grant.token)).toBe(200);
  });

  it('a token signed with the WRONG secret is refused', async () => {
    if (!reachable) return;

    process.env.LIVEKIT_API_KEY = DEV_KEY;
    process.env.LIVEKIT_API_SECRET = 'a-different-secret-entirely-0123456789';
    const forged = await new LiveKitTokenIssuer().issue({
      roomName: 'jawwid-contract-room',
      identity: 'actor-under-test',
      name: 'admin_a',
      canPublish: true,
      ttlSeconds: 120,
    });

    // If this ever returned 200, the signature would be decorative.
    expect(await validate(forged.token)).toBe(401);
  });

  it('an EXPIRED token is refused', async () => {
    if (!reachable) return;

    // The whole reason the TTL is short: a leaked token stops working. If the
    // server ignored `exp`, that property would be imaginary.
    const grant = await issuer().issue({
      roomName: 'jawwid-contract-room',
      identity: 'actor-under-test',
      name: 'admin_a',
      canPublish: true,
      ttlSeconds: -60,
    });

    expect(await validate(grant.token)).toBe(401);
  });

  it('the token names exactly one room, and cannot create or list others', async () => {
    if (!reachable) return;

    const grant = await issuer().issue({
      roomName: 'jawwid-contract-room',
      identity: 'actor-under-test',
      name: 'admin_a',
      canPublish: false,
      ttlSeconds: 120,
    });

    const claims = JSON.parse(
      Buffer.from(grant.token.split('.')[1], 'base64').toString('utf8'),
    );
    // The room is inside the SIGNED payload, so a client cannot replay the
    // token into a different room.
    expect(claims.video.room).toBe('jawwid-contract-room');
    expect(claims.video.roomCreate).toBe(false);
    expect(claims.video.roomList).toBe(false);
    // A silenced member may listen and not speak.
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canSubscribe).toBe(true);

    expect(await validate(grant.token)).toBe(200);
  });
});
