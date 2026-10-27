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

  /**
   * ?from&to (ISO; default the last 30 days, at most 366 at a time) &cursor
   * (the `nextCursor` of the page before -- opaque).
   */
  async list(actorId: string, staffId: string, query: { from?: string; to?: string; cursor?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    const { reasonsSince } = await this.requireReader(actor, staffId);
    const now = Date.now();
    const to = timeField(query.to, 'to') ?? new Date(now);
    const from = timeField(query.from, 'from') ?? new Date(to.getTime() - DEFAULT_DAYS * DAY_MS);
    if (from >= to) throw invalid('from: before to');
    if (to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) throw invalid(`at most ${MAX_DAYS} days at a time`);
    const cursor = decodeCursor(query.cursor);

    // One total order -- the time to the microsecond, then the source, then the
    // row's own key (an audit id zero-padded so text order is numeric order; a
    // case event's uuid) -- so a page boundary inside a run of lines written in
    // one transaction (one now()) loses none and repeats none.
    const rows = await this.prisma.$queryRaw<Array<{
      source: string; k: string; id: string; action: string; entity: string; entity_id: string;
      reason: string | null; at: Date; at_text: string; support: boolean;
    }>>`
      SELECT * FROM (
        SELECT 'audit' AS source, lpad(a.id::text, 20, '0') AS k, a.id::text AS id, a.action, a.entity,
               a.entity_id::text AS entity_id,
               CASE WHEN a.entity = 'supervision_case' THEN NULL
                    WHEN ${reasonsSince}::timestamptz IS NOT NULL AND a.at < ${reasonsSince}::timestamptz THEN NULL
                    ELSE a.reason END AS reason,
               a.at, (a.impersonation_id IS NOT NULL) AS support
          FROM chat.audit_log a
         WHERE a.actor_id = ${staffId}::uuid AND a.at >= ${from} AND a.at < ${to}
        UNION ALL
        SELECT 'case', e.id::text, e.id::text, 'supervision_case.' || e.kind, 'supervision_case', e.case_id::text,
               NULL, e.at, false
          FROM chat.supervision_case_event e
         WHERE e.actor_id = ${staffId}::uuid AND e.kind IN ('due', 'note') AND e.at >= ${from} AND e.at < ${to}
      ) x
      CROSS JOIN LATERAL (SELECT to_char(x.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_text) t
      WHERE ${cursor?.at ?? null}::timestamptz IS NULL
         OR (x.at, x.source COLLATE "C", x.k COLLATE "C")
            < (${cursor?.at ?? null}::timestamptz, ${cursor?.source ?? null}::text COLLATE "C", ${cursor?.k ?? null}::text COLLATE "C")
      ORDER BY x.at DESC, x.source COLLATE "C" DESC, x.k COLLATE "C" DESC
      LIMIT ${LIMIT + 1}`;
    const page = rows.slice(0, LIMIT);
    const last = page[page.length - 1];
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
      // More lines than a page: ask again with this cursor.
      nextCursor: rows.length > LIMIT && last ? encodeCursor({ at: last.at_text, source: last.source, k: last.k }) : null,
    };
  }

  /**
   * The person, the manager of a department they are in, or the super admin --
   * same organization; anyone else reads it as not found. A manager reads the
   * reasons only from when the member joined their department (P2-2:
   * department_member keeps no history, so assigned_at -- reset by every move
   * -- is the conservative line); the person and the super admin read them all.
   */
  private async requireReader(actor: Actor, staffId: string): Promise<{ reasonsSince: Date | null }> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw notFound();
    if (!isUuid(staffId)) throw notFound();
    const [row] = await this.prisma.$queryRaw<Array<{ managed_since: Date | null }>>`
      SELECT (SELECT m.assigned_at FROM chat.department_member m JOIN chat.department d ON d.id = m.department_id
               WHERE m.staff_id = s.id AND d.manager_id = ${actor.actorId}::uuid
               ORDER BY m.assigned_at DESC LIMIT 1) AS managed_since
        FROM chat.staff s
       WHERE s.id = ${staffId}::uuid AND s.organization_id = ${actor.organizationId}::uuid`;
    if (!row) throw notFound();
    if (staffId === actor.actorId || actor.staffRole === StaffRole.SUPER_ADMIN) return { reasonsSince: null };
    if (row.managed_since) return { reasonsSince: row.managed_since };
    throw notFound();
  }
}

interface Cursor {
  at: string;
  source: string;
  k: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(v: unknown): Cursor | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 300) throw invalid('cursor: the nextCursor of the page before');
  try {
    const c = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof c.at === 'string' && !Number.isNaN(Date.parse(c.at)) && (c.source === 'audit' || c.source === 'case')
        && typeof c.k === 'string' && /^[0-9a-f-]{1,40}$/.test(c.k)) {
      return { at: c.at, source: c.source, k: c.k };
    }
  } catch {
    // fall through
  }
  throw invalid('cursor: the nextCursor of the page before');
}

/**
 * A date (YYYY-MM-DD, read as midnight UTC) or a time WITH its zone (Z or an
 * offset). A time without a zone is refused rather than guessed.
 */
function timeField(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const ok = typeof v === 'string'
    && (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(v));
  if (!ok || Number.isNaN(Date.parse(v as string))) {
    throw invalid(`${field}: a date (YYYY-MM-DD) or a time with its zone`);
  }
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(v as string) ? `${v}T00:00:00Z` : (v as string));
}
