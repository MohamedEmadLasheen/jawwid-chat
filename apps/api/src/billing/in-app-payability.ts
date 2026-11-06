import type { Prisma, PrismaClient } from '@prisma/client';
import { CommError, CommErrorCode } from '../platform/errors';
import type { RequestPurpose } from './payment-ledger.service';

/**
 * Store payments policy (owner decisions 2026-11-05 and 2026-11-06;
 * docs/release/app-review-notes-payments.md).
 *
 * The app takes card (Stripe) and bank-transfer payments outside the stores'
 * billing systems under App Store Review Guideline 3.1.3(d) (person-to-person
 * services) and Google Play's 1:1 online paid services rule. Both allow it only
 * for a live service between two individuals: a teacher and one learner.
 *
 * So a payment is taken in the app only when it is VERIFIED as a lesson package:
 * - a subscription or renewal names the child and the lessons it buys;
 * - an instalment names the lesson package (chat.learner_subscription) it pays for,
 *   and that package stands;
 * - a balance names the lesson package it is owed for, and that package stands.
 * Anything else (`other`, an unlinked instalment or balance, any purpose added
 * later) is refused by the in-app checkout and receipt endpoints with
 * COMM.PAYMENT_NOT_IN_APP, and the app offers no Pay for it. The web pay link
 * (`GET /pay/:token`), outside the app, is unchanged.
 *
 * Changing these rules is a store-policy decision: a live one-to-one lesson,
 * never a group class, recorded content, materials or an app feature.
 */
export const LESSON_PURPOSES: ReadonlySet<RequestPurpose> = new Set<RequestPurpose>(['subscription', 'renewal', 'instalment', 'balance']);

type Db = PrismaClient | Prisma.TransactionClient;

/** What the rules need from a request. */
export interface RequestFacts {
  purpose: string;
  learnerId: string | null;
  lessonsIncluded: number | null;
  instalmentId: string | null;
  lessonSubscriptionId: string | null;
}

/** The lesson packages the rules look at: each instalment's package, and the packages that stand. */
export interface PackageFacts {
  instalmentPackage: ReadonlyMap<string, string | null>;
  standing: ReadonlySet<string>;
}

export function isInstalmentPayableInApp(instalment: { lessonSubscriptionId: string | null }, facts: Pick<PackageFacts, 'standing'>): boolean {
  return instalment.lessonSubscriptionId !== null && facts.standing.has(instalment.lessonSubscriptionId);
}

export function isPayableInApp(request: RequestFacts, facts: PackageFacts): boolean {
  switch (request.purpose) {
    case 'subscription':
    case 'renewal':
      return request.learnerId !== null && request.lessonsIncluded !== null;
    case 'instalment': {
      if (!request.instalmentId) return false;
      const pkg = facts.instalmentPackage.get(request.instalmentId) ?? null;
      return isInstalmentPayableInApp({ lessonSubscriptionId: pkg }, facts);
    }
    case 'balance':
      return request.lessonSubscriptionId !== null && facts.standing.has(request.lessonSubscriptionId);
    default:
      return false;
  }
}

/** Loads the facts for these requests and instalments in two queries. */
export async function loadPackageFacts(
  db: Db,
  input: { requests?: readonly RequestFacts[]; instalments?: ReadonlyArray<{ id: string; lessonSubscriptionId: string | null }> },
): Promise<PackageFacts> {
  const instalmentPackage = new Map<string, string | null>();
  for (const i of input.instalments ?? []) instalmentPackage.set(i.id, i.lessonSubscriptionId);
  const missing = [...new Set((input.requests ?? []).flatMap((r) => (r.instalmentId && !instalmentPackage.has(r.instalmentId) ? [r.instalmentId] : [])))];
  if (missing.length > 0) {
    const rows = await db.familyInstalment.findMany({ where: { id: { in: missing } }, select: { id: true, lessonSubscriptionId: true } });
    for (const id of missing) instalmentPackage.set(id, rows.find((r) => r.id === id)?.lessonSubscriptionId ?? null);
  }
  const packageIds = [
    ...new Set([
      ...[...instalmentPackage.values()].flatMap((id) => (id ? [id] : [])),
      ...(input.requests ?? []).flatMap((r) => (r.lessonSubscriptionId ? [r.lessonSubscriptionId] : [])),
    ]),
  ];
  const standing = new Set<string>();
  if (packageIds.length > 0) {
    const subs = await db.learnerSubscription.findMany({ where: { id: { in: packageIds }, voidedAt: null }, select: { id: true } });
    for (const s of subs) standing.add(s.id);
  }
  return { instalmentPackage, standing };
}

function notInApp(): CommError {
  return new CommError(
    CommErrorCode.PAYMENT_NOT_IN_APP,
    'this payment is not verified as live one-to-one lessons and cannot be paid in the app',
    409,
  );
}

export async function assertPayableInApp(db: Db, request: RequestFacts): Promise<void> {
  if (!LESSON_PURPOSES.has(request.purpose as RequestPurpose)) throw notInApp();
  if (!isPayableInApp(request, await loadPackageFacts(db, { requests: [request] }))) throw notInApp();
}

/** Checked BEFORE an instalment's request is made, so a refusal writes nothing. */
export async function assertInstalmentPayableInApp(db: Db, instalment: { lessonSubscriptionId: string | null }): Promise<void> {
  if (!instalment.lessonSubscriptionId) throw notInApp();
  const facts = await loadPackageFacts(db, { instalments: [{ id: '', lessonSubscriptionId: instalment.lessonSubscriptionId }] });
  if (!isInstalmentPayableInApp(instalment, facts)) throw notInApp();
}

/** What the family reads on the Stripe Checkout page for a lesson payment. */
export const LIVE_ONE_TO_ONE_DESCRIPTION = {
  en: 'Live one-to-one Quran lessons: one teacher and one student, in real time. Lessons are not recorded.',
  ar: 'دروس قرآن فردية مباشرة، تجمع بين معلّم واحد وطالب واحد عبر اتصال مباشر. لا يتم تسجيل الدروس.',
} as const;

/** `lessons`: the request is verified as a lesson package (isPayableInApp). */
export function checkoutDescription(
  request: { periodStart: Date | null; periodEnd: Date | null },
  lessons: boolean,
  locale: 'ar' | 'en',
): string | null {
  const period = request.periodStart && request.periodEnd
    ? `${request.periodStart.toISOString().slice(0, 10)} → ${request.periodEnd.toISOString().slice(0, 10)}`
    : null;
  if (!lessons) return period;
  return period ? `${LIVE_ONE_TO_ONE_DESCRIPTION[locale]} ${period}` : LIVE_ONE_TO_ONE_DESCRIPTION[locale];
}
