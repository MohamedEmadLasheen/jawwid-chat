import { assertProductionStripeConfig } from '../../../src/billing/stripe-config';

/** PD-56: production refuses a Stripe test key, and a key without the webhook secret. */
describe('assertProductionStripeConfig', () => {
  const prod = (extra: Record<string, string>) => ({ APP_ENV: 'production', ...extra }) as NodeJS.ProcessEnv;

  it.each(['sk_test_abc', 'rk_test_abc', '  sk_test_padded  '])('refuses the test key %p in production', (key) => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: 'whsec_x' }))).toThrow(/TEST key/);
  });

  it('refuses a live key without the webhook secret in production', () => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: 'sk_live_abc' }))).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: 'rk_live_abc', STRIPE_WEBHOOK_SECRET: '  ' }))).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('accepts a live key with its webhook secret, and no key at all (cards off)', () => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_x' }))).not.toThrow();
    expect(() => assertProductionStripeConfig(prod({}))).not.toThrow();
  });

  it('staging and local may use test keys', () => {
    for (const APP_ENV of ['staging', 'local', 'test', '']) {
      expect(() => assertProductionStripeConfig({ APP_ENV, STRIPE_SECRET_KEY: 'sk_test_abc' } as NodeJS.ProcessEnv)).not.toThrow();
    }
  });
});
