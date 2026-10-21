import { Inject, Injectable } from '@nestjs/common';
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

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
const RESPONSIBLE = ['all', 'me', 'none'] as const;
type Responsible = (typeof RESPONSIBLE)[number];
export const PAYMENT_METHODS = ['invoice', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
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
  createdAt: string;
  createdBy: { id: string; name: string };
  payment: { paidOn: string; method: PaymentMethod; reference: string | null; recordedAt: string; recordedBy: { id: string; name: string } } | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** The navigation probe: may this staff member open Instalment Payments (and Parent Profiles) at all? */
  async access(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const access = await this.accessOf(actor);
    return {
      billingReader: access.scope !== null,
      canAssignBillingSupervisor: access.canAssign,
      canRecordPayments: access.canRecord,
    };
  }

  /**
   * The open (and, with paid=true, paid) instalments of the families in the
   * viewer's scope, in PD-12 order. Voided rows are history only: the family's
   * timeline shows them, this queue does not.
   * `responsible`: all (default), me (I am the responsible supervisor), none
   * (no responsible supervisor -- the manager's "No billing supervisor" list).
   */
  async list(actorId: string, query: { responsible?: string; paid?: string }) {
    const { actor, access } = await this.requireReader(actorId);
    const responsible = (query.responsible ?? 'all') as Responsible;
    if (!RESPONSIBLE.includes(responsible)) throw invalid('responsible: all | me | none');
    const includePaid = query.paid === 'true' || query.paid === '1';
    const org = actor.organizationId as string;
    const today = todayIn(await this.timeZone());

    const families = await this.familiesInScope(actor, access, org);
    if (families.length === 0) {
      return { today, canAssignBillingSupervisor: access.canAssign, items: [], counts: emptyCounts() };
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
      });
    }

    const counts = emptyCounts();
    for (const r of rows) {
      counts[r.status] += 1;
      if (!r.responsibleSupervisor && r.status !== 'paid') counts.unassigned += 1;
    }
    const items = rows
      .filter((r) =>
        responsible === 'me'
          ? r.responsibleSupervisor?.id === actor.actorId
          : responsible === 'none'
            ? r.responsibleSupervisor === null
            : true,
      )
      .sort(compareInstalments);
    return { today, canAssignBillingSupervisor: access.canAssign, items, counts };
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
    const next: { paymentMethod?: PaymentMethod | null; currency?: string | null } = {};
    let planMonths: number | null | undefined;
    if ('paymentMethod' in body) {
      const v = body.paymentMethod;
      if (v !== null && !PAYMENT_METHODS.includes(v as PaymentMethod)) throw invalid('paymentMethod: invoice | bank_transfer, or null');
      next.paymentMethod = v as PaymentMethod | null;
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
   * One instalment, or a plan of `count` instalments `everyMonths` apart.
   * { label, amountMinor, firstDueDate, currency?, count?, everyMonths?, learnerId? }
   * The currency defaults to the family's.
   */
  async createInstalments(actorId: string, familyId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const family = await this.requireFamily(actor, access, familyId);
    const label = requireText('label', body.label, 100);
    const amountMinor = body.amountMinor;
    if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 1_000_000_000_000) {
      throw invalid('amountMinor: a positive whole amount in minor units (e.g. cents)');
    }
    const firstDueDate = requireDate('firstDueDate', body.firstDueDate);
    const count = body.count === undefined ? 1 : body.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_PLAN) {
      throw invalid(`count: 1 to ${MAX_PLAN}`);
    }
    const everyMonths = body.everyMonths === undefined ? 1 : body.everyMonths;
    if (typeof everyMonths !== 'number' || !Number.isInteger(everyMonths) || everyMonths < 1 || everyMonths > 12) {
      throw invalid('everyMonths: 1 to 12');
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

    const planId = count > 1 ? randomUUID() : null;
    const rows = Array.from({ length: count }, (_, i) => ({
      familyId: family.id,
      learnerId,
      planId,
      label: count > 1 ? `${label} · ${i + 1}/${count}` : label,
      amountMinor: BigInt(amountMinor),
      currency,
      dueDate: new Date(`${addMonths(firstDueDate, i * everyMonths)}T00:00:00Z`),
      createdBy: actor.actorId,
    }));
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await tx.familyInstalment.createMany({ data: rows });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'instalment.created',
        entity: 'family',
        entityId: family.id,
        after: { planId, count, everyMonths, amountMinor, currency, firstDueDate, learnerId, label },
        reason: count > 1 ? 'instalment plan created' : 'instalment created',
      });
    });
    return this.presentFamily(actor, access, family.id);
  }

  /** { paidOn: YYYY-MM-DD (not after today), method?: invoice | bank_transfer, reference? } -- once. */
  async recordPayment(actorId: string, instalmentId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const inv = await this.requireInstalment(actor, access, instalmentId);
    const paidOn = requireDate('paidOn', body.paidOn);
    const today = todayIn(await this.timeZone());
    if (paidOn > today) throw invalid('paidOn: a payment is recorded once it arrived, not ahead of time');
    let method = body.method as PaymentMethod | undefined;
    if (method === undefined || method === null) {
      method = ((await this.prisma.familyBilling.findUnique({ where: { familyId: inv.familyId } }))?.paymentMethod ?? undefined) as PaymentMethod | undefined;
    }
    if (!method || !PAYMENT_METHODS.includes(method)) throw invalid('method: invoice | bank_transfer');
    const reference = body.reference === undefined || body.reference === null || body.reference === ''
      ? null
      : requireText('reference', body.reference, 120);

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const changed = await tx.familyInstalment.updateMany({
        where: { id: inv.id, paidOn: null, voidedAt: null },
        data: {
          paidOn: new Date(`${paidOn}T00:00:00Z`),
          paidMethod: method,
          paidReference: reference,
          paidRecordedBy: actor.actorId,
          paidRecordedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already paid or voided', 409);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'instalment.paid',
        entity: 'family',
        entityId: inv.familyId,
        after: { instalmentId: inv.id, paidOn, method, amountMinor: Number(inv.amountMinor), currency: inv.currency },
        reason: 'payment recorded',
      });
    });
    return this.presentFamily(actor, access, inv.familyId);
  }

  /** { reason } -- final. A wrong amount or a payment recorded by mistake is voided and written again. */
  async voidInstalment(actorId: string, instalmentId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireRecorder(actorId);
    const inv = await this.requireInstalment(actor, access, instalmentId);
    const reason = requireText('reason', body.reason, 500);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
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
        before: { instalmentId: inv.id, paid: inv.paidOn !== null, amountMinor: Number(inv.amountMinor), currency: inv.currency },
        reason,
      });
    });
    return this.presentFamily(actor, access, inv.familyId);
  }

  private async presentFamily(actor: Actor, access: BillingAccess, familyId: string) {
    const org = actor.organizationId as string;
    const today = todayIn(await this.timeZone());
    const [family, billing, instalments] = await Promise.all([
      this.prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { id: true, subscriptionPlanMonths: true } }),
      this.prisma.familyBilling.findUnique({ where: { familyId } }),
      this.prisma.familyInstalment.findMany({ where: { familyId, organizationId: org }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const learnerIds = [...new Set(instalments.flatMap((i) => (i.learnerId ? [i.learnerId] : [])))];
    const learners = await this.prisma.learner.findMany({ where: { id: { in: learnerIds } }, select: { id: true, name: true } });
    const learnerName = new Map(learners.map((l) => [l.id, l.name]));
    const staffName = await this.staffNames(
      org,
      instalments.flatMap((i) => [i.createdBy, ...(i.paidRecordedBy ? [i.paidRecordedBy] : []), ...(i.voidedBy ? [i.voidedBy] : [])]),
    );
    const person = (id: string) => ({ id, name: staffName.get(id) ?? '' });

    const timeline: TimelineInstalment[] = instalments.map((i) => present(i, today, learnerName, person));
    // Per currency: what has been paid, what is still owed, and how much of that is late.
    const totals = new Map<string, { currency: string; paidMinor: number; outstandingMinor: number; overdueMinor: number }>();
    for (const t of timeline) {
      if (t.status === 'voided') continue;
      const sum = totals.get(t.currency) ?? { currency: t.currency, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0 };
      if (t.status === 'paid') sum.paidMinor += t.amountMinor;
      else sum.outstandingMinor += t.amountMinor;
      if (t.status === 'overdue') sum.overdueMinor += t.amountMinor;
      totals.set(t.currency, sum);
    }
    return {
      familyId: family.id,
      today,
      paymentMethod: (billing?.paymentMethod ?? null) as PaymentMethod | null,
      currency: billing?.currency ?? null,
      planMonths: family.subscriptionPlanMonths,
      instalments: timeline,
      totals: [...totals.values()],
      // Operations and Sales record (PD-17); the client hides nothing the server would refuse.
      canRecord: access.canRecord,
    };
  }

  /**
   * PD-17: the parents' own payments, for the app's Settings > Payments. Every
   * active parent of the family reads them (owner, 2026-10-21: "both parents"),
   * not only the one holding the billing permission -- reading is not managing,
   * and paying is still recorded by staff. The family is the caller's own;
   * nothing here takes a family id. Voided rows, void reasons, who recorded what
   * and every internal note stay staff-side.
   */
  async mine(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const denied = () => new CommError(CommErrorCode.BILLING_DENIED, 'payments are shown to the family\'s parents');
    if (actor.kind !== 'contact' || !actor.isActive || !actor.familyId) throw denied();
    const contact = await this.prisma.contact.findUnique({
      where: { id: actor.actorId },
      select: { familyId: true, organizationId: true, isActive: true },
    });
    if (!contact || !contact.isActive || contact.familyId !== actor.familyId) throw denied();
    const today = todayIn(await this.timeZone());
    const [family, billing, rows] = await Promise.all([
      this.prisma.family.findUniqueOrThrow({ where: { id: contact.familyId }, select: { subscriptionPlanMonths: true } }),
      this.prisma.familyBilling.findUnique({ where: { familyId: contact.familyId } }),
      this.prisma.familyInstalment.findMany({
        where: { familyId: contact.familyId, organizationId: contact.organizationId, voidedAt: null },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    const learnerIds = [...new Set(rows.flatMap((i) => (i.learnerId ? [i.learnerId] : [])))];
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: learnerIds }, familyId: contact.familyId },
      select: { id: true, name: true },
    });
    const learnerName = new Map(learners.map((l) => [l.id, l.name]));
    const instalments = rows.map((i) => {
      const dueDate = day(i.dueDate);
      const status = statusOf({ status: i.paidOn ? 'paid' : 'open', dueDate }, today);
      return {
        id: i.id,
        label: i.label,
        child: i.learnerId ? { id: i.learnerId, name: learnerName.get(i.learnerId) ?? '' } : null,
        amountMinor: Number(i.amountMinor),
        currency: i.currency,
        dueDate,
        status,
        days: status === 'overdue' ? -daysFrom(today, dueDate) : Math.max(0, daysFrom(today, dueDate)),
        payment:
          i.paidOn && i.paidMethod
            ? { paidOn: day(i.paidOn), method: i.paidMethod as PaymentMethod, reference: i.paidReference }
            : null,
      };
    });
    const totals = new Map<string, { currency: string; paidMinor: number; outstandingMinor: number; overdueMinor: number }>();
    for (const t of instalments) {
      const sum = totals.get(t.currency) ?? { currency: t.currency, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0 };
      if (t.status === 'paid') sum.paidMinor += t.amountMinor;
      else sum.outstandingMinor += t.amountMinor;
      if (t.status === 'overdue') sum.overdueMinor += t.amountMinor;
      totals.set(t.currency, sum);
    }
    return {
      today,
      paymentMethod: (billing?.paymentMethod ?? null) as PaymentMethod | null,
      currency: billing?.currency ?? null,
      planMonths: family.subscriptionPlanMonths,
      instalments,
      totals: [...totals.values()],
    };
  }

  private async requireInstalment(actor: Actor, access: BillingAccess, instalmentId: string): Promise<FamilyInstalment> {
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

  private accessOf(actor: Actor): Promise<BillingAccess> {
    return billingAccessOf(this.prisma, actor);
  }

  /** PD-17: Operations (in scope), Sales and the super admin record money. */
  private async requireRecorder(actorId: string): Promise<{ actor: Actor; access: BillingAccess }> {
    const { actor, access } = await this.requireReader(actorId);
    if (!access.canRecord) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'payments are recorded by the Operations and Sales departments');
    }
    return { actor, access };
  }

  private async requireReader(actorId: string): Promise<{ actor: Actor; access: BillingAccess }> {
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

  private async requireFamily(actor: Actor, access: BillingAccess, familyId: string) {
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

  private async timeZone(): Promise<string> {
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
  return { overdue: 0, due: 0, upcoming: 0, paid: 0, unassigned: 0 };
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(`${field}: must be a uuid`);
  return (value as string).toLowerCase();
}

function requireText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(`${field}: is required`);
  if (value.trim().length > max) throw invalid(`${field}: must be at most ${max} characters`);
  return value.trim();
}

function requireDate(field: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw invalid(`${field}: YYYY-MM-DD`);
  }
  return value;
}

function requireCurrency(value: unknown): string {
  const c = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!CURRENCY_RE.test(c)) throw invalid('currency: a three-letter ISO 4217 code, e.g. AED');
  return c;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function present(
  i: FamilyInstalment,
  today: string,
  learnerName: Map<string, string>,
  person: (id: string) => { id: string; name: string },
): TimelineInstalment {
  const dueDate = day(i.dueDate);
  const status = i.voidedAt ? 'voided' : statusOf({ status: i.paidOn ? 'paid' : 'open', dueDate }, today);
  return {
    id: i.id,
    planId: i.planId,
    label: i.label,
    child: i.learnerId ? { id: i.learnerId, name: learnerName.get(i.learnerId) ?? '' } : null,
    amountMinor: Number(i.amountMinor),
    currency: i.currency,
    dueDate,
    status,
    days: status === 'overdue' ? -daysFrom(today, dueDate) : Math.max(0, daysFrom(today, dueDate)),
    createdAt: i.createdAt.toISOString(),
    createdBy: person(i.createdBy),
    payment:
      i.paidOn && i.paidMethod && i.paidRecordedAt && i.paidRecordedBy
        ? {
            paidOn: day(i.paidOn),
            method: i.paidMethod as PaymentMethod,
            reference: i.paidReference,
            recordedAt: i.paidRecordedAt.toISOString(),
            recordedBy: person(i.paidRecordedBy),
          }
        : null,
    void: i.voidedAt && i.voidedBy && i.voidReason ? { at: i.voidedAt.toISOString(), by: person(i.voidedBy), reason: i.voidReason } : null,
  };
}
