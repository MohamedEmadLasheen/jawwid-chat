import { assertProductionStripeConfig } from '../../../src/billing/stripe-config';

/**
 * PD-56 / Stripe M1: production boots only with no Stripe key at all (cards
 * off), or with a LIVE secret or restricted key AND a well-formed webhook
 * signing secret. Error messages name the variable, never its value.
 */
describe('assertProductionStripeConfig', () => {
  const prod = (extra: Record<string, string>) => ({ APP_ENV: 'production', ...extra }) as NodeJS.ProcessEnv;
  const WHSEC = 'whsec_AbC123xyz';

  it.each(['sk_test_abc', 'rk_test_abc', '  sk_test_padded  '])('refuses the test key %p in production', (key) => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WHSEC }))).toThrow(/TEST key/);
  });

  it.each([
    'pk_live_abc123', // a publishable key: it cannot create a Checkout Session or a refund
    'pk_test_abc123',
    'sk_live_', // a prefix with nothing after it
    'sk_live_abc-123', // characters a Stripe key never has
    'sk_live_abc 123',
    'whsec_abc123', // the two secrets swapped
    'garbage',
    'SK_LIVE_abc123',
  ])('refuses the non-live key %p in production', (key) => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WHSEC }))).toThrow(
      /STRIPE_SECRET_KEY is not a Stripe live secret or restricted key/,
    );
  });

  it('refuses a live key without the webhook secret in production', () => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: 'sk_live_abc' }))).toThrow(/STRIPE_WEBHOOK_SECRET is missing/);
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: 'rk_live_abc', STRIPE_WEBHOOK_SECRET: '  ' }))).toThrow(
      /STRIPE_WEBHOOK_SECRET is missing/,
    );
  });

  it.each(['whsec_', 'whsec_abc-123', 'sk_live_abc123', 'abc123', 'WHSEC_abc'])(
    'refuses the malformed webhook secret %p in production',
    (secret) => {
      expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: secret }))).toThrow(
        /STRIPE_WEBHOOK_SECRET is not a Stripe webhook signing secret/,
      );
    },
  );

  it('refuses a malformed webhook secret even with no key', () => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_WEBHOOK_SECRET: 'not-a-secret' }))).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it.each(['sk_live_abc123', 'rk_live_AbC123', '  rk_live_padded  '])('accepts the live key %p with its webhook secret', (key) => {
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WHSEC }))).not.toThrow();
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: ` ${WHSEC}\n` }))).not.toThrow();
  });

  it('accepts no Stripe configuration at all in production (review phase: cards off)', () => {
    expect(() => assertProductionStripeConfig(prod({}))).not.toThrow();
    expect(() => assertProductionStripeConfig(prod({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }))).not.toThrow();
  });

  it('never puts a value in the error message', () => {
    const cases: Record<string, string>[] = [
      { STRIPE_SECRET_KEY: 'pk_live_SECRETVALUE1', STRIPE_WEBHOOK_SECRET: WHSEC },
      { STRIPE_SECRET_KEY: 'sk_test_SECRETVALUE1', STRIPE_WEBHOOK_SECRET: WHSEC },
      { STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE1', STRIPE_WEBHOOK_SECRET: 'whsec_SECRET-VALUE2' },
    ];
    for (const extra of cases) {
      let message = '';
      try {
        assertProductionStripeConfig(prod(extra));
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain('SECRETVALUE1');
      expect(message).not.toContain('SECRET-VALUE2');
    }
  });

  it('staging and local may use test keys', () => {
    for (const APP_ENV of ['staging', 'local', 'test', '']) {
      expect(() => assertProductionStripeConfig({ APP_ENV, STRIPE_SECRET_KEY: 'sk_test_abc' } as NodeJS.ProcessEnv)).not.toThrow();
    }
  });
});
