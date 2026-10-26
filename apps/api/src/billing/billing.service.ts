import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FamilyInstalment } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { BillingAccess } from '../platform/pd012-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { SUBSCRIPTION_PLAN_MONTHS } from '../communication/contracts/vocab';
import { mapStructureRefusal } from '../org/org-structure.service';
import { todayIn } from '../leave/leave.service';
import { billingAccessOf } from './billing-access';
import { addMonths, compareInstalments, daysFrom, statusOf, type InstalmentStatus } from './instalment';
import { day, invalid, requireAmount, requireCurrency, requireDate, requireText, requireUuid } from './validate';
import { BANK_ACCOUNT_KEY, PaymentLedger, type PaymentMethod } from './payment-ledger.service';
import { PaymentsReadService, type MoneyView } from './payments-read.service';
import { PaymentReminders } from './payment-reminders.service';
import { STRIPE_GATEWAY, StripeSdkGateway, type StripeGateway } from './stripe.gateway';
import { childSubscriptions, forParent } from './subscription-reads';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
const RESPONSIBLE = ['all', 'me', 'none'] as const;
type Responsible = (typeof RESPONSIBLE)[number];
/** PD-17's family-level "how this family pays" (chat.family_billing.payment_method). */
export const FAMILY_PAYMENT_METHODS = ['invoice', 'bank_transfer'] as const;
export type FamilyPaymentMethod = (typeof FAMILY_PAYMENT_METHODS)[number];
/** What staff may name when marking an instalment paid in one go (PD-17 route). */
const INSTALMENT_PAYMENT_METHODS = ['invoice', 'bank_transfer', 'cash'] as const;
const MAX_PLAN = 24;

type FamilyRow = {
  id: string;
  family_name: string;
  parent_id: string | null;
  account_name: string | null;
  billing_supervisor_id: string | null;
};
type ChildRow = { id: string; family_id: string; name: string; supervisor_id: string | null };

export interface InstalmentRow {
  id: string;
  family: { id: string; name: string };
  /** The payer: the family's primary parent, whose Parent Profile the row links to. */
  account: { id: string | null; name: string };
  /** null = a family instalment. */
  child: { id: string | null; name: string | null; known: boolean } | null;
  amountMinor: number;
  currency: string;
  dueDate: string;
  status: InstalmentStatus;
  /** overdue: days late; upcoming: days until due; due today and paid: 0 or days until the due date. */
  days: number;
  /** The day the payment arrived. */
  paidAt: string | null;
  label: string | null;
  responsibleSupervisor: { id: string; name: string } | null;
  /** Where the responsible supervisor came from: the child's PD-8 supervisor, or the family's billing supervisor. */
  responsibleBasis: 'child' | 'family';
  /** The family's direct conversation this viewer may open, if any. */
  conversationId: string | null;
  /** PD-30: overdue, but due before the lock's go-live -- it never locks the group. */
  beforeGoLive: boolean;
}

/** One row of a family's payment timeline (PD-17). */
export interface TimelineInstalment {
  id: string;
  planId: string | null;
  label: string;
  child: { id: string; name: string } | null;
  amountMinor: number;
  currency: string;
  dueDate: string;
  status: InstalmentStatus | 'voided';
  days: number;
  /** PD-27: what its standing payments add up to; paid in part while open and > 0. */
  paidMinor: number;
  remainingMinor: number;
  partial: boolean;
  /** PD-27: its live payment link, if any. */
  requestId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  /** recordedBy null: a card payment completed it (Stripe confirmed it, no one typed it). */
  payment: { paidOn: string; method: PaymentMethod; reference: string | null; recordedAt: string; recordedBy: { id: string; name: string } | null } | null;
  void: { at: string; by: { id: string; name: string }; reason: string } | null;
}

/**
 * Instalment Payments (PD-12 S3) and the family's money (PD-17).
 *
 * PD-17 (owner, 2026-10-21): payments and instalment plans are Chat's own
 * records; nothing is read from Jawwid Core. An instalment is created alone or
 * as a plan, paid once, or voided with a reason -- never edited, never deleted
 * (chat.guard_family_instalment). Who reads and records is billingAccessOf:
 * the super admin and the Operations Manager every family, an Operations
 * supervisor the families they reach, the Sales department every family.
 * Never a teacher. A parent reads their own family's (`mine`).
 *
 * What Chat adds around each row: the payer by name, which child, the
 * responsible supervisor (the child's PD-8 supervisor, or the family's billing
 * supervisor for a family instalment), and the conversation the follow-up
 * happens in.
 */
