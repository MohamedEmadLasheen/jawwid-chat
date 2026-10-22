/**
 * PD-27, the pure parts: money formatting, the invoice's right-to-left layout,
 * the payment page (escaping, what it shows and hides), the PDF, the webhook
 * signature check, and how a database guard's refusal reaches a client.
 */
import Stripe from 'stripe';
import { CommError, CommErrorCode } from '@platform/errors';
import { formatMajor, minorDigits } from '../../../src/billing/money';
import { renderInvoicePdf, visualSegments } from '../../../src/billing/invoice-pdf';
import { escapeHtml, renderPayPage, type PayPageModel } from '../../../src/billing/pay-page';
import { StripeSdkGateway } from '../../../src/billing/stripe.gateway';
import { mapPaymentRefusal, parseBankAccount } from '../../../src/billing/billing.service';
import { validateReceiptFile } from '../../../src/billing/parent-payments.service';

describe('money', () => {
  it('formats minor units with the currency\'s own digits, Latin numerals', () => {
    expect(minorDigits('AED')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
    expect(formatMajor(150000, 'AED')).toBe('1,500.00');
    expect(formatMajor(1500, 'JPY')).toBe('1,500');
    expect(formatMajor(1500, 'KWD')).toBe('1.500');
    expect(formatMajor(125050, 'EGP')).toBe('1,250.50');
  });
});

describe('the invoice\'s right-to-left layout', () => {
  it('leaves a left-to-right line alone', () => {
    expect(visualSegments('Paid by card (Stripe)')).toEqual(['Paid by card (Stripe)']);
  });

  it('puts an Arabic line\'s words right to left, each Arabic run in logical order for the font, numbers left to right', () => {
    // "the student: Youssef" -> visually: [Youssef][ :][the student]
    const segs = visualSegments('الطالب: يوسف');
    expect(segs[0]).toBe('يوسف');
    expect(segs[segs.length - 1]).toBe('الطالب');
    const withNumber = visualSegments('باقة 3 أشهر');
    expect(withNumber.join('|')).toContain('3');
    expect(withNumber[withNumber.length - 1]).toBe('باقة');
  });

  it('renders a PDF from a snapshot with Arabic names', async () => {
    const pdf = await renderInvoicePdf({
      number: 'JW-2026-000123',
      issuedAt: new Date('2026-10-22T10:00:00Z'),
      status: 'partially_refunded',
      refundedMinor: 25000,
      snapshot: {
        v: 1, billedTo: 'أحمد محمود', family: 'عائلة محمود', child: 'يوسف', label: 'اشتراك القرآن', purpose: 'subscription',
        planMonths: 3, periodStart: '2026-11-01', periodEnd: '2027-01-31', method: 'card', amountMinor: 150000, currency: 'AED',
        paidOn: '2026-10-22', reference: 'pi_123', issuer: { name: 'Jawwid Academy', address: 'Dubai', taxId: '100-200' },
      },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
  });
});

describe('the payment page', () => {
  const model = (over: Partial<PayPageModel> = {}): PayPageModel => ({
    status: 'open', payerName: 'Parent <b>One</b>', childFirstName: 'Adam', label: '<script>alert(1)</script>', purpose: 'subscription',
    planMonths: 3, periodStart: '2026-11-01', periodEnd: '2027-01-31', amountMinor: 150000, paidMinor: 50000, remainingMinor: 100000,
    currency: 'AED', expiresAt: '2026-11-05T00:00:00.000Z', bankAccount: null, cardAvailable: true, checkout: null, error: null, ...over,
  });
  const ctx = { token: 'T'.repeat(43), nonce: 'n0nce' };

  it('escapes everything a person typed', () => {
    const html = renderPayPage(model(), 'en', ctx);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>One</b>');
    expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
  });

  it('carries no script, styles only by nonce, and offers the card only when open, configured and not confirming', () => {
    const html = renderPayPage(model(), 'ar', ctx);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<style nonce="n0nce">');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(`action="./${'T'.repeat(43)}/checkout?lang=ar"`);
    expect(html).toContain('1,000.00'); // what is left
    expect(renderPayPage(model({ cardAvailable: false }), 'en', ctx)).not.toContain('/checkout');
    expect(renderPayPage(model({ status: 'paid' }), 'en', ctx)).not.toContain('/checkout');
    expect(renderPayPage(model({ status: 'expired' }), 'en', ctx)).toContain('expired');
    const confirming = renderPayPage(model({ checkout: 'success' }), 'en', ctx);
    expect(confirming).toContain('http-equiv="refresh"');
    expect(confirming).not.toContain('/checkout');
  });

  it('shows the bank details when set', () => {
    const html = renderPayPage(model({ bankAccount: { accountName: 'Academy', bankName: 'Bank', iban: 'AE07 0331', accountNumber: null, swift: null, note: 'Write the child\'s name' } }), 'en', ctx);
    expect(html).toContain('AE07 0331');
    expect(html).toContain('Write the child&#39;s name');
  });
});

describe('the Stripe webhook signature', () => {
  const secret = 'whsec_unit_test_secret';
  const signer = new Stripe('sk_test_unit');
  const gateway = new StripeSdkGateway({ STRIPE_WEBHOOK_SECRET: secret } as NodeJS.ProcessEnv);
  const body = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: {} } });

  it('accepts exactly the signed body, refuses anything else', () => {
    const header = signer.webhooks.generateTestHeaderString({ payload: body, secret });
    expect(gateway.verifyWebhook(Buffer.from(body), header).id).toBe('evt_1');
    expect(() => gateway.verifyWebhook(Buffer.from(body.replace('evt_1', 'evt_2')), header)).toThrow();
    expect(() => gateway.verifyWebhook(Buffer.from(body), signer.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_other' }))).toThrow();
    expect(() => gateway.verifyWebhook(Buffer.from(body), undefined)).toThrow();
  });

  it('is unavailable without its secrets; card payments are unavailable without a key', () => {
    const none = new StripeSdkGateway({} as NodeJS.ProcessEnv);
    expect(none.checkoutAvailable).toBe(false);
    expect(none.webhookAvailable).toBe(false);
    expect(() => none.verifyWebhook(Buffer.from(body), 'x')).toThrow();
    expect(gateway.checkoutAvailable).toBe(false);
    expect(gateway.webhookAvailable).toBe(true);
  });
});

describe('small rules', () => {
  it('a database guard\'s refusal reaches the client as a 409 with its sentence; anything else is rethrown', () => {
    const refused = mapPaymentRefusal(new Error('Invalid `prisma.payment.update()` invocation:\n\nERROR: a recorded payment never changes; void or refund it'));
    expect(refused).toBeInstanceOf(CommError);
    expect((refused as CommError).code).toBe(CommErrorCode.BILLING_STATE);
    expect((refused as CommError).status).toBe(409);
    expect((refused as CommError).message).toBe('a recorded payment never changes; void or refund it');
    const other = new Error('connection reset');
    expect(mapPaymentRefusal(other)).toBe(other);
  });

  it('bank details need an account name; receipts are images or PDFs of at most 10 MB', () => {
    expect(parseBankAccount({ iban: 'x' })).toBeNull();
    expect(parseBankAccount({ accountName: ' Academy ', iban: '' })).toEqual({ accountName: 'Academy', bankName: null, iban: null, accountNumber: null, swift: null, note: null });
    expect(validateReceiptFile('image/png', 10)).toEqual({ mimeType: 'image/png', byteSize: 10 });
    expect(() => validateReceiptFile('image/gif', 10)).toThrow(CommError);
    expect(() => validateReceiptFile('application/pdf', 10 * 1024 * 1024 + 1)).toThrow(CommError);
  });
});
