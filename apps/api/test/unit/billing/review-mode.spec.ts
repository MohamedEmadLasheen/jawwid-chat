/**
 * OA-12 (owner, 2026-11-10): the App Review payment mode's pure rules. The
 * database- and HTTP-backed proofs are in
 * test/integration/review-payment-mode.spec.ts.
 */
import { CommError, CommErrorCode } from '../../../src/platform/errors';
import { renderPayPage, type PayPageModel } from '../../../src/billing/pay-page';
import {
  REVIEW_DEMO_REQUEST_ID,
  REVIEW_ORGANIZATIONS_KEY,
  inReviewMode,
  isReviewOrganization,
  parseReviewOrganizationIds,
  readReviewOrganizationIds,
  refuseReviewOrganizationStaff,
  renderReviewDemoPage,
  reviewDemoBankAccount,
  reviewDemoRequest,
  reviewModeRefusal,
} from '../../../src/billing/review-mode';

const ORG = '6f1d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const OTHER = '0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';

const configWith = (value: unknown) => ({
  config: { findUnique: jest.fn(async () => (value === undefined ? null : { value })) },
});

describe('isReviewOrganization (pure)', () => {
  it('true only for an organization the array lists, in any case', () => {
    expect(isReviewOrganization(ORG, [ORG])).toBe(true);
    expect(isReviewOrganization(ORG.toUpperCase(), [ORG])).toBe(true);
    expect(isReviewOrganization(ORG, [ORG.toUpperCase()])).toBe(true);
    expect(isReviewOrganization(OTHER, [ORG])).toBe(false);
    expect(isReviewOrganization(ORG, [])).toBe(false);
  });

  it('absent, null or malformed is public behaviour (false)', () => {
    for (const bad of [undefined, null, ORG, { ids: [ORG] }, [ORG, 'not-a-uuid'], [ORG, 7], [[ORG]], 'true', 1]) {
      expect([bad, isReviewOrganization(ORG, bad)]).toEqual([bad, false]);
    }
    expect(isReviewOrganization(null, [ORG])).toBe(false);
    expect(isReviewOrganization(undefined, [ORG])).toBe(false);
    expect(isReviewOrganization('', [ORG])).toBe(false);
  });

  it('parse: a whole array of uuids, or nothing', () => {
    expect(parseReviewOrganizationIds([ORG, OTHER])).toEqual(new Set([ORG, OTHER]));
    expect(parseReviewOrganizationIds([])).toEqual(new Set());
    expect(parseReviewOrganizationIds([ORG, 'x'])).toBeNull();
    expect(parseReviewOrganizationIds({})).toBeNull();
  });
});

describe('reading chat.config', () => {
  it('reads the one documented key', async () => {
    const db = configWith([ORG]);
    expect(await inReviewMode(db, ORG)).toBe(true);
    expect(db.config.findUnique).toHaveBeenCalledWith({ where: { key: REVIEW_ORGANIZATIONS_KEY } });
    expect(REVIEW_ORGANIZATIONS_KEY).toBe('review.sandbox_organization_ids');
  });

  it('absent: nobody, and nothing logged', async () => {
    expect(await readReviewOrganizationIds(configWith(undefined))).toEqual(new Set());
    expect(await inReviewMode(configWith(undefined), ORG)).toBe(false);
  });

  it('malformed: nobody (public behaviour)', async () => {
    expect(await inReviewMode(configWith({ ids: [ORG] }), ORG)).toBe(false);
    expect(await inReviewMode(configWith([ORG, 'nope']), ORG)).toBe(false);
  });

  it('a failed read propagates (the request fails), never public behaviour', async () => {
    const reset = new Error('connection reset');
    const broken = { config: { findUnique: jest.fn(async () => { throw reset; }) } };
    await expect(readReviewOrganizationIds(broken)).rejects.toBe(reset);
    await expect(inReviewMode(broken, ORG)).rejects.toBe(reset);
    await expect(refuseReviewOrganizationStaff(broken, ORG)).rejects.toBe(reset);
  });

  it('no organization id: never review mode, and no read', async () => {
    const db = configWith([ORG]);
    expect(await inReviewMode(db, null)).toBe(false);
    expect(db.config.findUnique).not.toHaveBeenCalled();
  });
});

