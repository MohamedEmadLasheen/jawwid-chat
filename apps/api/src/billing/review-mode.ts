import { Logger } from '@nestjs/common';
import { CommError, CommErrorCode } from '../platform/errors';
import type { BankAccount } from './billing.service';
import { PaymentLedger } from './payment-ledger.service';
import type { PaymentRequestDto } from './payments-read.service';
import { escapeHtml, type PayLang } from './pay-page';

/**
 * OA-12 (owner, 2026-11-10): the App Review payment mode, enforced HERE, on the
 * server, never only by hiding UI.
 *
 * The store reviewers' accounts live in their own organization (review-accounts.md).
 * For a family of an organization listed in chat.config
 *
 *   review.sandbox_organization_ids   ["<organization uuid>", ...]   (a JSON array)
 *
 * the payments feature runs as a demo:
 *  - GET /me/billing says `reviewMode: true`, lists ONE synthetic amount due
 *    (never written to the database) so the pay sheet can be opened, and shows
 *    clearly fake bank details -- never chat.config billing.bank_account;
 *  - card: CheckoutService.open() never calls Stripe; it answers the static
 *    page /pay/review-demo, which explains what the live app does;
 *  - bank transfer: the receipt upload grant and the receipt itself are refused
 *    (403 COMM.BILLING_DENIED with detail { reviewMode: true }) before anything
 *    is signed, stored or written.
 * Every other organization is untouched.
 *
 * The key is written only by the review-cohort command (owner-approved, outside
 * this module). No route writes it: /billing/settings writes only
 * billing.bank_account and billing.invoice_issuer (payments.service.ts setSettings).
 *
 * Malformed (not an array of uuids) is "no review organization": public
 * behaviour, and an error in the log. A typo in the key can therefore only
 * ever make a review account behave like a real one -- never a real family
 * behave like a demo. A failed READ is different: it propagates (the request
 * answers 500), so a database hiccup can never fall back to public behaviour
 * for a review account.
 *
 * Staff side (insurance, not only "the review organization has no staff
 * logins"): every staff money write (BillingService.requireRecorder), refunds,
 * and the payment settings, read or written, are refused for an actor of a review
 * organization -- staff only ever reach their own organization's families, so
 * that also covers every review family (refuseReviewOrganizationStaff).
 */
export const REVIEW_ORGANIZATIONS_KEY = 'review.sandbox_organization_ids';

/** The synthetic amount due's id: fixed, so the app recognises the demo item. Never a row. */
export const REVIEW_DEMO_REQUEST_ID = '00000000-0000-4000-8000-0000000a99e1';

/** The demo page's path segment under /pay (never a 43-character token). */
export const REVIEW_DEMO_PAGE = 'review-demo';

const DEMO_AMOUNT_MINOR = 8000;
const DEMO_CURRENCY = 'USD';
const DEMO_LESSONS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONE: ReadonlySet<string> = new Set();
const log = new Logger('ReviewMode');

/** The one table read (as quran/audio-gate.ts takes it): PrismaService, a transaction, or a test double. */
type ConfigReader = { config: { findUnique(args: object): Promise<{ value: unknown } | null> } };

/** The organization ids the value lists (lower case), or null when it is not an array of uuids. */
export function parseReviewOrganizationIds(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string' && UUID_RE.test(v))) return null;
  return new Set((value as string[]).map((v) => v.toLowerCase()));
}

/**
 * Pure: is this organization a review organization, given the config value as
 * stored? Malformed or absent is false (public behaviour).
 */
export function isReviewOrganization(organizationId: string | null | undefined, configValue: unknown): boolean {
  if (!organizationId) return false;
  return parseReviewOrganizationIds(configValue)?.has(organizationId.toLowerCase()) ?? false;
}

/**
 * The review organizations as chat.config holds them now. A failed read is NOT
 * caught: the request fails (500) rather than serve a review account the real
 * bank details or a write -- a request whose database is failing fails anyway.
 * Absent is empty; malformed is empty and logged.
 */
export async function readReviewOrganizationIds(db: ConfigReader): Promise<ReadonlySet<string>> {
  const row = await db.config.findUnique({ where: { key: REVIEW_ORGANIZATIONS_KEY } });
  if (!row) return NONE;
  const ids = parseReviewOrganizationIds(row.value);
  if (!ids) {
    log.error(`${REVIEW_ORGANIZATIONS_KEY} is not a JSON array of organization ids; no organization is in review mode`);
    return NONE;
  }
  return ids;
}

/** Read per call (one primary-key lookup): a change by the command applies at once. */
export async function inReviewMode(db: ConfigReader, organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  return (await readReviewOrganizationIds(db)).has(organizationId.toLowerCase());
}

/** The refusal of every payment write for a review account. */
export function reviewModeRefusal(): CommError {
  return new CommError(
    CommErrorCode.BILLING_DENIED,
    'payments are disabled for the App Review demo account; no payment can be made',
    403,
    { reviewMode: true },
  );
}

/**
 * The one staff guard: refuses (reviewModeRefusal) when the staff member
 * belongs to a review organization. Staff reach only their own organization's
 * families (requireFamily, requireRequest, requireReceipt filter on it), so
 * the target family of any staff write is in the actor's organization; this
 * refuses both "a review-org actor" and "a review family" at once.
 */