@Injectable()
export class BillingService {
  private readonly ledger: PaymentLedger;
  private readonly reads: PaymentsReadService;
  private readonly stripe: StripeGateway;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // PD-27. Optional so suites that build this service by hand keep working;
    // the module always provides all four.
    @Optional() ledger?: PaymentLedger,
    @Optional() reads?: PaymentsReadService,
    @Optional() private readonly paymentReminders?: PaymentReminders,
    @Optional() @Inject(STRIPE_GATEWAY) stripe?: StripeGateway,
  ) {
    // Built by hand (older suites): the same ledger, without the pushes.
    this.ledger = ledger ?? new PaymentLedger(prisma, audit);
    this.reads = reads ?? new PaymentsReadService(prisma);
    this.stripe = stripe ?? new StripeSdkGateway();
  }

  /** The navigation probe: may this staff member open Instalment Payments (and Parent Profiles) at all? */
  async access(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const access = await this.accessOf(actor);
    return {
      billingReader: access.scope !== null,
      canAssignBillingSupervisor: access.canAssign,
      canRecordPayments: access.canRecord,
      canVerifyPayments: access.canVerify,
    };
  }

  /**
   * The open (and, with paid=true, paid) instalments of the families in the
   * viewer's scope, in PD-12 order. Voided rows are history only: the family's
   * timeline shows them, this queue does not.
   * `responsible`: all (default), me (I am the responsible supervisor), none
   * (no responsible supervisor -- the manager's "No billing supervisor" list).
   */
  async list(actorId: string, query: { responsible?: string; paid?: string; beforeGoLive?: string }) {
    const { actor, access } = await this.requireReader(actorId);
    const responsible = (query.responsible ?? 'all') as Responsible;
    if (!RESPONSIBLE.includes(responsible)) throw invalid('responsible: all | me | none');
    const includePaid = query.paid === 'true' || query.paid === '1';
    const beforeGoLive = query.beforeGoLive === 'true' || query.beforeGoLive === '1';
    const org = actor.organizationId as string;
    const today = todayIn(await this.timeZone());
    // PD-30: only instalments due from this day lock a group when overdue --
    // the day enforcement was first switched on; null until then (none locks).
    const lockFrom = (await this.prisma.$queryRaw<{ d: string | null }[]>`SELECT chat.pd030_overdue_from()::text AS d`)[0]?.d ?? null;

    const families = await this.familiesInScope(actor, access, org);
    if (families.length === 0) {
      return { today, lockFrom, canAssignBillingSupervisor: access.canAssign, items: [], counts: emptyCounts() };
    }
    const familyIds = families.map((f) => f.id);
    const familyById = new Map(families.map((f) => [f.id, f]));
    const instalments = await this.prisma.familyInstalment.findMany({
      where: {
        familyId: { in: familyIds },
        organizationId: org,
        voidedAt: null,
        ...(includePaid ? {} : { paidOn: null }),
      },
    });

    const children = await this.prisma.$queryRaw<ChildRow[]>`
      SELECT l.id, l.family_id, l.name, ls.supervisor_id
        FROM chat.learner l
        LEFT JOIN chat.learner_supervision ls ON ls.learner_id = l.id
       WHERE l.family_id = ANY(${familyIds}::uuid[])`;
    const childOf = new Map(children.map((c) => [c.id, c]));

    const conversations = await this.prisma.$queryRaw<{ family_id: string; id: string }[]>`
      SELECT DISTINCT ON (c.family_id) c.family_id, c.id
        FROM chat.conversation c
       WHERE c.family_id = ANY(${familyIds}::uuid[])
         AND c.type = 'direct' AND c.archived_at IS NULL
         AND chat.staff_conversation_access(${actor.actorId}::uuid, c.id) IS NOT NULL
       ORDER BY c.family_id, c.last_activity_at DESC`;
    const conversationOf = new Map(conversations.map((c) => [c.family_id, c.id]));

    const staffIds = new Set<string>();
    for (const f of families) if (f.billing_supervisor_id) staffIds.add(f.billing_supervisor_id);
    for (const c of children) if (c.supervisor_id) staffIds.add(c.supervisor_id);
    const staffName = await this.staffNames(org, [...staffIds]);
    const person = (id: string | null) => (id ? { id, name: staffName.get(id) ?? '' } : null);

    const rows: InstalmentRow[] = [];
    for (const inv of instalments) {
      const family = familyById.get(inv.familyId);
      if (!family) continue;
      const child = inv.learnerId ? childOf.get(inv.learnerId) ?? null : null;
      const responsibleId = inv.learnerId ? child?.supervisor_id ?? null : family.billing_supervisor_id;
      const dueDate = day(inv.dueDate);
      const status = statusOf({ status: inv.paidOn ? 'paid' : 'open', dueDate }, today);
      rows.push({
        id: inv.id,
        family: { id: family.id, name: family.family_name },
        account: { id: family.parent_id, name: family.account_name ?? family.family_name },
        child: inv.learnerId ? { id: child?.id ?? null, name: child?.name ?? null, known: child !== null } : null,
        amountMinor: Number(inv.amountMinor),
        currency: inv.currency,
        dueDate,
        status,
        days: status === 'overdue' ? -daysFrom(today, dueDate) : Math.max(0, daysFrom(today, dueDate)),
        paidAt: inv.paidOn ? day(inv.paidOn) : null,
        label: inv.label,
        responsibleSupervisor: person(responsibleId),
        responsibleBasis: inv.learnerId ? 'child' : 'family',
        conversationId: conversationOf.get(family.id) ?? null,
        beforeGoLive: status === 'overdue' && (lockFrom === null || dueDate < lockFrom),
      });
    }

    const counts = emptyCounts();
    for (const r of rows) {
      counts[r.status] += 1;
      if (!r.responsibleSupervisor && r.status !== 'paid') counts.unassigned += 1;
      if (r.beforeGoLive) counts.beforeGoLive += 1;
    }
    const items = rows
      .filter((r) => !beforeGoLive || r.beforeGoLive)
      .filter((r) =>
        responsible === 'me'
          ? r.responsibleSupervisor?.id === actor.actorId
          : responsible === 'none'
            ? r.responsibleSupervisor === null
            : true,
      )
      .sort(compareInstalments);
    return { today, lockFrom, canAssignBillingSupervisor: access.canAssign, items, counts };
  }

  // ------------------------------------------------------------------
  // PD-17: one family's money -- how it pays, its plan, its timeline
  // ------------------------------------------------------------------

  /** The family's payment method, plan and every instalment in date order, voided ones included. */
  async familyBilling(actorId: string, familyId: string) {
    const { actor, access } = await this.requireReader(actorId);
    const family = await this.requireFamily(actor, access, familyId);
    return this.presentFamily(actor, access, family.id);
  }

  /**
   * Partial: an absent field is left alone, null clears it.
   * { paymentMethod: invoice | bank_transfer, currency: ISO 4217, planMonths: 1 | 3 | 6 | 12 }
   */
  async setFamilyBilling(actorId: string, familyId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const family = await this.requireFamily(actor, access, familyId);
    const next: { paymentMethod?: FamilyPaymentMethod | null; currency?: string | null } = {};
    let planMonths: number | null | undefined;
    if ('paymentMethod' in body) {
      const v = body.paymentMethod;
      if (v !== null && !FAMILY_PAYMENT_METHODS.includes(v as FamilyPaymentMethod)) throw invalid('paymentMethod: invoice | bank_transfer, or null');
      next.paymentMethod = v as FamilyPaymentMethod | null;
    }
    if ('currency' in body) next.currency = body.currency === null ? null : requireCurrency(body.currency);
    if ('planMonths' in body) {
      const v = body.planMonths;
      if (v !== null && !(SUBSCRIPTION_PLAN_MONTHS as readonly unknown[]).includes(v)) throw invalid('planMonths: 1, 3, 6 or 12, or null');
      planMonths = v as number | null;
    }
    if (Object.keys(next).length === 0 && planMonths === undefined) return this.presentFamily(actor, access, family.id);

    const [before, beforeFamily] = await Promise.all([
      this.prisma.familyBilling.findUnique({ where: { familyId: family.id } }),
      this.prisma.family.findUniqueOrThrow({ where: { id: family.id }, select: { subscriptionPlanMonths: true } }),
    ]);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      if (Object.keys(next).length > 0) {
        await tx.familyBilling.upsert({
          where: { familyId: family.id },
          create: { familyId: family.id, organizationId: actor.organizationId as string, ...next, updatedBy: actor.actorId },
          update: { ...next, updatedBy: actor.actorId },
        });
      }
      if (planMonths !== undefined) {
        // The one plan column, shared with Stories targeting (20261017120000).
        await tx.family.update({
          where: { id: family.id },
          data: { subscriptionPlanMonths: planMonths, segmentSource: 'admin', segmentUpdatedAt: new Date() },
        });
      }
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'family.billing_set',
        entity: 'family',
        entityId: family.id,
        before: {
          paymentMethod: before?.paymentMethod ?? null,
          currency: before?.currency ?? null,
          planMonths: beforeFamily.subscriptionPlanMonths,
        },
        after: { ...next, ...(planMonths !== undefined ? { planMonths } : {}) },
        reason: 'set on the Parent Profile',
      });
    });
    return this.presentFamily(actor, access, family.id);
  }

  /**
   * One instalment, or a plan: `count` equal instalments `everyMonths` apart,
   * or (PD-27) a custom schedule `items: [{amountMinor, dueDate}]`.
   * { label, amountMinor, firstDueDate, currency?, count?, everyMonths?, learnerId? }
   * { label, items, currency?, learnerId? }
   * The currency defaults to the family's. Reminders are scheduled for each.
   */
  async createInstalments(actorId: string, familyId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const family = await this.requireFamily(actor, access, familyId);
    const label = requireText('label', body.label, 100);

    let schedule: { amountMinor: number; dueDate: string }[];
    let everyMonths: number | null = null;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_PLAN) {
        throw invalid(`items: 1 to ${MAX_PLAN} rows of { amountMinor, dueDate }`);
      }
      schedule = body.items.map((raw, i) => {
        const row = (raw ?? {}) as Record<string, unknown>;
        return { amountMinor: requireAmount(`items[${i}].amountMinor`, row.amountMinor), dueDate: requireDate(`items[${i}].dueDate`, row.dueDate) };
      });
      for (let i = 1; i < schedule.length; i++) {
        if ((schedule[i] as { dueDate: string }).dueDate < (schedule[i - 1] as { dueDate: string }).dueDate) {
          throw invalid('items: due dates in order, earliest first');
        }
      }
    } else {
      const amountMinor = requireAmount('amountMinor', body.amountMinor);
      const firstDueDate = requireDate('firstDueDate', body.firstDueDate);
      const count = body.count === undefined ? 1 : body.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_PLAN) {
        throw invalid(`count: 1 to ${MAX_PLAN}`);
      }
      const every = body.everyMonths === undefined ? 1 : body.everyMonths;
      if (typeof every !== 'number' || !Number.isInteger(every) || every < 1 || every > 12) {
        throw invalid('everyMonths: 1 to 12');
      }
      everyMonths = every;
      schedule = Array.from({ length: count }, (_, i) => ({ amountMinor, dueDate: addMonths(firstDueDate, i * every) }));
    }

    const billing = await this.prisma.familyBilling.findUnique({ where: { familyId: family.id } });
    const currency = body.currency === undefined || body.currency === null ? billing?.currency ?? null : requireCurrency(body.currency);
    if (!currency) throw invalid('currency: set the family\'s currency, or send one');
    let learnerId: string | null = null;
    if (body.learnerId !== undefined && body.learnerId !== null) {
      learnerId = requireUuid('learnerId', body.learnerId);
      const child = await this.prisma.learner.findFirst({ where: { id: learnerId, familyId: family.id }, select: { id: true } });
      if (!child) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'that child is not in this family');
    }
    // PD-30: a plan for a child's subscription credits its lessons when it is
    // created (owner, Q3); its instalments' due dates do the rest.
    let lessons: { lessonsIncluded: number; planMonths: number | null; startsOn: string } | null = null;
    if (body.lessonsIncluded !== undefined && body.lessonsIncluded !== null) {
      const n = body.lessonsIncluded;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 1000) throw invalid('lessonsIncluded: an integer from 1 to 1000');
      if (!learnerId) throw invalid('lessonsIncluded: name the child (learnerId) the lessons are for');
      const pm = body.planMonths;
      if (pm !== undefined && pm !== null && !(SUBSCRIPTION_PLAN_MONTHS as readonly unknown[]).includes(pm)) throw invalid('planMonths: 1, 3, 6 or 12');
      const startsOn = body.startsOn === undefined || body.startsOn === null
        ? (schedule[0] as { dueDate: string }).dueDate
        : requireDate('startsOn', body.startsOn);
      lessons = { lessonsIncluded: n, planMonths: (pm as number | null | undefined) ?? null, startsOn };
    }

    const count = schedule.length;
    const planId = count > 1 ? randomUUID() : null;
    const rows = schedule.map((item, i) => ({
      id: randomUUID(),
      familyId: family.id,
      learnerId,
      planId,
      label: count > 1 ? `${label} · ${i + 1}/${count}` : label,
      amountMinor: BigInt(item.amountMinor),
      currency,
      dueDate: new Date(`${item.dueDate}T00:00:00Z`),
      createdBy: actor.actorId,
    }));
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await tx.familyInstalment.createMany({ data: rows });
      if (lessons && learnerId) {
        await tx.learnerSubscription.create({
          data: {
            organizationId: actor.organizationId as string,
            learnerId,
            familyId: family.id,
            planMonths: lessons.planMonths,
            lessonsIncluded: lessons.lessonsIncluded,
            startsOn: new Date(`${lessons.startsOn}T00:00:00Z`),
            source: 'instalment_plan',
            planRef: planId ?? (rows[0] as { id: string }).id,
            createdBy: actor.actorId,
          },
        });
      }
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'instalment.created',
        entity: 'family',
        entityId: family.id,
        after: {
          planId,
          count,
          everyMonths,
          schedule: schedule.map((x) => ({ amountMinor: x.amountMinor, dueDate: x.dueDate })),
          currency,
          learnerId,
          label,
          ...(lessons ? { lessons } : {}),
        },
        reason: count > 1 ? 'instalment plan created' : 'instalment created',
      });
    });
    if (this.paymentReminders) {
      const created = await this.prisma.familyInstalment.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
      await this.paymentReminders.scheduleFor(created).catch(() => undefined);
    }
    return this.presentFamily(actor, access, family.id);
  }

  /**
   * PD-17's "this instalment is paid": { paidOn: YYYY-MM-DD (not after today),
   * method?: invoice | bank_transfer | cash, reference? }. Since PD-27 it records
   * a payment for everything the instalment still owes (through the ledger, so
   * an invoice is issued); a part payment is POST /families/:id/payments.
   */
  async recordPayment(actorId: string, instalmentId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const inv = await this.requireInstalment(actor, access, instalmentId);
    const paidOn = requireDate('paidOn', body.paidOn);
    const today = todayIn(await this.timeZone());
    if (paidOn > today) throw invalid('paidOn: a payment is recorded once it arrived, not ahead of time');
    let method = body.method as string | undefined | null;
    if (method === undefined || method === null) {
      method = (await this.prisma.familyBilling.findUnique({ where: { familyId: inv.familyId } }))?.paymentMethod ?? undefined;
    }
    if (!method || !(INSTALMENT_PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw invalid('method: invoice | bank_transfer | cash');
    }
    const reference = body.reference === undefined || body.reference === null || body.reference === ''
      ? null
      : requireText('reference', body.reference, 120);
    if (inv.paidOn || inv.voidedAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already paid or voided', 409);
    const ledger = this.requireLedger();

    const recorded = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const paid = await ledger.standingSum(tx, { instalmentId: inv.id });
      const remaining = Number(inv.amountMinor) - paid;
      if (remaining <= 0) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already covered', 409);
      const learner = inv.learnerId ? await tx.learner.findUnique({ where: { id: inv.learnerId }, select: { name: true } }) : null;
      return ledger.record(tx, {
        organizationId: inv.organizationId,
        familyId: inv.familyId,
        trialLessonId: null,
        learnerId: inv.learnerId,
        childName: learner?.name ?? null,
        requestId: null,
        instalmentId: inv.id,
        method: method as PaymentMethod,
        amountMinor: remaining,
        currency: inv.currency,
        paidOn,
        recordedBy: actor.actorId,
        reference,
        auditActorId: actor.actorId,
        auditReason: 'payment recorded',
      });
    }).catch((e) => { throw mapPaymentRefusal(e); });
    await ledger.afterRecorded(recorded);
    return this.presentFamily(actor, access, inv.familyId);
  }

  /**
   * { reason } -- final. A wrong amount or a payment recorded by mistake is
   * voided and written again. PD-27: its payments and their invoices are voided
   * with it, its live links cancelled, its reminders stopped -- unless a card
   * paid towards it: money Stripe took is refunded, never voided away.
   */
  async voidInstalment(actorId: string, instalmentId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const inv = await this.requireInstalment(actor, access, instalmentId);
    const reason = requireText('reason', body.reason, 500);
    const payments = await this.prisma.payment.findMany({ where: { instalmentId: inv.id, voidedAt: null } });
    if (payments.some((p) => p.method === 'card')) {
      throw new CommError(CommErrorCode.BILLING_STATE, 'a card paid towards this instalment; refund the card payment instead of voiding it', 409);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      for (const p of payments) await this.requireLedger().voidPayment(tx, p, actor.actorId, reason, { cascadeFromInstalment: true });
      await tx.paymentRequest.updateMany({
        where: { instalmentId: inv.id, paidAt: null, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledBy: actor.actorId, cancelReason: 'the instalment was voided' },
      });
      const changed = await tx.familyInstalment.updateMany({
        where: { id: inv.id, voidedAt: null },
        data: { voidedAt: new Date(), voidedBy: actor.actorId, voidReason: reason },
      });
      if (changed.count !== 1) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already voided', 409);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'instalment.voided',
        entity: 'family',
        entityId: inv.familyId,
        before: { instalmentId: inv.id, paid: inv.paidOn !== null, payments: payments.length, amountMinor: Number(inv.amountMinor), currency: inv.currency },
        reason,
      });
    });
    await this.paymentReminders?.cancelFor(inv.id);
    return this.presentFamily(actor, access, inv.familyId);
  }

  /** The family's money, as every staff route answers it (PD-17 + PD-27). */
  async presentFamily(actor: Actor, access: BillingAccess, familyId: string) {
    const org = actor.organizationId as string;
    const today = todayIn(await this.timeZone());
    const [family, billing, instalments, money] = await Promise.all([
      this.prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { id: true, subscriptionPlanMonths: true } }),
      this.prisma.familyBilling.findUnique({ where: { familyId } }),
      this.prisma.familyInstalment.findMany({ where: { familyId, organizationId: org }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
      this.reads.forFamily(familyId, org, { actorId: actor.actorId, staff: true }),
    ]);
    const learnerIds = [...new Set(instalments.flatMap((i) => (i.learnerId ? [i.learnerId] : [])))];
    const learners = await this.prisma.learner.findMany({ where: { id: { in: learnerIds } }, select: { id: true, name: true } });
    const learnerName = new Map(learners.map((l) => [l.id, l.name]));
    const staffName = await this.staffNames(
      org,
      instalments.flatMap((i) => [i.createdBy, ...(i.paidRecordedBy ? [i.paidRecordedBy] : []), ...(i.voidedBy ? [i.voidedBy] : [])]),
    );
    const person = (id: string) => ({ id, name: staffName.get(id) ?? '' });

    const timeline: TimelineInstalment[] = instalments.map((i) => present(i, today, learnerName, person, money));
    return {
      familyId: family.id,
      today,
      paymentMethod: (billing?.paymentMethod ?? null) as FamilyPaymentMethod | null,
      currency: billing?.currency ?? null,
      planMonths: family.subscriptionPlanMonths,
      instalments: timeline,
      totals: totalsOf(timeline),
      // Operations and Sales record (PD-17); the client hides nothing the server would refuse.
      canRecord: access.canRecord,
      // PD-27.
      canVerify: access.canVerify,
      cardAvailable: this.stripe.checkoutAvailable,
      requests: money.requests,
      payments: money.payments,
      invoices: money.invoices,
      receipts: money.receipts,
    };
  }

  /**
   * PD-17: the parents' own payments, for the app's Settings > Payments. Every
   * active parent of the family reads them (owner, 2026-10-21: "both parents"),
   * not only the one holding the billing permission. The family is the caller's
   * own; nothing here takes a family id. Voided rows, void reasons, who recorded
   * what and every internal note stay staff-side.
   *
   * PD-27 adds what the parent acts on: the open payment requests, the bank
   * details for a transfer, whether a card can be used, their receipts and
   * every invoice that stands.
   */
  async mine(actorId: string) {
    const { contact } = await this.requireParent(actorId);
    const today = todayIn(await this.timeZone());
    const [family, billing, rows, money, bank] = await Promise.all([
      this.prisma.family.findUniqueOrThrow({ where: { id: contact.familyId }, select: { subscriptionPlanMonths: true } }),
      this.prisma.familyBilling.findUnique({ where: { familyId: contact.familyId } }),
      this.prisma.familyInstalment.findMany({
        where: { familyId: contact.familyId, organizationId: contact.organizationId, voidedAt: null },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.reads.forFamily(contact.familyId, contact.organizationId, { actorId, staff: false }),
      this.prisma.config.findUnique({ where: { key: BANK_ACCOUNT_KEY } }),
    ]);
    const subscriptions = await this.subscriptionsForParent(contact.familyId, rows, money.requests);
    const learnerIds = [...new Set(rows.flatMap((i) => (i.learnerId ? [i.learnerId] : [])))];
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: learnerIds }, familyId: contact.familyId },
      select: { id: true, name: true },
    });
    const learnerName = new Map(learners.map((l) => [l.id, l.name]));
    const instalments = rows.map((i) => {
      const dueDate = day(i.dueDate);
      const status = statusOf({ status: i.paidOn ? 'paid' : 'open', dueDate }, today);
      const m = money.byInstalment.get(i.id);
      const paidMinor = i.paidOn ? Math.max(Number(i.amountMinor), m?.paidMinor ?? 0) : m?.paidMinor ?? 0;
      return {
        id: i.id,
        label: i.label,
        child: i.learnerId ? { id: i.learnerId, name: learnerName.get(i.learnerId) ?? '' } : null,
        amountMinor: Number(i.amountMinor),
        currency: i.currency,
        dueDate,
        status,
        days: status === 'overdue' ? -daysFrom(today, dueDate) : Math.max(0, daysFrom(today, dueDate)),
        paidMinor,
        remainingMinor: i.paidOn ? 0 : Math.max(0, Number(i.amountMinor) - paidMinor),
        partial: !i.paidOn && paidMinor > 0,
        requestId: i.paidOn ? null : m?.requestId ?? null,
        payment:
          i.paidOn && i.paidMethod
            ? { paidOn: day(i.paidOn), method: i.paidMethod as PaymentMethod, reference: i.paidReference }
            : null,
      };
    });
    return {
      today,
      paymentMethod: (billing?.paymentMethod ?? null) as FamilyPaymentMethod | null,
      currency: billing?.currency ?? null,
      planMonths: family.subscriptionPlanMonths,
      instalments,
      totals: totalsOf(instalments),
      requests: money.requests,
      invoices: money.invoices,
      receipts: money.receipts,
      bankAccount: parseBankAccount(bank?.value),
      cardAvailable: this.stripe.checkoutAvailable,
      subscriptions,
    };
  }

  /**
   * PD-30: each child's subscription as the parent sees it -- plan, lessons,
   * what is left, the grace lessons, whether the group is locked and why --
   * never an exception. `hasOpenPayment`: something can be paid for this child
   * now (an open instalment or request of the child or of the whole family);
   * without one the app offers "Request renewal" instead of Pay.
   */
  private async subscriptionsForParent(
    familyId: string,
    instalments: FamilyInstalment[],
    requests: Array<{ status: string; child: { id: string | null } | null }>,
  ) {
    const children = await childSubscriptions(this.prisma, familyId);
    const renewed = await this.prisma.$queryRaw<{ learner_id: string }[]>`
      SELECT learner_id::text FROM chat.renewal_request
       WHERE family_id = ${familyId}::uuid AND requested_on = chat.pd030_today()`;
    const askedToday = new Set(renewed.map((r) => r.learner_id));
    return children.map((c) => {
      const open = (id: string | null) => id === null || id === c.child.id;
      const hasOpenPayment =
        instalments.some((i) => !i.paidOn && !i.voidedAt && open(i.learnerId)) ||
        requests.some((r) => r.status === 'open' && open(r.child?.id ?? null));
      return { ...forParent(c), hasOpenPayment, renewalRequestedToday: askedToday.has(c.child.id) };
    });
  }

  /** The signed-in parent and their family (PD-17's rule: any active contact of it). */
  async requireParent(actorId: string): Promise<{ actor: Actor; contact: { id: string; familyId: string; organizationId: string } }> {
    const actor = await this.conversations.requireActor(actorId);
    const denied = () => new CommError(CommErrorCode.BILLING_DENIED, 'payments are shown to the family\'s parents');
    if (actor.kind !== 'contact' || !actor.isActive || !actor.familyId) throw denied();
    const contact = await this.prisma.contact.findUnique({
      where: { id: actor.actorId },
      select: { id: true, familyId: true, organizationId: true, isActive: true },
    });
    if (!contact || !contact.isActive || contact.familyId !== actor.familyId) throw denied();
    return { actor, contact: { id: contact.id, familyId: contact.familyId, organizationId: contact.organizationId } };
  }

  private requireLedger(): PaymentLedger {
    return this.ledger;
  }

  async requireInstalment(actor: Actor, access: BillingAccess, instalmentId: string): Promise<FamilyInstalment> {
    if (!isUuid(instalmentId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'instalment not found');
    const inv = await this.prisma.familyInstalment.findFirst({
      where: { id: instalmentId.toLowerCase(), organizationId: actor.organizationId as string },
    });
    if (!inv) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'instalment not found');
    await this.requireFamily(actor, access, inv.familyId);
    return inv;
  }

  private async staffNames(org: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: [...new Set(ids)] }, organizationId: org },
      select: { id: true, name: true },
    });
    return new Map(staff.map((s) => [s.id, s.name]));
  }

  // ------------------------------------------------------------------
  // The family billing supervisor (PD-8 assignment, family level)
  // ------------------------------------------------------------------

  /** The family's billing supervisor and who may be chosen: the supervisors of its children. */
  async billingSupervisor(actorId: string, familyId: string) {
    const { actor, access } = await this.requireReader(actorId);
    const family = await this.requireFamily(actor, access, familyId);
    const current = await this.prisma.familyBillingSupervision.findUnique({ where: { familyId: family.id } });
    const candidates = await this.prisma.$queryRaw<{ id: string; name: string; children: string[] }[]>`
      SELECT s.id, s.name, array_agg(l.name ORDER BY l.name) AS children
        FROM chat.learner l
        JOIN chat.learner_supervision ls ON ls.learner_id = l.id
        JOIN chat.staff s ON s.id = ls.supervisor_id
       WHERE l.family_id = ${family.id}::uuid
       GROUP BY s.id, s.name
       ORDER BY s.name`;
    const name = current ? candidates.find((c) => c.id === current.supervisorId)?.name ?? '' : null;
    return {
      familyId: family.id,
      current: current ? { id: current.supervisorId, name, assignedAt: current.assignedAt.toISOString() } : null,
      candidates,
      canAssign: access.canAssign,
    };
  }

  /**
   * Set (supervisorId) or clear (supervisorId: null) a family's billing
   * supervisor. The Operations Manager or the super admin, with a reason; the
   * database refuses anyone who does not supervise one of the family's children.
   */
  async setBillingSupervisor(actorId: string, familyId: string, body: { supervisorId?: unknown; reason?: unknown }) {
    const { actor, access } = await this.requireReader(actorId);
    if (!access.canAssign) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'the Operations Manager sets a family\'s billing supervisor');
    }
    const family = await this.requireFamily(actor, access, familyId);
    const supervisorId = body.supervisorId === null ? null : requireUuid('supervisorId', body.supervisorId);
    const reason = requireText('reason', body.reason, 500);
    const current = await this.prisma.familyBillingSupervision.findUnique({ where: { familyId: family.id } });
    if ((current?.supervisorId ?? null) === supervisorId) {
      return { familyId: family.id, supervisorId, changed: false };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.conversations.assertActorLive(tx, actor);
        if (supervisorId === null) {
          await tx.familyBillingSupervision.delete({ where: { familyId: family.id } });
        } else {
          await tx.familyBillingSupervision.upsert({
            where: { familyId: family.id },
            create: { familyId: family.id, organizationId: actor.organizationId as string, supervisorId, assignedBy: actor.actorId, reason },
            update: { supervisorId, assignedBy: actor.actorId, assignedAt: new Date(), reason },
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: supervisorId === null ? 'family.billing_supervisor_cleared' : 'family.billing_supervisor_set',
          entity: 'family',
          entityId: family.id,
          before: current ? { supervisorId: current.supervisorId } : undefined,
          after: supervisorId ? { supervisorId } : undefined,
          reason,
        });
      });
    } catch (e) {
      throw mapStructureRefusal(e);
    }
    return { familyId: family.id, supervisorId, changed: true };
  }

  // ------------------------------------------------------------------

  accessOf(actor: Actor): Promise<BillingAccess> {
    return billingAccessOf(this.prisma, actor);
  }

  /** PD-17: Operations (in scope), Sales and the super admin record money. */
  async requireRecorder(actorId: string): Promise<{ actor: Actor; access: BillingAccess }> {
    const { actor, access } = await this.requireReader(actorId);
    if (!access.canRecord) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'payments are recorded by the Operations and Sales departments');
    }
    return { actor, access };
  }

  async requireReader(actorId: string): Promise<{ actor: Actor; access: BillingAccess }> {
    const actor = await this.conversations.requireActor(actorId);
    const access = await this.accessOf(actor);
    if (access.scope === null) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'a family\'s money is the Operations department\'s');
    }
    return { actor, access };
  }

  /** The families the viewer may see. */
  private familiesInScope(actor: Actor, access: BillingAccess, org: string): Promise<FamilyRow[]> {
    const reach = access.scope === 'reach';
    return this.prisma.$queryRaw<FamilyRow[]>`
      SELECT f.id, f.display_name AS family_name, pc.id AS parent_id,
             pc.name AS account_name, b.supervisor_id AS billing_supervisor_id
        FROM chat.family f
        LEFT JOIN chat.contact pc ON pc.id = f.primary_contact_id AND pc.family_id = f.id
        LEFT JOIN chat.family_billing_supervision b ON b.family_id = f.id
       WHERE f.organization_id = ${org}::uuid
         AND (${!reach} OR chat.staff_reaches_family(${actor.actorId}::uuid, f.id) IS NOT NULL)`;
  }

  async requireFamily(actor: Actor, access: BillingAccess, familyId: string) {
    if (!isUuid(familyId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'family not found');
    const rows = await this.prisma.$queryRaw<{ id: string; reach: string | null }[]>`
      SELECT f.id, chat.staff_reaches_family(${actor.actorId}::uuid, f.id) AS reach
        FROM chat.family f
       WHERE f.id = ${familyId.toLowerCase()}::uuid AND f.organization_id = ${actor.organizationId as string}::uuid`;
    const f = rows[0];
    if (!f || (access.scope === 'reach' && f.reach === null)) {
      throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'family not found');
    }
    return f;
  }

  async timeZone(): Promise<string> {
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    const tz = typeof row?.value === 'string' ? row.value : DEFAULT_TIME_ZONE;
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }
}

