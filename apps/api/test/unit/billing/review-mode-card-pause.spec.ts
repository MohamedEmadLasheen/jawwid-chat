/**
 * OA-12 x W63 (owner, 2026-11-12): the operator's card pause wins in App Review
 * mode too. CheckoutService.open checks the pause before the review-mode demo
 * shortcut, so a paused deployment hands out no card page at all.
 */
import { CheckoutService } from '../../../src/billing/checkout.service';
import { CARD_PAUSED_KEY } from '../../../src/billing/card-pause';
import { REVIEW_ORGANIZATIONS_KEY, reviewDemoUrl } from '../../../src/billing/review-mode';
import { CommError, CommErrorCode } from '../../../src/platform/errors';

const ORG = '6f1d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

function service(config: Record<string, unknown>, checkoutAvailable = false) {
  const prisma = {
    config: { findUnique: jest.fn(async ({ where: { key } }: { where: { key: string } }) => (key in config ? { value: config[key] } : null)) },
    paymentCheckout: new Proxy({}, { get: () => { throw new Error('no checkout row may be read or written'); } }),
  };
  const stripe = new Proxy({ checkoutAvailable }, {
    get: (target, prop) => {
      if (prop === 'checkoutAvailable') return target.checkoutAvailable;
      if (prop === 'then') return undefined;
      throw new Error(`Stripe must not be called (${String(prop)})`);
    },
  });
  const never = new Proxy({}, { get: () => { throw new Error('must not be touched'); } });
  return new CheckoutService(prisma as never, never as never, stripe as never, never as never);
}

const request = { id: 'r-1', organizationId: ORG } as never;
const opts = { locale: 'en' as const, returnUrl: 'https://example.invalid/back' };

describe('OA-12 x W63: the card pause wins in review mode', () => {
  it('review organization, paused: 503 PAYMENTS_UNAVAILABLE, no demo page, no Stripe', async () => {
    const svc = service({ [REVIEW_ORGANIZATIONS_KEY]: [ORG], [CARD_PAUSED_KEY]: true });
    const err = await svc.open(request, opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommError);
    expect((err as CommError).code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
    expect((err as CommError).status).toBe(503);
  });

  it('review organization, not paused: the demo page, still without Stripe', async () => {
    const svc = service({ [REVIEW_ORGANIZATIONS_KEY]: [ORG], [CARD_PAUSED_KEY]: false });
    await expect(svc.open(request, opts)).resolves.toBe(reviewDemoUrl('en'));
  });

  it('a malformed pause value counts as paused, in review mode too', async () => {
    const svc = service({ [REVIEW_ORGANIZATIONS_KEY]: [ORG], [CARD_PAUSED_KEY]: 'yes' });
    await expect(svc.open(request, opts)).rejects.toMatchObject({ code: CommErrorCode.PAYMENTS_UNAVAILABLE });
  });
});
