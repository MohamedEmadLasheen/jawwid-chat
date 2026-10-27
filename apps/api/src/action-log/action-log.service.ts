import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const LIMIT = 200;
const DAY_MS = 86_400_000;

const notFound = () => new CommError(CommErrorCode.ACTION_LOG_NOT_FOUND, 'not found');
const invalid = (why: string) => new CommError(CommErrorCode.VALIDATION, why, 400);

export interface ActionLogEntry {
  /** `audit:<id>` or `case:<id>`: stable, and says where the line came from. */
  id: string;
  action: string;
  entity: string;
  entityId: string;
  /** The audited reason; null for a case entry (B5 shows a case only to those who may see it). */
  reason: string | null;
  at: string;
  /** Written while an administrator acted as someone (PD-21 support session). */
  duringSupport: boolean;
}

/**
 * PD-35 B7: what one staff member did -- no new logging. The lines are
 *
 *   chat.audit_log          every audited act with them as the actor
 *   chat.supervision_case_event
 *                           the case history that is not audited: a due date
 *                           set, a note added (the rest of a case's history is
 *                           audited, and would show twice)
 *
 * newest first, with the entity each was about -- never the before/after
 * payloads (pay terms, the Teacher File's personal facts). A case line shows
 * the act and the case's id only: its title and notes are B5's to show.
 *
 * Read by the person themselves, the manager of the department they are in,
 * and the super admin. Anyone else -- and an unknown id -- reads it as not found.
 */
@Injectable()
export class ActionLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
  ) {}

  /** ?from&to (ISO; default the last 30 days, at most 366) &before (ISO: the page before this time). */
  async list(actorId: string, staffId: string, query: { from?: string; to?: string; before?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireReader(actor, staffId);
    const now = Date.now();
    const to = timeField(query.to, 'to') ?? new Date(now);
    const from = timeField(query.from, 'from') ?? new Date(to.getTime() - DEFAULT_DAYS * DAY_MS);
    if (from >= to) throw invalid('from: before to');
    if (to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) throw invalid(`at most ${MAX_DAYS} days at a time`);
    const before = timeField(query.before, 'before');
    const until = before && before < to ? before : to;

    const rows = await this.prisma.$queryRaw<Array<{
      source: string; id: string; action: string; entity: string; entity_id: string; reason: string | null; at: Date; support: boolean;
    }>>`
      SELECT * FROM (
        SELECT 'audit' AS source, a.id::text AS id, a.action, a.entity, a.entity_id::text AS entity_id,
               CASE WHEN a.entity = 'supervision_case' THEN NULL ELSE a.reason END AS reason,
               a.at, (a.impersonation_id IS NOT NULL) AS support
          FROM chat.audit_log a
         WHERE a.actor_id = ${staffId}::uuid AND a.at >= ${from} AND a.at < ${until}
        UNION ALL
        SELECT 'case', e.id::text, 'supervision_case.' || e.kind, 'supervision_case', e.case_id::text,
               NULL, e.at, false
          FROM chat.supervision_case_event e
         WHERE e.actor_id = ${staffId}::uuid AND e.kind IN ('due', 'note') AND e.at >= ${from} AND e.at < ${until}
      ) x
      ORDER BY x.at DESC, x.id DESC
      LIMIT ${LIMIT + 1}`;
    const page = rows.slice(0, LIMIT);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      entries: page.map<ActionLogEntry>((r) => ({
        id: `${r.source}:${r.id}`,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        reason: r.reason,
        at: r.at.toISOString(),
        duringSupport: r.support,
      })),
      // More lines than a page: ask again with `before` = the last line's time.
      nextBefore: rows.length > LIMIT ? page[page.length - 1].at.toISOString() : null,
    };
  }

  /** The person, the manager of a department they are in, or the super admin -- same organization. */
  private async requireReader(actor: Actor, staffId: string): Promise<void> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw notFound();
    if (!isUuid(staffId)) throw notFound();
    const [row] = await this.prisma.$queryRaw<Array<{ manages: boolean }>>`
      SELECT EXISTS (
               SELECT 1 FROM chat.department_member m JOIN chat.department d ON d.id = m.department_id
                WHERE m.staff_id = s.id AND d.manager_id = ${actor.actorId}::uuid) AS manages
        FROM chat.staff s
       WHERE s.id = ${staffId}::uuid AND s.organization_id = ${actor.organizationId}::uuid`;
    if (!row) throw notFound();
    if (staffId === actor.actorId || actor.staffRole === StaffRole.SUPER_ADMIN || row.manages) return;
    throw notFound();
  }
}

function timeField(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw invalid(`${field}: an ISO date or time`);
  }
  return new Date(v);
}
