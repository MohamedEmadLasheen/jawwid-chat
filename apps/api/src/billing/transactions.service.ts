import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { isUuid } from '../communication/conversations/conversation.service';
import { StaffRole, SUBSCRIPTION_PLAN_MONTHS } from '../communication/contracts/vocab';
import { BillingService } from './billing.service';
import { familyInScopeSql } from './billing-access';
import { PAYMENT_METHODS, REQUEST_PURPOSES } from './payment-ledger.service';
import { day } from './validate';

/**
 * PD-27 completion: the academy's money as one list -- every transaction,
 * filtered, with Stripe's references -- for the Payments page (Transactions,
 * Card attempts, Stripe events). docs/admin/pd027-stripe-lifecycle.md §3.5.
 *
 * READ ONLY. Who sees what is PD-17's rule, unchanged: billingAccessOf, and the
 * one family-scope predicate (familyInScopeSql) every billing list uses -- an
 * Operations supervisor the families they reach, a Sales member (switch 'own')
 * the families they own, the managers and the super admin every family. A
 * trial's payment before Assign (no family yet) is seen by the 'all' scope
 * only. The webhook log is canVerify's; events Chat could not attribute to an
 * academy are the super admin's only.
 */

export const TRANSACTION_STATUSES = ['standing', 'partially_refunded', 'refunded', 'voided'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const ATTEMPT_STATUSES = ['failed', 'open', 'expired', 'complete', 'all'] as const;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

type Person = { id: string; name: string };

export interface TransactionDto {
  id: string;
  status: TransactionStatus;
  method: string;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  paidOn: string;
  recordedAt: string;
  family: { id: string; name: string } | null;
  trialId: string | null;
  child: { id: string | null; name: string } | null;
  request: { id: string; label: string; purpose: string; planMonths: number | null } | null;
  instalmentId: string | null;
  invoice: { id: string; number: string } | null;
  reference: string | null;
  recordedBy: Person | null;
  card: { brand: string | null; last4: string | null; wallet: string | null } | null;
  stripe: {
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
    chargeId: string | null;
    customerId: string | null;
    livemode: boolean | null;
  } | null;
}

interface TxRow {
  id: string;
  method: string;
  amount_minor: bigint;
  refunded_minor: bigint;
  currency: string;
  paid_on: Date;
  recorded_at: Date;
  voided_at: Date | null;
  family_id: string | null;
  family_name: string | null;
  trial_lesson_id: string | null;
  learner_id: string | null;
  learner_name: string | null;
  child_name: string | null;
  request_id: string | null;
  request_label: string | null;
  request_purpose: string | null;
  plan_months: number | null;
  instalment_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  reference: string | null;
  recorded_by: string | null;
  recorder_name: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_customer_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_wallet: string | null;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /** GET /payments */
  async list(actorId: string, query: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const org = actor.organizationId as string;
    const f = parseTransactionFilters(query);
    const scope = scopeSql(actor.actorId, access.scope, Prisma.sql`p.family_id`);
    const where = Prisma.sql`p.organization_id = ${org}::uuid AND ${scope} ${filterSql(f)}`;
    const cursor = f.cursor ? Prisma.sql`AND (p.recorded_at, p.id) < (${f.cursor.at}::timestamptz, ${f.cursor.id}::uuid)` : Prisma.empty;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<TxRow[]>`
        ${selectTransactions}
         WHERE ${where} ${cursor}
         ORDER BY p.recorded_at DESC, p.id DESC
         LIMIT ${f.limit + 1}`,
      this.prisma.$queryRaw<{ currency: string; count: bigint; amount_minor: bigint | null; refunded_minor: bigint | null }[]>`
        SELECT p.currency, count(*)::bigint AS count,
               sum(p.amount_minor) FILTER (WHERE p.voided_at IS NULL) AS amount_minor,
               sum(rf.refunded_minor) FILTER (WHERE p.voided_at IS NULL) AS refunded_minor
          FROM chat.payment p
          LEFT JOIN chat.invoice i ON i.payment_id = p.id
          LEFT JOIN chat.family f ON f.id = p.family_id
          LEFT JOIN chat.learner l ON l.id = p.learner_id
          LEFT JOIN chat.payment_request q ON q.id = p.request_id
          CROSS JOIN LATERAL (SELECT coalesce(sum(r.amount_minor), 0)::bigint AS refunded_minor
                                FROM chat.payment_refund r WHERE r.payment_id = p.id) rf
         WHERE ${where}
         GROUP BY p.currency
         ORDER BY p.currency`,
    ]);
    const page = rows.slice(0, f.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(presentTransaction),
      nextCursor: rows.length > f.limit && last ? encodeCursor(last.recorded_at, last.id) : null,
      totals: totals.map((t) => ({
        currency: t.currency,
        count: Number(t.count),
        amountMinor: Number(t.amount_minor ?? 0n),
        refundedMinor: Number(t.refunded_minor ?? 0n),
        netMinor: Number(t.amount_minor ?? 0n) - Number(t.refunded_minor ?? 0n),
      })),
      canReconcile: access.canVerify,
    };
  }

  /** GET /payments/:id -- the payment, its refunds, its request's card attempts, its webhook events. */
  async detail(actorId: string, paymentId: string) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const org = actor.organizationId as string;
    if (!isUuid(paymentId)) throw notFound();
    const scope = scopeSql(actor.actorId, access.scope, Prisma.sql`p.family_id`);
    const [row] = await this.prisma.$queryRaw<TxRow[]>`
      ${selectTransactions}
       WHERE p.id = ${paymentId}::uuid AND p.organization_id = ${org}::uuid AND ${scope}`;
    if (!row) throw notFound();

    const [payment, refunds, attempts, request] = await Promise.all([
      this.prisma.payment.findUniqueOrThrow({ where: { id: row.id } }),
      this.prisma.paymentRefund.findMany({ where: { paymentId: row.id }, orderBy: { createdAt: 'asc' } }),
      row.request_id
        ? this.prisma.paymentCheckout.findMany({ where: { requestId: row.request_id }, orderBy: { createdAt: 'desc' }, take: 50 })
        : Promise.resolve([]),
      row.request_id ? this.prisma.paymentRequest.findUnique({ where: { id: row.request_id } }) : Promise.resolve(null),
    ]);
    const sessionIds = attempts.map((a) => a.stripeSessionId);
    const refundIds = refunds.flatMap((r) => (r.stripeRefundId ? [r.stripeRefundId] : []));
    const events = payment.method === 'card'
      ? await this.prisma.stripeEvent.findMany({
          where: {
            OR: [
              ...(payment.stripePaymentIntentId ? [{ paymentIntentId: payment.stripePaymentIntentId }] : []),
              ...(sessionIds.length ? [{ objectId: { in: sessionIds } }] : []),
              ...(refundIds.length ? [{ objectId: { in: refundIds } }] : []),
            ],
          },
          orderBy: { receivedAt: 'asc' },
          take: 100,
        })
      : [];
    const staffIds = [...new Set([...refunds.map((r) => r.recordedBy), payment.voidedBy].filter((x): x is string => !!x))];
    const staff = staffIds.length
      ? new Map((await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
      : new Map<string, string>();
    const person = (id: string | null): Person | null => (id ? { id, name: staff.get(id) ?? '' } : null);

    return {
      payment: {
        ...presentTransaction(row),
        voided: payment.voidedAt ? { at: payment.voidedAt.toISOString(), by: person(payment.voidedBy), reason: payment.voidReason } : null,
        paymentMethodType: payment.paymentMethodType,
      },
      refunds: refunds.map((r) => ({
        id: r.id,
        amountMinor: Number(r.amountMinor),
        reason: r.reason,
        at: r.createdAt.toISOString(),
        source: r.recordedBy ? 'staff' : 'stripe',
        recordedBy: person(r.recordedBy),
        stripeRefundId: r.stripeRefundId,
      })),
      request: request
        ? {
            id: request.id,
            label: request.label,
            purpose: request.purpose,
            amountMinor: Number(request.amountMinor),
            currency: request.currency,
            planMonths: request.planMonths,
            periodStart: request.periodStart ? day(request.periodStart) : null,
            periodEnd: request.periodEnd ? day(request.periodEnd) : null,
            status: request.cancelledAt ? 'cancelled' : request.paidAt ? 'paid' : request.expiresAt <= new Date() ? 'expired' : 'open',
          }
        : null,
      attempts: attempts.map(presentAttempt),
      events: events.map(presentEvent),
      canReconcile: access.canVerify && payment.method === 'card' && !!payment.stripePaymentIntentId,
    };
  }

  /** GET /payment-attempts -- card attempts; `failed` = declined, failed, or expired unpaid. */
  async attempts(actorId: string, query: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const org = actor.organizationId as string;
    const status = (str(query.status) ?? 'failed') as (typeof ATTEMPT_STATUSES)[number];
    if (!ATTEMPT_STATUSES.includes(status)) throw invalid(`status: ${ATTEMPT_STATUSES.join(' | ')}`);
    const limit = parseLimit(query.limit);
    const cursor = parseCursor(query.cursor);
    const from = optionalDay(query.from, 'from');
    const to = optionalDay(query.to, 'to');
    const scope = scopeSql(actor.actorId, access.scope, Prisma.sql`q.family_id`);
    const statusSql =
      status === 'failed'
        ? Prisma.sql`AND (c.failure_count > 0 OR c.status = 'failed' OR (c.status = 'expired' AND pay.id IS NULL))`
        : status === 'all'
          ? Prisma.empty
          : Prisma.sql`AND c.status = ${status}`;
    const rows = await this.prisma.$queryRaw<AttemptRow[]>`
      SELECT c.stripe_session_id, c.status, c.amount_minor, c.currency, c.created_at, c.expires_at,
             c.failure_count, c.failure_code, c.last_failed_at, c.stripe_payment_intent_id, c.stripe_customer_id,
             q.id AS request_id, q.label AS request_label, q.purpose AS request_purpose,
             f.id AS family_id, f.display_name AS family_name, q.trial_lesson_id,
             pay.id AS payment_id
        FROM chat.payment_checkout c
        JOIN chat.payment_request q ON q.id = c.request_id
        LEFT JOIN chat.family f ON f.id = q.family_id
        LEFT JOIN chat.payment pay ON pay.stripe_checkout_session_id = c.stripe_session_id
       WHERE c.organization_id = ${org}::uuid AND ${scope} ${statusSql}
         ${from ? Prisma.sql`AND c.created_at >= (${from}::date)::timestamptz` : Prisma.empty}
         ${to ? Prisma.sql`AND c.created_at < (${to}::date + 1)::timestamptz` : Prisma.empty}
         ${cursor ? Prisma.sql`AND (c.created_at, c.stripe_session_id) < (${cursor.at}::timestamptz, ${cursor.id})` : Prisma.empty}
       ORDER BY c.created_at DESC, c.stripe_session_id DESC
       LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        ...presentAttempt({
          stripeSessionId: r.stripe_session_id,
          status: r.status,
          amountMinor: r.amount_minor,
          currency: r.currency,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          failureCount: r.failure_count,
          failureCode: r.failure_code,
          lastFailedAt: r.last_failed_at,
          stripePaymentIntentId: r.stripe_payment_intent_id,
          stripeCustomerId: r.stripe_customer_id,
        }),
        paymentId: r.payment_id,
        request: { id: r.request_id, label: r.request_label, purpose: r.request_purpose },
        family: r.family_id ? { id: r.family_id, name: r.family_name ?? '' } : null,
        trialId: r.family_id ? null : r.trial_lesson_id,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.stripe_session_id) : null,
    };
  }

  /** GET /stripe/events -- the webhook log (canVerify). */
  async events(actorId: string, query: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireReader(actorId);
    if (!access.canVerify) throw new CommError(CommErrorCode.BILLING_DENIED, 'the Stripe event log is the super admin\'s and the Operations Manager\'s', 403);
    const org = actor.organizationId as string;
    const limit = parseLimit(query.limit);
    const cursor = parseCursor(query.cursor);
    const outcome = str(query.outcome);
    if (outcome !== null && !/^[a-z_]{1,40}$/.test(outcome)) throw invalid('outcome');
    const type = str(query.type);
    if (type !== null && !/^[a-z_.]{1,80}$/.test(type)) throw invalid('type');
    const unattributed = actor.staffRole === StaffRole.SUPER_ADMIN;
    const rows = await this.prisma.stripeEvent.findMany({
      where: {
        // AND of separate clauses: the academy filter can never be replaced by another OR.
        AND: [
          { OR: [{ organizationId: org }, ...(unattributed ? [{ organizationId: null }] : [])] },
          ...(outcome ? [{ outcome }] : []),
          ...(type ? [{ type: { startsWith: type } }] : []),
          ...(cursor ? [{ OR: [{ receivedAt: { lt: new Date(cursor.at) } }, { receivedAt: new Date(cursor.at), id: { lt: cursor.id } }] }] : []),
        ],
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(presentEvent),
      nextCursor: rows.length > limit && last ? encodeCursor(last.receivedAt, last.id) : null,
    };
  }
}

// ---- SQL ------------------------------------------------------------------

const selectTransactions = Prisma.sql`
  SELECT p.id, p.method, p.amount_minor, rf.refunded_minor, p.currency, p.paid_on, p.recorded_at, p.voided_at,
         p.family_id, f.display_name AS family_name, p.trial_lesson_id, p.learner_id, l.name AS learner_name,
         p.child_name, p.request_id, q.label AS request_label, q.purpose AS request_purpose, q.plan_months,
         p.instalment_id, i.id AS invoice_id, i.number AS invoice_number, p.reference, p.recorded_by,
         s.name AS recorder_name, p.stripe_checkout_session_id, p.stripe_payment_intent_id, p.stripe_charge_id,
         p.stripe_customer_id, p.card_brand, p.card_last4, p.card_wallet
    FROM chat.payment p
    LEFT JOIN chat.invoice i ON i.payment_id = p.id
    LEFT JOIN chat.family f ON f.id = p.family_id
    LEFT JOIN chat.learner l ON l.id = p.learner_id
    LEFT JOIN chat.payment_request q ON q.id = p.request_id
    LEFT JOIN chat.staff s ON s.id = p.recorded_by
    CROSS JOIN LATERAL (SELECT coalesce(sum(r.amount_minor), 0)::bigint AS refunded_minor
                          FROM chat.payment_refund r WHERE r.payment_id = p.id) rf`;

/** A trial's money (no family yet) is the 'all' scope's only; a family's, the shared predicate's. */
function scopeSql(actorId: string, scope: 'all' | 'reach' | 'owned' | null, familyCol: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`((${familyCol} IS NULL AND ${scope === 'all'}) OR (${familyCol} IS NOT NULL AND ${familyInScopeSql(actorId, scope, familyCol)}))`;
}

export interface TransactionFilters {
  status: TransactionStatus | null;
  method: string | null;
  purpose: string | null;
  planMonths: number | null;
  from: string | null;
  to: string | null;
  familyId: string | null;
  q: string | null;
  cursor: { at: string; id: string } | null;
  limit: number;
}

/** Pure: the query string -> filters, or a 400 naming the bad one. Unit-tested. */
export function parseTransactionFilters(query: Record<string, unknown>): TransactionFilters {
  const status = str(query.status);
  if (status !== null && !TRANSACTION_STATUSES.includes(status as TransactionStatus)) throw invalid(`status: ${TRANSACTION_STATUSES.join(' | ')}`);
  const method = str(query.method);
  if (method !== null && !(PAYMENT_METHODS as readonly string[]).includes(method)) throw invalid(`method: ${PAYMENT_METHODS.join(' | ')}`);
  const purpose = str(query.purpose);
  if (purpose !== null && !(REQUEST_PURPOSES as readonly string[]).includes(purpose)) throw invalid(`purpose: ${REQUEST_PURPOSES.join(' | ')}`);
  const pm = str(query.planMonths);
  const planMonths = pm === null ? null : Number(pm);
  if (planMonths !== null && !(SUBSCRIPTION_PLAN_MONTHS as readonly number[]).includes(planMonths)) throw invalid('planMonths: 1 | 3 | 6 | 12');
  const from = optionalDay(query.from, 'from');
  const to = optionalDay(query.to, 'to');
  if (from && to && from > to) throw invalid('from is after to');
  const familyId = str(query.familyId);
  if (familyId !== null && !isUuid(familyId)) throw invalid('familyId');
  const q = str(query.q);
  if (q !== null && q.length > 100) throw invalid('q: at most 100 characters');
  return {
    status: status as TransactionStatus | null,
    method,
    purpose,
    planMonths,
    from,
    to,
    familyId,
    q,
    cursor: parseCursor(query.cursor, isUuid),
    limit: parseLimit(query.limit),
  };
}

function filterSql(f: TransactionFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.status === 'voided') parts.push(Prisma.sql`p.voided_at IS NOT NULL`);
  if (f.status === 'standing') parts.push(Prisma.sql`p.voided_at IS NULL AND rf.refunded_minor = 0`);
  if (f.status === 'partially_refunded') parts.push(Prisma.sql`p.voided_at IS NULL AND rf.refunded_minor > 0 AND rf.refunded_minor < p.amount_minor`);
  if (f.status === 'refunded') parts.push(Prisma.sql`rf.refunded_minor >= p.amount_minor`);
  if (f.method) parts.push(Prisma.sql`p.method = ${f.method}`);
  if (f.purpose) parts.push(Prisma.sql`q.purpose = ${f.purpose}`);
  if (f.planMonths) parts.push(Prisma.sql`q.plan_months = ${f.planMonths}`);
  if (f.from) parts.push(Prisma.sql`p.paid_on >= ${f.from}::date`);
  if (f.to) parts.push(Prisma.sql`p.paid_on <= ${f.to}::date`);
  if (f.familyId) parts.push(Prisma.sql`p.family_id = ${f.familyId}::uuid`);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(Prisma.sql`(f.display_name ILIKE ${like} OR l.name ILIKE ${like} OR p.child_name ILIKE ${like}
      OR i.number ILIKE ${like} OR p.reference ILIKE ${like} OR p.stripe_payment_intent_id = ${f.q}
      OR p.stripe_checkout_session_id = ${f.q} OR p.stripe_charge_id = ${f.q} OR p.stripe_customer_id = ${f.q})`);
  }
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

// ---- presentation ---------------------------------------------------------

export function transactionStatus(amountMinor: number, refundedMinor: number, voided: boolean): TransactionStatus {
  if (voided) return 'voided';
  if (refundedMinor >= amountMinor) return 'refunded';
  if (refundedMinor > 0) return 'partially_refunded';
  return 'standing';
}

function presentTransaction(r: TxRow): TransactionDto {
  const amount = Number(r.amount_minor);
  const refunded = Number(r.refunded_minor);
  const card = r.method === 'card';
  return {
    id: r.id,
    status: transactionStatus(amount, refunded, r.voided_at !== null),
    method: r.method,
    amountMinor: amount,
    refundedMinor: refunded,
    currency: r.currency,
    paidOn: day(r.paid_on),
    recordedAt: r.recorded_at.toISOString(),
    family: r.family_id ? { id: r.family_id, name: r.family_name ?? '' } : null,
    trialId: r.family_id ? null : r.trial_lesson_id,
    child: r.learner_id ? { id: r.learner_id, name: r.learner_name ?? r.child_name ?? '' } : r.child_name ? { id: null, name: r.child_name } : null,
    request: r.request_id ? { id: r.request_id, label: r.request_label ?? '', purpose: r.request_purpose ?? 'other', planMonths: r.plan_months } : null,
    instalmentId: r.instalment_id,
    invoice: r.invoice_id ? { id: r.invoice_id, number: r.invoice_number ?? '' } : null,
    reference: r.reference,
    recordedBy: r.recorded_by ? { id: r.recorded_by, name: r.recorder_name ?? '' } : null,
    card: card && (r.card_brand || r.card_last4) ? { brand: r.card_brand, last4: r.card_last4, wallet: r.card_wallet } : null,
    stripe: card
      ? {
          checkoutSessionId: r.stripe_checkout_session_id,
          paymentIntentId: r.stripe_payment_intent_id,
          chargeId: r.stripe_charge_id,
          customerId: r.stripe_customer_id,
          livemode: r.stripe_checkout_session_id ? !r.stripe_checkout_session_id.startsWith('cs_test_') : null,
        }
      : null,
  };
}

interface AttemptRow {
  stripe_session_id: string;
  status: string;
  amount_minor: bigint;
  currency: string;
  created_at: Date;
  expires_at: Date;
  failure_count: number;
  failure_code: string | null;
  last_failed_at: Date | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  request_id: string;
  request_label: string;
  request_purpose: string;
  family_id: string | null;
  family_name: string | null;
  trial_lesson_id: string | null;
  payment_id: string | null;
}

function presentAttempt(a: {
  stripeSessionId: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
  expiresAt: Date;
  failureCount: number;
  failureCode: string | null;
  lastFailedAt: Date | null;
  stripePaymentIntentId: string | null;
  stripeCustomerId: string | null;
}) {
  return {
    sessionId: a.stripeSessionId,
    status: a.status,
    amountMinor: Number(a.amountMinor),
    currency: a.currency,
    createdAt: a.createdAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    failureCount: a.failureCount,
    failureCode: a.failureCode,
    lastFailedAt: a.lastFailedAt?.toISOString() ?? null,
    paymentIntentId: a.stripePaymentIntentId,
    customerId: a.stripeCustomerId,
  };
}

function presentEvent(e: {
  id: string;
  type: string;
  livemode: boolean;
  receivedAt: Date;
  outcome: string;
  objectId: string | null;
  paymentIntentId: string | null;
  stripeCreatedAt: Date | null;
}) {
  return {
    id: e.id,
    type: e.type,
    livemode: e.livemode,
    receivedAt: e.receivedAt.toISOString(),
    stripeCreatedAt: e.stripeCreatedAt?.toISOString() ?? null,
    outcome: e.outcome,
    objectId: e.objectId,
    paymentIntentId: e.paymentIntentId,
  };
}

// ---- parsing --------------------------------------------------------------

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function optionalDay(v: unknown, name: string): string | null {
  const s = str(v);
  if (s === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw invalid(`${name}: YYYY-MM-DD`);
  return s;
}

function parseLimit(v: unknown): number {
  const s = str(v);
  if (s === null) return DEFAULT_LIMIT;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw invalid(`limit: 1-${MAX_LIMIT}`);
  return n;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/** `validId`: the id column's own shape (a payment's uuid), so a crafted cursor is a 400, never a failed cast. */
export function parseCursor(v: unknown, validId: (id: string) => boolean = (id) => /^[A-Za-z0-9_]{1,255}$/.test(id)): { at: string; id: string } | null {
  const s = str(v);
  if (s === null) return null;
  const raw = Buffer.from(s, 'base64url').toString('utf8');
  const [at, id, extra] = raw.split('|');
  if (extra !== undefined || !at || !id || Number.isNaN(Date.parse(at)) || !validId(id)) throw invalid('cursor');
  return { at, id };
}

function invalid(message: string): CommError {
  return new CommError(CommErrorCode.VALIDATION, message, 400);
}

function notFound(): CommError {
  return new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment not found', 404);
}
