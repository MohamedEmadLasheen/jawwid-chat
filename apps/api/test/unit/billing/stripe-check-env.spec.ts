/**
 * Stripe M1, deploy time: scripts/infra/check-env.sh production applies the
 * boot rules of src/billing/stripe-config.ts before anything is changed, and at
 * LAUNCH_PHASE=launch REQUIRES both Stripe secrets (the public launch takes card
 * payments). In the store-review period (LAUNCH_PHASE=review) they stay
 * optional, so the first production deploy is not blocked by Stripe.
 *
 * Every case starts from a production configuration that passes on its own
 * (built from infra/env/manifest.tsv), so a pass or a refusal is caused by the
 * Stripe values alone. The script never prints a value; neither may a refusal.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');
const SCRIPT = path.join(ROOT, 'scripts/infra/check-env.sh');
const MANIFEST = path.join(ROOT, 'infra/env/manifest.tsv');

/** Every variable production requires, set to a neutral value; the structural rules satisfied. */
function baseProductionEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(MANIFEST, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [name, , , , , prod] = line.split('\t');
    if (prod === 'req') env[name] = 'configured-value';
  }
  return { ...env, NODE_ENV: 'production', APP_ENV: 'production', APNS_PRODUCTION: 'true' };
}

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-check-env-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function checkEnv(extra: Record<string, string>) {
  const file = path.join(dir, `production-${++n}.env`);
  const env = { ...baseProductionEnv(), ...extra };
  fs.writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  const r = spawnSync('bash', [SCRIPT, 'production', '--file', file], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const LIVE = { STRIPE_SECRET_KEY: 'rk_live_AbC123', STRIPE_WEBHOOK_SECRET: 'whsec_AbC123' };

describe('check-env.sh production: Stripe', () => {
  it('the base production configuration passes (the cases below change only Stripe)', () => {
    const r = checkEnv({ LAUNCH_PHASE: 'review' });
    expect(r.out).toContain('environment validation passed');
    expect(r.status).toBe(0);
  });

  it('review phase without Stripe: allowed (cards off), the first deploy is not blocked', () => {
    const r = checkEnv({ LAUNCH_PHASE: 'review' });
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/(MISSING|FORBIDDEN).*STRIPE_/);
  });

  it('launch phase without Stripe: refused, and both missing secrets are named', () => {
    const r = checkEnv({ LAUNCH_PHASE: 'launch' });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/MISSING\s+STRIPE_SECRET_KEY/);
    expect(r.out).toMatch(/MISSING\s+STRIPE_WEBHOOK_SECRET/);
    expect(r.out).toContain('environment validation FAILED');
  });

  it('launch phase with only one of the two secrets: refused', () => {
    expect(checkEnv({ LAUNCH_PHASE: 'launch', STRIPE_SECRET_KEY: LIVE.STRIPE_SECRET_KEY }).out).toMatch(/MISSING\s+STRIPE_WEBHOOK_SECRET/);
    expect(checkEnv({ LAUNCH_PHASE: 'launch', STRIPE_WEBHOOK_SECRET: LIVE.STRIPE_WEBHOOK_SECRET }).out).toMatch(/MISSING\s+STRIPE_SECRET_KEY/);
  });

  it.each(['review', 'launch'])('%s phase with a live key and its webhook secret: passes', (LAUNCH_PHASE) => {
    for (const key of ['rk_live_AbC123', 'sk_live_AbC123']) {
      const r = checkEnv({ LAUNCH_PHASE, ...LIVE, STRIPE_SECRET_KEY: key });
      expect(r.out).not.toMatch(/(MISSING|FORBIDDEN).*STRIPE_/);
      expect(r.status).toBe(0);
    }
  });

  it.each([
    ['sk_test_AbC123', /FORBIDDEN\s+STRIPE_SECRET_KEY is a Stripe TEST key/],
    ['rk_test_AbC123', /FORBIDDEN\s+STRIPE_SECRET_KEY is a Stripe TEST key/],
    ['pk_live_AbC123', /FORBIDDEN\s+STRIPE_SECRET_KEY is not a live secret or restricted key/],
    ['sk_live_', /FORBIDDEN\s+STRIPE_SECRET_KEY is not a live secret or restricted key/],
    ['sk_live_AbC-123', /FORBIDDEN\s+STRIPE_SECRET_KEY is not a live secret or restricted key/],
    ['garbage', /FORBIDDEN\s+STRIPE_SECRET_KEY is not a live secret or restricted key/],
  ])('a malformed key %p is refused in either phase', (key, message) => {
    for (const LAUNCH_PHASE of ['review', 'launch']) {
      const r = checkEnv({ LAUNCH_PHASE, ...LIVE, STRIPE_SECRET_KEY: key });
      expect(r.status).toBe(1);
      expect(r.out).toMatch(message);
    }
  });

  it.each(['whsec_', 'whsec_AbC-123', 'sk_live_AbC123', 'not-a-secret'])(
    'a malformed webhook secret %p is refused in either phase',
    (secret) => {
      for (const LAUNCH_PHASE of ['review', 'launch']) {
        const r = checkEnv({ LAUNCH_PHASE, ...LIVE, STRIPE_WEBHOOK_SECRET: secret });
        expect(r.status).toBe(1);
        expect(r.out).toMatch(/FORBIDDEN\s+STRIPE_WEBHOOK_SECRET is not a webhook signing secret/);
      }
    },
  );

  it('review phase, a key without its webhook secret: still refused', () => {
    const r = checkEnv({ LAUNCH_PHASE: 'review', STRIPE_SECRET_KEY: LIVE.STRIPE_SECRET_KEY });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/STRIPE_WEBHOOK_SECRET is missing/);
  });

  it('never echoes a Stripe value, refused or accepted', () => {
    const cases: Record<string, string>[] = [
      { LAUNCH_PHASE: 'launch', STRIPE_SECRET_KEY: 'pk_live_MARKERone1', STRIPE_WEBHOOK_SECRET: 'whsec_MARKER-two2' },
      { LAUNCH_PHASE: 'review', STRIPE_SECRET_KEY: 'sk_test_MARKERone1', STRIPE_WEBHOOK_SECRET: 'whsec_MARKERtwo2' },
      { LAUNCH_PHASE: 'launch', STRIPE_SECRET_KEY: 'rk_live_MARKERone1', STRIPE_WEBHOOK_SECRET: 'whsec_MARKERtwo2' },
    ];
    for (const extra of cases) {
      const r = checkEnv(extra);
      expect(r.out).not.toContain('MARKER');
    }
  });
});
