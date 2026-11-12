/**
 * W61 S2, the /pay page alone: a transfer receipt waiting for the academy.
 * Any: the notice (a card too may charge twice). Covering what is left: the
 * notice says the card waits, and there is no card button.
 */
import { renderPayPage, type PayPageModel } from '../../../src/billing/pay-page';

const NOTICE_EN = 'A transfer receipt for this request is waiting for the academy to check. Paying by card too may charge you twice.';
const NOTICE_AR = 'يوجد إيصال تحويل لهذا الطلب بانتظار مراجعة الأكاديمية. إن دفعتم بالبطاقة أيضًا فقد يُخصم المبلغ مرتين.';
const PAUSED_EN = 'Card payment will be available again if the academy cannot confirm the transfer.';
const PAUSED_AR = 'سيُتاح الدفع بالبطاقة مجددًا إذا تعذّر على الأكاديمية تأكيد التحويل.';

const model = (over: Partial<PayPageModel> = {}): PayPageModel => ({
  status: 'open', payerName: 'Parent One', childFirstName: 'Adam', label: 'Renewal', purpose: 'renewal',
  planMonths: 1, periodStart: null, periodEnd: null, amountMinor: 120000, paidMinor: 0, remainingMinor: 120000,
  currency: 'AED', expiresAt: '2026-11-05T00:00:00.000Z', bankAccount: null, cardAvailable: true, checkout: null, error: null, ...over,
});
const ctx = { token: 'T'.repeat(43), nonce: 'n0nce' };

describe('W61 S2: the /pay page with a transfer receipt waiting', () => {
  it('no receipt: no notice, the card offered', () => {
    const html = renderPayPage(model(), 'en', ctx);
    expect(html).not.toContain(NOTICE_EN);
    expect(html).toContain('/checkout?lang=en');
  });

  it('part covered: the notice in both languages, the card still offered', () => {
    const en = renderPayPage(model({ pendingReceiptMinor: 50000 }), 'en', ctx);
    expect(en).toContain(NOTICE_EN);
    expect(en).not.toContain(PAUSED_EN);
    expect(en).toContain('/checkout?lang=en');
    const ar = renderPayPage(model({ pendingReceiptMinor: 50000 }), 'ar', ctx);
    expect(ar).toContain(NOTICE_AR);
    expect(ar).toContain('/checkout?lang=ar');
  });

  it('all covered: the notice says the card waits, and there is no card button', () => {
    const en = renderPayPage(model({ pendingReceiptMinor: 120000 }), 'en', ctx);
    expect(en).toContain(`${NOTICE_EN} ${PAUSED_EN}`);
    expect(en).not.toContain('/checkout');
    const ar = renderPayPage(model({ pendingReceiptMinor: 150000 }), 'ar', ctx);
    expect(ar).toContain(`${NOTICE_AR} ${PAUSED_AR}`);
    expect(ar).not.toContain('/checkout');
  });

  it('not open, or confirming a card: no notice', () => {
    expect(renderPayPage(model({ status: 'paid', pendingReceiptMinor: 50000 }), 'en', ctx)).not.toContain(NOTICE_EN);
    expect(renderPayPage(model({ checkout: 'success', pendingReceiptMinor: 50000 }), 'en', ctx)).not.toContain(NOTICE_EN);
  });

  it('no card offered (Stripe off): no notice about a card, in either language', () => {
    const en = renderPayPage(model({ cardAvailable: false, pendingReceiptMinor: 120000 }), 'en', ctx);
    expect(en).not.toContain(NOTICE_EN);
    expect(en).not.toContain(PAUSED_EN);
    expect(en).not.toContain('/checkout');
    const ar = renderPayPage(model({ cardAvailable: false, pendingReceiptMinor: 50000 }), 'ar', ctx);
    expect(ar).not.toContain(NOTICE_AR);
  });
});
