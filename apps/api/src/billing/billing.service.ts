import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import {
  decideBillingAccess,
  type BillingAccess,
  type OperationsDepartmentRole,
} from '../platform/pd012-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { mapStructureRefusal } from '../org/org-structure.service';
import { todayIn } from '../leave/leave.service';
import { CORE_INVOICE_SOURCE, CoreInvoiceSourceError, type CoreInvoiceSource } from './core-invoice-source';
import { compareInstalments, daysFrom, statusOf, type InstalmentStatus } from './instalment';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
const RESPONSIBLE = ['all', 'me', 'none'] as const;
type Responsible = (typeof RESPONSIBLE)[number];

type FamilyRow = {
  id: string;
  core_parent_id: string;
  family_name: string;
  account_name: string | null;
  billing_supervisor_id: string | null;
};
type ChildRow = { id: string; family_id: string; core_child_id: string; name: string; supervisor_id: string | null };

export interface InstalmentRow {
  /** Core's invoice id. */
  id: string;
  family: { id: string; name: string };
  /** The payer: the family's Core parent, by their display name in Chat. */
  account: { name: string };
  /** null = a family invoice. `known: false` = Core named a child Chat does not have in this family. */
  child: { id: string | null; name: string | null; known: boolean } | null;
  amountMinor: number;
  currency: string;
  dueDate: string;
  status: InstalmentStatus;
  /** overdue: days late; upcoming: days until due; due today and paid: 0 or days until the due date. */
  days: number;
  paidAt: string | null;
  label: string | null;
  responsibleSupervisor: { id: string; name: string } | null;
  /** Where the responsible supervisor came from: the child's PD-8 supervisor, or the family's billing supervisor. */
  responsibleBasis: 'child' | 'family';
  /** The family's direct conversation this viewer may open, if any. */
  conversationId: string | null;
}

/**
 * PD-12 S3: Instalment Payments.
 *
 * Invoices are Jawwid Core's: read at request time through CoreInvoiceSource,
 * for the families this viewer may see, and never written anywhere in Chat --
 * not to a table, not to a cache, not to a log line. What Chat adds is its own:
 * who the payer is by name, which child, the responsible supervisor (the
 * child's PD-8 supervisor, or the family's billing supervisor for a family
 * invoice), and the conversation the follow-up happens in. Paying stays in Core.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(CORE_INVOICE_SOURCE) private readonly core: CoreInvoiceSource,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** The navigation probe: may this staff member open Instalment Payments at all? */
  async access(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const access = await this.accessOf(actor);
    return {
      billingReader: access.scope !== null,
      canAssignBillingSupervisor: access.canAssign,
      coreConnected: this.core.connected,
    };
  }

  /**
   * The instalments of the families in the viewer's scope, in PD-12 order.
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

    if (!this.core.connected) {
      return { source: 'not_connected' as const, today, canAssignBillingSupervisor: access.canAssign, items: [], counts: emptyCounts() };
    }

    const families = await this.familiesInScope(actor, access, org);
    if (families.length === 0) {
      return { source: 'core' as const, today, canAssignBillingSupervisor: access.canAssign, items: [], counts: emptyCounts() };
    }

    let invoices;
    try {
      invoices = await this.core.invoicesFor(
        families.map((f) => f.core_parent_id),
        { includePaid },
      );
    } catch (e) {
      if (e instanceof CoreInvoiceSourceError) {
        throw new CommError(CommErrorCode.BILLING_CORE_UNAVAILABLE, e.message, 502);
      }
      throw e;
    }

    const familyByParent = new Map(families.map((f) => [f.core_parent_id, f]));
    const familyIds = families.map((f) => f.id);
    const children = await this.prisma.$queryRaw<ChildRow[]>`
      SELECT l.id, l.family_id, l.core_child_id::text AS core_child_id, l.name, ls.supervisor_id
        FROM chat.learner l
        LEFT JOIN chat.learner_supervision ls ON ls.learner_id = l.id
       WHERE l.family_id = ANY(${familyIds}::uuid[]) AND l.core_child_id IS NOT NULL`;
    // Keyed by family AND Core child: a child id is honoured only inside the
    // family the invoice's payer belongs to.
    const childOf = new Map(children.map((c) => [`${c.family_id}:${c.core_child_id}`, c]));

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
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: [...staffIds] }, organizationId: org },
      select: { id: true, name: true },
    });
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    const person = (id: string | null) => (id ? { id, name: staffName.get(id) ?? '' } : null);

    const rows: InstalmentRow[] = [];
    for (const inv of invoices) {
      const family = familyByParent.get(inv.parentId);
      if (!family) continue;
      const child = inv.childId ? childOf.get(`${family.id}:${inv.childId}`) ?? null : null;
      const basis: 'child' | 'family' = inv.childId ? 'child' : 'family';
      const responsibleId = inv.childId ? child?.supervisor_id ?? null : family.billing_supervisor_id;
      const status = statusOf(inv, today);
      rows.push({
        id: inv.id,
        family: { id: family.id, name: family.family_name },
        account: { name: family.account_name ?? family.family_name },
        child: inv.childId ? { id: child?.id ?? null, name: child?.name ?? null, known: child !== null } : null,
        amountMinor: inv.amountMinor,
        currency: inv.currency,
        dueDate: inv.dueDate,
        status,
        days: status === 'overdue' ? -daysFrom(today, inv.dueDate) : Math.max(0, daysFrom(today, inv.dueDate)),
        paidAt: inv.paidAt,
        label: inv.label,
        responsibleSupervisor: person(responsibleId),
        responsibleBasis: basis,
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
    return { source: 'core' as const, today, canAssignBillingSupervisor: access.canAssign, items, counts };
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

  private async accessOf(actor: Actor): Promise<BillingAccess> {
    const rows = await this.prisma.$queryRaw<{ role: OperationsDepartmentRole }[]>`
      SELECT chat.operations_department_role(${actor.actorId}::uuid) AS role`;
    return decideBillingAccess(actor, rows[0]?.role ?? null);
  }

  private async requireReader(actorId: string): Promise<{ actor: Actor; access: BillingAccess }> {
    const actor = await this.conversations.requireActor(actorId);
    const access = await this.accessOf(actor);
    if (access.scope === null) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'instalments are read by the Operations department');
    }
    return { actor, access };
  }

  /** The families the viewer may see that Core knows (a family with no Core parent has no invoices). */
  private familiesInScope(actor: Actor, access: BillingAccess, org: string): Promise<FamilyRow[]> {
    const reach = access.scope === 'reach';
    return this.prisma.$queryRaw<FamilyRow[]>`
      SELECT f.id, f.core_parent_id::text AS core_parent_id, f.display_name AS family_name,
             pc.name AS account_name, b.supervisor_id AS billing_supervisor_id
        FROM chat.family f
        LEFT JOIN chat.contact pc ON pc.id = f.primary_contact_id AND pc.family_id = f.id
        LEFT JOIN chat.family_billing_supervision b ON b.family_id = f.id
       WHERE f.organization_id = ${org}::uuid
         AND f.core_parent_id IS NOT NULL
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

