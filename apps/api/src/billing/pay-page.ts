import { formatMajor } from './money';
import type { BankAccount } from './billing.service';

/**
 * PD-27: the payment link's page -- plain server-rendered HTML, no script.
 *
 * A parent opens it from WhatsApp, often before they have an account, so it
 * must work in any phone browser, in Arabic first. It shows only what the
 * link holder needs: whose payment, what for, how much, what is left, how to
 * pay. Never the family's contacts, never other payments, never staff names.
 *
 * No JavaScript at all: "Pay by card" is a form that POSTs to the API, which
 * answers 303 to Stripe Checkout. The confirming state refreshes itself with
 * <meta http-equiv="refresh"> until the webhook has recorded the payment. The
 * CSP the controller sends allows nothing but this page's own nonce'd style
 * and a form posting to itself (and Stripe, where it is redirected).
 */

export type PayLang = 'ar' | 'en';

export interface PayPageModel {
  status: 'open' | 'paid' | 'cancelled' | 'expired' | 'not_found';
  payerName: string | null;
  childFirstName: string | null;
  label: string;
  purpose: string;
  planMonths: number | null;
  /** PD-30: the lessons the package includes. */
  lessonsIncluded?: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountMinor: number;
  paidMinor: number;
  remainingMinor: number;
  currency: string;
  expiresAt: string | null;
  bankAccount: BankAccount | null;
  cardAvailable: boolean;
  /** The state Stripe sent the parent back with. */
  checkout: 'success' | 'cancelled' | null;
  error: string | null;
}

