import { CommError, CommErrorCode } from '../platform/errors';
import type { RequestPurpose } from './payment-ledger.service';

/**
 * Store payments policy (owner decision 2026-11-05; docs/release/app-review-notes-payments.md).
 *
 * The app takes card (Stripe) and bank-transfer payments outside the stores'
 * billing systems under App Store Review Guideline 3.1.3(d) (person-to-person
 * services) and Google Play's 1:1 online paid services rule. Both allow it only
 * for a live service between two individuals: here, a teacher and one learner.
 *
 * So every payment request purpose is classified. The purposes that pay for a
 * learner's live one-to-one lessons are payable in the app; anything else
 * (`other`, and any purpose added later until it is classified here) is not:
 * the in-app checkout and receipt endpoints refuse it with
 * COMM.PAYMENT_NOT_IN_APP, and the app shows no Pay action for it. The web pay
 * link (`GET /pay/:token`), which is outside the app, is unchanged.
 *
 * Adding a purpose here is a store-policy decision: it must be a live
 * one-to-one lesson, never a group class, recorded content, materials or an
 * app feature.
 */
export const IN_APP_PAYABLE_PURPOSES: ReadonlySet<RequestPurpose> = new Set<RequestPurpose>([
  'subscription', // a package of live one-to-one lessons for one learner (PD-30)
  'renewal', // the next package of the same
  'instalment', // part of a package's price, spread over time
  'balance', // what is still owed for packages already given
]);

export function isPayableInApp(request: { purpose: string }): boolean {
  return (IN_APP_PAYABLE_PURPOSES as ReadonlySet<string>).has(request.purpose);
}

export function assertPayableInApp(request: { purpose: string }): void {
  if (!isPayableInApp(request)) {
    throw new CommError(
      CommErrorCode.PAYMENT_NOT_IN_APP,
      'this payment is not for live one-to-one lessons and cannot be paid in the app',
      409,
    );
  }
}

/** What the family reads on the Stripe Checkout page for a lesson payment. */
export const LIVE_ONE_TO_ONE_DESCRIPTION = {
  en: 'Live one-to-one Quran lessons: one teacher and one student, in real time. Lessons are not recorded.',
  ar: 'دروس قرآن مباشرة فردية: معلّم واحد وطالب واحد في الوقت نفسه. لا تُسجَّل الدروس.',
} as const;

export function checkoutDescription(
  request: { purpose: string; periodStart: Date | null; periodEnd: Date | null },
  locale: 'ar' | 'en',
): string | null {
  const period = request.periodStart && request.periodEnd
    ? `${request.periodStart.toISOString().slice(0, 10)} → ${request.periodEnd.toISOString().slice(0, 10)}`
    : null;
  if (!isPayableInApp(request)) return period;
  return period ? `${LIVE_ONE_TO_ONE_DESCRIPTION[locale]} ${period}` : LIVE_ONE_TO_ONE_DESCRIPTION[locale];
}