export async function refuseReviewOrganizationStaff(db: ConfigReader, organizationId: string | null | undefined): Promise<void> {
  if (await inReviewMode(db, organizationId)) throw reviewModeRefusal();
}

/** Where a review account's card payment goes instead of Stripe. */
export function reviewDemoUrl(locale: PayLang): string {
  return `${PaymentLedger.linkFor(REVIEW_DEMO_PAGE)}?lang=${locale}`;
}

/** Clearly fake bank details: nothing here is an account anyone can pay into. */
export function reviewDemoBankAccount(lang: PayLang): BankAccount {
  return lang === 'en'
    ? {
        bankName: 'Demo bank (App Review)',
        accountName: 'Demo bank details for App Review: no transfer is possible',
        iban: null,
        accountNumber: 'DEMO-0000-0000',
        swift: null,
        note: 'These details are a demo for the App Review account. No transfer is possible, and no receipt can be sent.',
      }
    : {
        bankName: 'بنك تجريبي (مراجعة المتجر)',
        accountName: 'بيانات بنكية تجريبية لمراجعة المتجر: لا يمكن إجراء أي تحويل',
        iban: null,
        accountNumber: 'DEMO-0000-0000',
        swift: null,
        note: 'هذه بيانات تجريبية لحساب مراجعة المتجر. لا يمكن إجراء أي تحويل، ولا يمكن إرسال إيصال.',
      };
}

/**
 * The synthetic amount due: an open lesson package for the family's first child
 * (or the family), never written to the database. Its id is fixed
 * (REVIEW_DEMO_REQUEST_ID); checkout for a review account never looks it up.
 */
export function reviewDemoRequest(lang: PayLang, child: { id: string; name: string } | null, now = new Date()): PaymentRequestDto {
  return {
    id: REVIEW_DEMO_REQUEST_ID,
    purpose: 'subscription',
    payableInApp: true,
    lessonSubscriptionId: null,
    label: lang === 'en'
      ? `Lesson package (demo): ${DEMO_LESSONS} live one-to-one lessons`
      : `باقة دروس (تجريبية): ${DEMO_LESSONS} دروس فردية مباشرة`,
    status: 'open',
    amountMinor: DEMO_AMOUNT_MINOR,
    paidMinor: 0,
    remainingMinor: DEMO_AMOUNT_MINOR,
    currency: DEMO_CURRENCY,
    child,
    instalmentId: null,
    planMonths: 1,
    lessonsIncluded: DEMO_LESSONS,
    periodStart: null,
    periodEnd: null,
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    lastCardFailure: null,
  };
}

const DEMO_TEXT = {
  ar: {
    title: 'وضع المراجعة — جَوِّد',
    heading: 'الدفع بالبطاقة (عرض تجريبي)',
    body: 'في التطبيق الفعلي تفتح هذه الخطوة صفحة الدفع الآمنة من Stripe في المتصفح لدفع ثمن باقة الدروس هذه بالبطاقة. لا يمكن لحساب المراجعة إجراء أي دفع.',
    how: 'يدفع أولياء الأمور الحقيقيون ثمن باقات الدروس الفردية المباشرة بالبطاقة عبر Stripe في المتصفح، أو بالتحويل البنكي مع إرسال صورة الإيصال لتتحقق منه الأكاديمية.',
  },
  en: {
    title: 'Review mode — Jawwid',
    heading: 'Pay by card (demo)',
    body: "In the live app this opens Stripe's secure checkout page in the browser to pay this lesson package by card. The review account cannot make a payment.",
    how: 'Real parents pay for live one-to-one lesson packages by card on Stripe\'s page in the browser, or by bank transfer, sending a photo of the receipt for the academy to confirm.',
  },
};

/** The static demo page: both languages, the requested one first. No script, no form, no link out. */
export function renderReviewDemoPage(lang: PayLang, nonce: string): string {
  const e = escapeHtml;
  const order: PayLang[] = lang === 'en' ? ['en', 'ar'] : ['ar', 'en'];
  const section = (l: PayLang) => {
    const t = DEMO_TEXT[l];
    return `<section class="card" lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}">
  <h1>${e(t.heading)}</h1>
  <p class="note" role="status">${e(t.body)}</p>
  <p class="fine">${e(t.how)}</p>
</section>`;
  };
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${e(DEMO_TEXT[lang].title)}</title>
<style nonce="${nonce}">
:root{--brand:#0F5C55;--ink:#1B2B2A;--muted:#5C6B69;--rule:#DCE4E2;--bg:#F4F7F6;--card:#FFFFFF;--info-bg:#E8F1F0}
@media (prefers-color-scheme: dark){:root{--brand:#3FB3A6;--ink:#E7EFEE;--muted:#A3B3B0;--rule:#2C3B39;--bg:#0E1716;--card:#16211F;--info-bg:#15302C}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px 48px}
.brand{font-weight:700;font-size:20px;color:var(--brand);margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:16px;padding:20px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 12px}
.note{border-radius:12px;padding:12px 14px;margin:0 0 12px;background:var(--info-bg)}
.fine{color:var(--muted);font-size:14px;margin:0}
</style>
</head>
<body>
<main>
<div class="brand">${e(lang === 'en' ? 'Jawwid' : 'جَوِّد')}</div>
${order.map(section).join('\n')}
</main>
</body>
</html>`;
}