const T = {
  ar: {
    title: 'الدفع — جَوِّد',
    brand: 'جَوِّد',
    for: 'دفعة لـ',
    student: 'الطالب',
    package: 'الباقة',
    period: 'الفترة',
    amount: 'المبلغ',
    paid: 'المدفوع',
    remaining: 'المتبقي',
    payCard: 'ادفع بالبطاقة',
    cardNote: 'تتم عملية الدفع بأمان عبر Stripe. لا نحتفظ ببيانات بطاقتك.',
    bankTitle: 'أو حوّل إلى حسابنا البنكي',
    bankNote: 'بعد التحويل أرسل صورة الإيصال من تطبيق جَوِّد (الاشتراكات) أو إلى مشرفكم.',
    bankName: 'البنك',
    accountName: 'اسم الحساب',
    iban: 'IBAN',
    accountNumber: 'رقم الحساب',
    swift: 'SWIFT',
    expires: 'صالح حتى',
    statusPaid: 'تم الدفع. شكرًا لكم! ستجدون الفاتورة في تطبيق جَوِّد ضمن الاشتراكات.',
    statusCancelled: 'تم إلغاء طلب الدفع هذا. تواصلوا مع مشرفكم للحصول على رابط جديد.',
    statusExpired: 'انتهت صلاحية رابط الدفع. تواصلوا مع مشرفكم للحصول على رابط جديد.',
    statusNotFound: 'رابط الدفع غير صحيح. تأكدوا من نسخ الرابط كاملًا.',
    confirming: 'شكرًا! نتحقق الآن من الدفع مع Stripe — ستتحدث هذه الصفحة تلقائيًا.',
    cancelledCheckout: 'لم تكتمل عملية الدفع. يمكنكم المحاولة مرة أخرى.',
    other: 'English',
    months: (n: number) => (n === 1 ? 'شهر واحد' : n === 12 ? 'سنة' : `${n} أشهر`),
    lessons: (n: number) => (n === 1 ? 'حصة واحدة' : n === 2 ? 'حصتان' : n <= 10 ? `${n} حصص` : `${n} حصة`),
    purposes: { subscription: 'اشتراك', renewal: 'تجديد الباقة', instalment: 'قسط', balance: 'رصيد مستحق', other: 'دفعة' } as Record<string, string>,
  },
  en: {
    title: 'Payment — Jawwid',
    brand: 'Jawwid',
    for: 'Payment for',
    student: 'Student',
    package: 'Package',
    period: 'Period',
    amount: 'Amount',
    paid: 'Paid',
    remaining: 'Remaining',
    payCard: 'Pay by card',
    cardNote: 'Payments are processed securely by Stripe. We never store your card details.',
    bankTitle: 'Or transfer to our bank account',
    bankNote: 'After transferring, send a photo of the receipt from the Jawwid app (Subscriptions) or to your supervisor.',
    bankName: 'Bank',
    accountName: 'Account name',
    iban: 'IBAN',
    accountNumber: 'Account number',
    swift: 'SWIFT',
    expires: 'Valid until',
    statusPaid: 'Paid — thank you! Your invoice is in the Jawwid app under Subscriptions.',
    statusCancelled: 'This payment request was cancelled. Ask your supervisor for a new link.',
    statusExpired: 'This payment link has expired. Ask your supervisor for a new link.',
    statusNotFound: 'This payment link is not valid. Check that the whole link was copied.',
    confirming: 'Thank you! We are confirming your payment with Stripe — this page refreshes by itself.',
    cancelledCheckout: 'The payment was not completed. You can try again.',
    other: 'العربية',
    months: (n: number) => (n === 1 ? '1 month' : `${n} months`),
    lessons: (n: number) => (n === 1 ? '1 lesson' : `${n} lessons`),
    purposes: { subscription: 'Subscription', renewal: 'Package renewal', instalment: 'Instalment', balance: 'Outstanding balance', other: 'Payment' } as Record<string, string>,
  },
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function renderPayPage(m: PayPageModel, lang: PayLang, ctx: { token: string; nonce: string }): string {
  const t = T[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const e = escapeHtml;
  const money = (minor: number) => `<bdi dir="ltr">${e(formatMajor(minor, m.currency))} ${e(m.currency)}</bdi>`;
  const self = `./${encodeURIComponent(ctx.token)}`;
  const otherLang = lang === 'ar' ? 'en' : 'ar';
  const confirming = m.status === 'open' && m.checkout === 'success';

  const rows: string[] = [];
  if (m.status !== 'not_found') {
    if (m.childFirstName) rows.push(row(t.student, `<bdi>${e(m.childFirstName)}</bdi>`));
    // PD-30: "3 months — 24 lessons".
    const pkg = [m.planMonths ? t.months(m.planMonths) : null, m.lessonsIncluded ? t.lessons(m.lessonsIncluded) : null].filter((x): x is string => x !== null);
    if (pkg.length > 0) rows.push(row(t.package, e(pkg.join(' — '))));
    if (m.periodStart || m.periodEnd) rows.push(row(t.period, `<bdi dir="ltr">${e(m.periodStart ?? '…')} → ${e(m.periodEnd ?? '…')}</bdi>`));
    rows.push(row(t.amount, money(m.amountMinor)));
    if (m.paidMinor > 0) rows.push(row(t.paid, money(m.paidMinor)));
    if (m.status === 'open' && m.paidMinor > 0) rows.push(row(t.remaining, `<strong>${money(m.remainingMinor)}</strong>`));
  }

  let notice = '';
  if (m.status === 'paid') notice = note('ok', t.statusPaid);
  else if (m.status === 'cancelled') notice = note('muted', t.statusCancelled);
  else if (m.status === 'expired') notice = note('muted', t.statusExpired);
  else if (m.status === 'not_found') notice = note('muted', t.statusNotFound);
  else if (confirming) notice = note('info', t.confirming);
  else if (m.checkout === 'cancelled') notice = note('muted', t.cancelledCheckout);
  if (m.error) notice += note('warn', e(m.error));

  const payable = m.status === 'open' && !confirming;
  const card = payable && m.cardAvailable
    ? `<form method="post" action="${self}/checkout?lang=${lang}">
         <button type="submit" class="pay">${e(t.payCard)} · ${money(m.remainingMinor)}</button>
       </form>
       <p class="fine">${e(t.cardNote)}</p>`
    : '';
  const bank = payable && m.bankAccount ? bankBlock(m.bankAccount, t, e) : '';
  const expires = payable && m.expiresAt ? `<p class="fine">${e(t.expires)} <bdi dir="ltr">${e(m.expiresAt.slice(0, 10))}</bdi></p>` : '';

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
${confirming ? '<meta http-equiv="refresh" content="5">' : ''}
<title>${e(t.title)}</title>
<style nonce="${ctx.nonce}">
:root{--brand:#0F5C55;--brand-ink:#0B3F3A;--ink:#1B2B2A;--muted:#5C6B69;--rule:#DCE4E2;--bg:#F4F7F6;--card:#FFFFFF;--ok:#1E7A4C;--ok-bg:#E6F4EC;--info-bg:#E8F1F0;--warn:#8A4B00;--warn-bg:#FFF4E5}
@media (prefers-color-scheme: dark){:root{--brand:#3FB3A6;--brand-ink:#9FE0D7;--ink:#E7EFEE;--muted:#A3B3B0;--rule:#2C3B39;--bg:#0E1716;--card:#16211F;--ok:#7BD3A3;--ok-bg:#16301F;--info-bg:#15302C;--warn:#FFC37A;--warn-bg:#33240F}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.brand{font-weight:700;font-size:20px;color:var(--brand)}
.lang{color:var(--brand);text-decoration:none;font-size:14px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:16px;padding:20px}
.for{color:var(--muted);font-size:14px;margin:0}
h1{font-size:22px;margin:4px 0 2px}
.purpose{color:var(--muted);margin:0 0 12px;font-size:14px}
dl{margin:0;border-top:1px solid var(--rule)}
.row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--rule)}
dt{color:var(--muted)}dd{margin:0;text-align:end}
.pay{display:block;width:100%;margin-top:20px;padding:14px 16px;border:0;border-radius:12px;background:var(--brand);color:#fff;font:inherit;font-weight:700;font-size:17px;cursor:pointer}
.pay:focus-visible{outline:3px solid #C9A227;outline-offset:2px}
.fine{color:var(--muted);font-size:13px;margin:8px 0 0}
.note{border-radius:12px;padding:12px 14px;margin:0 0 16px;font-size:15px}
.note.ok{background:var(--ok-bg);color:var(--ok)}.note.info{background:var(--info-bg)}.note.muted{background:var(--info-bg);color:var(--muted)}.note.warn{background:var(--warn-bg);color:var(--warn)}
.bank{margin-top:24px}.bank h2{font-size:16px;margin:0 0 8px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;word-break:break-all}
</style>
</head>
<body>
<main>
<header><span class="brand">${e(t.brand)}</span><a class="lang" href="${self}?lang=${otherLang}" hreflang="${otherLang}">${e(t.other)}</a></header>
${notice}
${m.status === 'not_found' ? '' : `<section class="card">
  ${m.payerName ? `<p class="for">${e(t.for)} <bdi>${e(m.payerName)}</bdi></p>` : ''}
  <h1><bdi>${e(m.label)}</bdi></h1>
  <p class="purpose">${e(t.purposes[m.purpose] ?? t.purposes.other ?? '')}</p>
  <dl>${rows.join('')}</dl>
  ${card}
  ${expires}
  ${bank}
</section>`}
</main>
</body>
</html>`;
}

function row(label: string, valueHtml: string): string {
  return `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function note(kind: 'ok' | 'info' | 'muted' | 'warn', html: string): string {
  return `<p class="note ${kind}" role="status">${html}</p>`;
}

function bankBlock(b: BankAccount, t: (typeof T)['ar'] | (typeof T)['en'], e: (s: string) => string): string {
  const line = (label: string, value: string | null, mono = false) =>
    value ? `<div class="row"><dt>${e(label)}</dt><dd${mono ? ' class="mono" dir="ltr"' : ''}><bdi>${e(value)}</bdi></dd></div>` : '';
  return `<div class="bank"><h2>${e(t.bankTitle)}</h2><dl>
    ${line(t.bankName, b.bankName)}
    ${line(t.accountName, b.accountName)}
    ${line(t.iban, b.iban, true)}
    ${line(t.accountNumber, b.accountNumber, true)}
    ${line(t.swift, b.swift, true)}
  </dl>
  ${b.note ? `<p class="fine"><bdi>${e(b.note)}</bdi></p>` : ''}
  <p class="fine">${e(t.bankNote)}</p></div>`;
}
