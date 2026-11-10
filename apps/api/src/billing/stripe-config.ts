/**
 * PD-56 (store compliance, production guard) and Stripe M1: card payments in
 * production must be real, and must be recorded. Checked at boot, by the API
 * and the worker, fail-closed with a named cause:
 *
 *   * a TEST key (sk_test_..., rk_test_...) in production is refused -- a parent
 *     would "pay" and no money would move;
 *   * any other key that is not a live secret or restricted key
 *     (sk_live_... / rk_live_...) is refused -- a publishable key (pk_live_...)
 *     or a pasted wrong value can create no Checkout Session and no refund;
 *   * a key with no STRIPE_WEBHOOK_SECRET in production is refused -- Stripe
 *     would take the money and Chat would never record it (a card payment is
 *     recorded only from a verified webhook);
 *   * a STRIPE_WEBHOOK_SECRET that is not a signing secret (whsec_...) is
 *     refused -- every webhook would fail verification and no payment would be
 *     recorded.
 *
 * No key at all stays allowed here: cards are simply off and bank transfers and
 * cash work (PD-27). That is the store-review period (LAUNCH_PHASE=review); the
 * deploy (scripts/infra/check-env.sh) REQUIRES both secrets at
 * LAUNCH_PHASE=launch. Staging and local may use test keys.
 *
 * Messages name the variable, never its value.
 */
const LIVE_KEY = /^(sk|rk)_live_[A-Za-z0-9]+$/;
const TEST_KEY = /^(sk|rk)_test_/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]+$/;

export function assertProductionStripeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.APP_ENV ?? '').trim() !== 'production') return;
  const key = (env.STRIPE_SECRET_KEY ?? '').trim();
  const secret = (env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (secret && !WEBHOOK_SECRET.test(secret)) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not a Stripe webhook signing secret (whsec_...); production refuses to start with it');
  }
  if (!key) return;
  if (TEST_KEY.test(key)) {
    throw new Error('STRIPE_SECRET_KEY is a Stripe TEST key; production refuses to start with one (no money would move)');
  }
  if (!LIVE_KEY.test(key)) {
    throw new Error(
      'STRIPE_SECRET_KEY is not a Stripe live secret or restricted key (sk_live_... or rk_live_...); production refuses to start with it',
    );
  }
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is missing; production refuses to take card payments it could never record');
  }
}
