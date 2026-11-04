/**
 * PD-56 (store compliance, production guard): card payments in production must
 * be real, and must be recorded. Checked at boot, by the API and the worker,
 * fail-closed with a named cause:
 *
 *   * a TEST key (sk_test_..., rk_test_...) in production is refused -- a parent
 *     would "pay" and no money would move;
 *   * a key with no STRIPE_WEBHOOK_SECRET in production is refused -- Stripe
 *     would take the money and Chat would never record it (a card payment is
 *     recorded only from a verified webhook).
 *
 * No key at all stays allowed: cards are simply off and bank transfers and cash
 * work (PD-27). Staging and local may use test keys.
 */
export function assertProductionStripeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.APP_ENV ?? '').trim() !== 'production') return;
  const key = (env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) return;
  if (/^(sk|rk)_test_/.test(key)) {
    throw new Error('STRIPE_SECRET_KEY is a Stripe TEST key; production refuses to start with one (no money would move)');
  }
  if (!(env.STRIPE_WEBHOOK_SECRET ?? '').trim()) {
    throw new Error('STRIPE_WEBHOOK_SECRET is missing; production refuses to take card payments it could never record');
  }
}