function emptyCounts() {
  return { overdue: 0, due: 0, upcoming: 0, paid: 0, unassigned: 0, beforeGoLive: 0 };
}

function present(
  i: FamilyInstalment,
  today: string,
  learnerName: Map<string, string>,
  person: (id: string) => { id: string; name: string },
  money: MoneyView,
): TimelineInstalment {
  const dueDate = day(i.dueDate);
  const status = i.voidedAt ? 'voided' : statusOf({ status: i.paidOn ? 'paid' : 'open', dueDate }, today);
  const m = money.byInstalment.get(i.id);
  const amount = Number(i.amountMinor);
  // A PD-17 row paid before PD-27 has no payment rows: paid is its whole amount.
  const paidMinor = i.paidOn ? Math.max(amount, m?.paidMinor ?? 0) : i.voidedAt ? 0 : m?.paidMinor ?? 0;
  return {
    id: i.id,
    planId: i.planId,
    label: i.label,
    child: i.learnerId ? { id: i.learnerId, name: learnerName.get(i.learnerId) ?? '' } : null,
    amountMinor: amount,
    currency: i.currency,
    dueDate,
    status,
    days: status === 'overdue' ? -daysFrom(today, dueDate) : Math.max(0, daysFrom(today, dueDate)),
    paidMinor,
    remainingMinor: i.paidOn || i.voidedAt ? 0 : Math.max(0, amount - paidMinor),
    partial: !i.paidOn && !i.voidedAt && paidMinor > 0,
    requestId: i.paidOn || i.voidedAt ? null : m?.requestId ?? null,
    createdAt: i.createdAt.toISOString(),
    createdBy: person(i.createdBy),
    payment:
      i.paidOn && i.paidMethod && i.paidRecordedAt
        ? {
            paidOn: day(i.paidOn),
            method: i.paidMethod as PaymentMethod,
            reference: i.paidReference,
            recordedAt: i.paidRecordedAt.toISOString(),
            // null for a card payment: Stripe confirmed it.
            recordedBy: i.paidRecordedBy ? person(i.paidRecordedBy) : null,
          }
        : null,
    void: i.voidedAt && i.voidedBy && i.voidReason ? { at: i.voidedAt.toISOString(), by: person(i.voidedBy), reason: i.voidReason } : null,
  };
}

