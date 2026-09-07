import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { actorHasPermission, isFamilyFacingStaff, type Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { ORGANIZATION_WIDE_STAFF_ROLES } from '../contracts/vocab';

export interface CommandCenterKpis {
  unansweredMessages: number;
  pendingApprovals: number;
  escalatedApprovals: number;
  openConversations: number;
  closedConversations: number;
  activeFamilies: number;
  calls: number;
  missedClassCalls: number;
  /** The trailing window the two call figures were counted over. */
  windowHours: number;
  /** When these numbers were computed. Rendered as "as of 14:22". */
  asOf: string;
}

/** ok | warning | overloaded. Three levels, and no fourth. */
export type OverloadLevel = 'ok' | 'warning' | 'overloaded';

export interface SupervisorLoad {
  staffId: string;
  name: string;
  role: string;
  presence: string;
  families: number;
  openConversations: number;
  unanswered: number;
  unreadMessages: number;
  pendingApprovals: number;
  escalated: number;
  oldestWaitMs: number;
  overload: OverloadLevel;
  /**
   * WHY this level, in the operator's words.
   *
   * Never omitted. A badge without its justification is an accusation; with it,
   * it is a description a manager can act on -- and this is the one place the
   * frozen dashboard's design was unarguably right (manager-dashboard.md §5).
   */
  reasons: string[];
}

export interface AttentionRow {
  conversationId: string;
  familyId: string | null;
  familyName: string | null;
  conversationType: string;
  conversationTitle: string | null;
  supervisorId: string;
  supervisorName: string;
  waitingSince: string;
  waitingMs: number;
  pendingApprovals: number;
}

export interface OverloadThresholds {
  unansweredWarning: number;
  unansweredHigh: number;
  pendingWarning: number;
  pendingHigh: number;
}

/**
 * The Manager Command Center.
 *
 * ## Every number here is real, and every one is clickable
 *
 * There is no figure on this surface that is not a count of rows that exist.
 * The two rules that follow from that, and that this class exists to keep:
 *
 *   1. NOTHING IS COMPUTED IN THE BROWSER. Eight organization-wide aggregates
 *      and a per-supervisor rollup are three SQL functions
 *      (20260907170100), each one pass. The alternative -- pulling
 *      conversations into Node to count them -- is the failure mode the brief
 *      names outright.
 *   2. NOTHING IS COMPUTED FROM THE FROZEN ENGINE. `workload_*` and
 *      `attention_*` are deprecated machinery (PD-3) and no new code may
 *      depend on them. Overload is derived here, from live assignments and
 *      live conversation state, against thresholds that are config rows.
 *
 * ## Who may read it
 *
 * Organization-wide roles: manager and super_admin. Not an admin -- the whole
 * surface is an aggregate over every family in the academy, including the ones
 * an admin has no scope for, and there is no way to narrow a total to a
 * supervisor's own families and have it still mean what it says.
 *
 * The check is here, server-side, because the SQL functions are SECURITY
 * DEFINER: they have to be, since the counts are organization-wide and the
 * connection is under RLS, and that makes this class the boundary. Hiding the
 * nav entry is UX; this is the control.
 */
@Injectable()
export class CommandCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly conversations: ConversationService,
  ) {}

  async kpis(actorId: string, now: Date = new Date()): Promise<CommandCenterKpis> {
    const actor = await this.requireManager(actorId);
    const windowHours = await this.config.get('command_center.window_hours');

    const rows = await this.prisma.$queryRaw<
      Array<Record<string, bigint>>
    >`SELECT * FROM chat.command_center_kpis(
        ${actor.organizationId}::uuid, ${windowHours}::integer, ${now}::timestamptz)`;

    const r = rows[0] ?? {};
    return {
      unansweredMessages: num(r.unanswered_messages),
      pendingApprovals: num(r.pending_approvals),
      escalatedApprovals: num(r.escalated_approvals),
      openConversations: num(r.open_conversations),
      closedConversations: num(r.closed_conversations),
      activeFamilies: num(r.active_families),
      calls: num(r.calls),
      missedClassCalls: num(r.missed_class_calls),
      windowHours,
      asOf: now.toISOString(),
    };
  }

  async supervisors(actorId: string, now: Date = new Date()): Promise<SupervisorLoad[]> {
    const actor = await this.requireManager(actorId);
    const thresholds = await this.thresholds();

    const rows = await this.prisma.$queryRaw<
      Array<{
        staff_id: string;
        staff_name: string;
        staff_role: string;
        presence: string;
        families: bigint;
        open_conversations: bigint;
        unanswered: bigint;
        unread_messages: bigint;
        pending_approvals: bigint;
        escalated: bigint;
        oldest_wait_ms: bigint;
      }>
    >`SELECT * FROM chat.command_center_supervisors(
        ${actor.organizationId}::uuid, ${now}::timestamptz)`;

    const loads = rows.map((r) => {
      const unanswered = num(r.unanswered);
      const pending = num(r.pending_approvals);
      const escalated = num(r.escalated);
      const { level, reasons } = assessOverload(
        { unanswered, pending, escalated, oldestWaitMs: num(r.oldest_wait_ms) },
        thresholds,
      );
      return {
        staffId: r.staff_id,
        name: r.staff_name,
        role: r.staff_role,
        presence: r.presence,
        families: num(r.families),
        openConversations: num(r.open_conversations),
        unanswered,
        unreadMessages: num(r.unread_messages),
        pendingApprovals: pending,
        escalated,
        oldestWaitMs: num(r.oldest_wait_ms),
        overload: level,
        reasons,
      };
    });

    // Worst first. A manager opens this page to find who needs help, and
    // sorting alphabetically would make them read all of it to find out.
    const rank: Record<OverloadLevel, number> = { overloaded: 0, warning: 1, ok: 2 };
    return loads.sort(
      (a, b) => rank[a.overload] - rank[b.overload] || b.unanswered - a.unanswered,
    );
  }

  /** How many supervisors are over the line. The KPI tile's own figure. */
  async overloadedCount(actorId: string, now?: Date): Promise<number> {
    const all = await this.supervisors(actorId, now);
    return all.filter((s) => s.overload === 'overloaded').length;
  }

  /**
   * THE DRILL-DOWN. The conversations behind the unanswered number, optionally
   * for one supervisor -- which is what turns a tile into a place to start.
   */
  async attention(
    actorId: string,
    staffId?: string,
    limit = 50,
    now: Date = new Date(),
  ): Promise<AttentionRow[]> {
    const actor = await this.requireManager(actorId);

    const rows = await this.prisma.$queryRaw<
      Array<{
        conversation_id: string;
        family_id: string | null;
        family_name: string | null;
        conversation_type: string;
        conversation_title: string | null;
        supervisor_id: string;
        supervisor_name: string;
        waiting_since: Date;
        waiting_ms: bigint;
        pending_approvals: bigint;
      }>
    >`SELECT * FROM chat.command_center_attention(
        ${actor.organizationId}::uuid,
        ${staffId ?? null}::uuid,
        ${limit}::integer,
        ${now}::timestamptz)`;

    return rows.map((r) => ({
      conversationId: r.conversation_id,
      familyId: r.family_id,
      familyName: r.family_name,
      conversationType: r.conversation_type,
      conversationTitle: r.conversation_title,
      supervisorId: r.supervisor_id,
      supervisorName: r.supervisor_name,
      waitingSince: r.waiting_since.toISOString(),
      waitingMs: num(r.waiting_ms),
      pendingApprovals: num(r.pending_approvals),
    }));
  }

  /** The live thresholds, so the UI can explain the level it is rendering. */
  async thresholds(): Promise<OverloadThresholds> {
    const [unansweredWarning, unansweredHigh, pendingWarning, pendingHigh] = await Promise.all([
      this.config.get('command_center.overload_unanswered_warning'),
      this.config.get('command_center.overload_unanswered_high'),
      this.config.get('command_center.overload_pending_warning'),
      this.config.get('command_center.overload_pending_high'),
    ]);
    return { unansweredWarning, unansweredHigh, pendingWarning, pendingHigh };
  }

  // -------------------------------------------------------------------

  /**
   * Manager and super_admin only, and the ROLE is not the check -- the
   * organization-wide role set is, exactly as ScopeService uses it, so a role
   * added later is included in both places or in neither.
   *
   * `conversations.read` is required on top, so a per-account DENY silences one
   * person's access to the board without inventing a role for them.
   */
  private async requireManager(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    }
    if (!isFamilyFacingStaff(actor) || !ORGANIZATION_WIDE_STAFF_ROLES.has(actor.staffRole ?? '')) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        'the Command Center reports on the whole organization and is manager-only',
      );
    }
    if (!actorHasPermission(actor, Permission.CONVERSATIONS_READ)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.CONVERSATIONS_READ}`,
      );
    }
    if (!actor.organizationId) {
      // Every aggregate is per organization. An actor with no tenant would be
      // asking for a total across all of them.
      throw new CommError(CommErrorCode.CROSS_TENANT, 'this actor has no organization');
    }
    return actor;
  }
}

/**
 * The overload rule, in one place.
 *
 * Pure, so it is unit-testable without a database, and separate from the query
 * so that "what counts as overloaded" is a decision somebody can read rather
 * than a `case` buried in SQL.
 *
 * TWO AXES, EITHER OF WHICH IS SUFFICIENT. A supervisor with 14 families
 * waiting on a reply is overloaded even with an empty moderation queue, and one
 * with seven messages held for approval is overloaded even if every
 * conversation is answered: those are different kinds of stuck and a rule that
 * averaged them would hide both.
 *
 * ESCALATION IS A THIRD, ABSOLUTE TRIGGER. An escalated item is by definition
 * one this supervisor did not get to in the configured window, so it does not
 * wait for a count threshold.
 */
export function assessOverload(
  load: { unanswered: number; pending: number; escalated: number; oldestWaitMs: number },
  t: OverloadThresholds,
): { level: OverloadLevel; reasons: string[] } {
  const reasons: string[] = [];
  let level: OverloadLevel = 'ok';

  const raise = (to: OverloadLevel) => {
    if (to === 'overloaded' || level === 'ok') level = to;
  };

  if (load.unanswered >= t.unansweredHigh) {
    reasons.push(`${load.unanswered} conversations awaiting a reply`);
    raise('overloaded');
  } else if (load.unanswered >= t.unansweredWarning) {
    reasons.push(`${load.unanswered} conversations awaiting a reply`);
    raise('warning');
  }

  if (load.pending >= t.pendingHigh) {
    reasons.push(`${load.pending} messages awaiting moderation`);
    raise('overloaded');
  } else if (load.pending >= t.pendingWarning) {
    reasons.push(`${load.pending} messages awaiting moderation`);
    raise('warning');
  }

  if (load.escalated > 0) {
    reasons.push(`${load.escalated} moderation items escalated to a manager`);
    raise('overloaded');
  }

  return { level, reasons };
}

/** PostgreSQL count() is bigint, which Prisma hands back as a BigInt. */
function num(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}