describe('what a review account is shown', () => {
  it('the bank details are plainly a demo, in both languages, and name no real account', () => {
    const en = reviewDemoBankAccount('en');
    expect(en.accountName).toBe('Demo bank details for App Review: no transfer is possible');
    expect(en.iban).toBeNull();
    expect(en.swift).toBeNull();
    expect(en.accountNumber).toMatch(/^DEMO-/);
    const ar = reviewDemoBankAccount('ar');
    expect(ar.accountName).toContain('تجريبية');
    expect(ar.iban).toBeNull();
  });

  it('the synthetic amount due: a lesson package, open, payable in the app, under the fixed id', () => {
    const now = new Date('2026-11-10T09:00:00Z');
    const r = reviewDemoRequest('en', { id: 'child-1', name: 'Yahya Adel' }, now);
    expect(r).toMatchObject({
      id: REVIEW_DEMO_REQUEST_ID,
      purpose: 'subscription',
      payableInApp: true,
      status: 'open',
      label: 'Lesson package (demo): 8 live one-to-one lessons',
      amountMinor: 8000,
      remainingMinor: 8000,
      paidMinor: 0,
      currency: 'USD',
      lessonsIncluded: 8,
      planMonths: 1,
      child: { id: 'child-1', name: 'Yahya Adel' },
      lastCardFailure: null,
    });
    expect(Date.parse(r.expiresAt)).toBeGreaterThan(now.getTime());
    expect(reviewDemoRequest('ar', null, now).label).toContain('تجريبية');
  });

  it('the refusal: 403, the billing code, and a machine-readable reviewMode flag', () => {
    const e = reviewModeRefusal();
    expect(e.code).toBe(CommErrorCode.BILLING_DENIED);
    expect(e.status).toBe(403);
    expect(e.detail).toEqual({ reviewMode: true });
  });

  it('the demo page: both languages, the requested one first, no script, no form, no link out', () => {
    const en = renderReviewDemoPage('en', 'n0nce');
    expect(en).toContain("In the live app this opens Stripe's secure checkout page in the browser to pay this lesson package by card. The review account cannot make a payment.");
    expect(en).toContain('لا يمكن لحساب المراجعة إجراء أي دفع.');
    expect(en.indexOf('lang="en" dir="ltr"')).toBeLessThan(en.indexOf('lang="ar" dir="rtl"'));
    const ar = renderReviewDemoPage('ar', 'n0nce');
    expect(ar.indexOf('<section class="card" lang="ar"')).toBeLessThan(ar.indexOf('<section class="card" lang="en"'));
    for (const page of [en, ar]) {
      expect(page).toContain('<style nonce="n0nce">');
      expect(page).not.toMatch(/<script|<form|<a\s|href=|https?:\/\//i);
    }
  });
});

describe('the staff guard', () => {
  it('refuses an actor of a review organization with the review refusal', async () => {
    const err = await refuseReviewOrganizationStaff(configWith([ORG]), ORG.toUpperCase()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommError);
    expect(err).toMatchObject({ code: CommErrorCode.BILLING_DENIED, status: 403, detail: { reviewMode: true } });
  });

  it('lets every other organization through: another listed, absent, malformed, no organization', async () => {
    for (const value of [[OTHER], [], undefined, { ids: [ORG] }, [ORG, 'nope']]) {
      await expect(refuseReviewOrganizationStaff(configWith(value), ORG)).resolves.toBeUndefined();
    }
    await expect(refuseReviewOrganizationStaff(configWith([ORG]), null)).resolves.toBeUndefined();
  });
});

describe('the /pay page bank block', () => {
  const model = (over: Partial<PayPageModel> = {}): PayPageModel => ({
    status: 'open', payerName: 'Family', childFirstName: 'Adam', label: 'Lesson package', purpose: 'subscription',
    planMonths: 1, periodStart: null, periodEnd: null, amountMinor: 8000, paidMinor: 0, remainingMinor: 8000,
    currency: 'USD', expiresAt: '2026-12-01T00:00:00.000Z', bankAccount: null, cardAvailable: true, checkout: null, error: null, ...over,
  });
  const ctx = { token: 'T'.repeat(43), nonce: 'n0nce' };
  const EN_RECEIPT = 'After transferring, send a photo of the receipt';
  const AR_RECEIPT = 'بعد التحويل أرسل صورة الإيصال';

  it('review mode: the demo details, and no "send the receipt" instruction (no receipt can be sent)', () => {
    const en = renderPayPage(model({ bankAccount: reviewDemoBankAccount('en'), reviewMode: true }), 'en', ctx);
    expect(en).toContain('Demo bank details for App Review: no transfer is possible');
    expect(en).not.toContain(EN_RECEIPT);
    const ar = renderPayPage(model({ bankAccount: reviewDemoBankAccount('ar'), reviewMode: true }), 'ar', ctx);
    expect(ar).toContain('لا يمكن إرسال إيصال');
    expect(ar).not.toContain(AR_RECEIPT);
  });

  it('public: the instruction is still there', () => {
    const bank = { bankName: 'Bank', accountName: 'Academy', iban: 'AE070331234567890123456', accountNumber: null, swift: null, note: null };
    expect(renderPayPage(model({ bankAccount: bank }), 'en', ctx)).toContain(EN_RECEIPT);
    expect(renderPayPage(model({ bankAccount: bank }), 'ar', ctx)).toContain(AR_RECEIPT);
    expect(renderPayPage(model({ bankAccount: bank, reviewMode: false }), 'en', ctx)).toContain(EN_RECEIPT);
  });
});