/** Per currency: what has been paid, what is still owed, and how much of that is late. Voided rows do not count. */
function totalsOf(rows: { status: string; amountMinor: number; currency: string; paidMinor: number; remainingMinor: number }[]) {
  const totals = new Map<string, { currency: string; paidMinor: number; outstandingMinor: number; overdueMinor: number }>();
  for (const t of rows) {
    if (t.status === 'voided') continue;
    const sum = totals.get(t.currency) ?? { currency: t.currency, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0 };
    sum.paidMinor += t.paidMinor;
    sum.outstandingMinor += t.remainingMinor;
    if (t.status === 'overdue') sum.overdueMinor += t.remainingMinor;
    totals.set(t.currency, sum);
  }
  return [...totals.values()];
}

export interface BankAccount {
  bankName: string | null;
  accountName: string;
  iban: string | null;
  accountNumber: string | null;
  swift: string | null;
  note: string | null;
}

export function parseBankAccount(value: unknown): BankAccount | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const text = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  const accountName = text('accountName');
  if (!accountName) return null;
  return { bankName: text('bankName'), accountName, iban: text('iban'), accountNumber: text('accountNumber'), swift: text('swift'), note: text('note') };
}

/**
 * A PD-27 database guard's refusal (chat.guard_payment*, raised as a check or
 * privilege violation) read as the 409 it is. The guards' sentences are written
 * for people, so the first line is passed on; anything else is rethrown.
 */
const GUARD_PHRASES = ['never changes', 'is final', 'stays paid', 'stays cancelled', 'never exceed', 'is not refunded', 'that stands', 'only once', 'pays an open instalment'];
export function mapPaymentRefusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const text = String((e as { message?: string })?.message ?? '');
  if (!GUARD_PHRASES.some((k) => text.includes(k))) return e;
  const line = GUARD_PHRASES.map((k) => text.split('\n').find((l) => l.includes(k))).find(Boolean) ?? '';
  const sentence = line.replace(/^.*?(?:ERROR:|message:|`)\s*/, '').replace(/[`"].*$/, '').trim();
  return new CommError(CommErrorCode.BILLING_STATE, sentence || 'that payment record cannot change that way', 409);
}
