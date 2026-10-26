import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type SupervisorCover } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, REALTIME_REVOCATION } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../platform/realtime-revocation';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { NotificationService } from '../communication/notifications/notification.service';
import { StaffRole } from '../communication/contracts/vocab';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export type CoverStatus = 'scheduled' | 'active' | 'ended';

/** What a cover moves: the away supervisor's caseload, as the backup will reach it. */
export interface CoverScope {
  families: string[];
  groups: string[];
  directs: string[];
  openItems: { approvals: number; instalments: number; newStudents: number; total: number };
}

/** A push owed after the transaction that earned it commits. */
type Push = { key: string; template: 'cover_started' | 'cover_ended'; recipientId: string; variables: Record<string, unknown> };

/**
 * PD-33: "Hand over to backup" -- a supervisor away, their backup covering for
 * a window, and the automatic return.
 *
 * A COVER IS AN ACTIVATION OF THE PAIR'S BACKUP LINK (chat.supervisor_backup)
 * for exactly the cover's window, written in the same transaction as the cover
 * row. PD-8's access chain (backup_is_active -> staff_acts_for ->
 * staff_principals) is therefore what lets the backup in, and what shuts them
 * out at `until` to the second -- with no job involved. This service adds what
 * the link never had: one open cover per supervisor, the eligibility rules
 * (re-checked by chat.guard_supervisor_cover), the announcement lines, the two
 * pushes, Extend, End now, and the sweep that posts the return.
 *
 * The routing input -- the away supervisor's pushes go to the backup -- is
 * chat.live_covers(), read by OutboxWorker; the cover line every viewer sees is
 * ConversationService.coversOf. Both require the link to be live, so a link
 * deactivated by any path stops routing at the moment it stops access.
 */
@Injectable()
export class SupervisorCoverService {
  private readonly log = new Logger(SupervisorCoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly notifications: NotificationService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /**
   * The confirm screen's facts, for a cover not started yet: who may cover
   * (the linked backup first), and what would move -- "12 families, 9 groups,
   * 4 open items move to Amira until 3 Nov".
   */
  async preview(actorId: string, query: { supervisorId?: unknown; backupId?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = requireOrg(actor);
    const primaryId = requireUuid('supervisorId', query.supervisorId);
    const primary = await this.requirePrimary(org, primaryId);
    await this.authorize(actor, org, primaryId, null, 'start');

    const eligible = await this.eligibleBackups(this.prisma, primaryId, new Date());
    const chosenId = query.backupId === undefined || query.backupId === '' ? null : requireUuid('backupId', query.backupId);
    const backup = chosenId ? eligible.find((b) => b.id === chosenId) ?? null : eligible.find((b) => b.linked) ?? eligible[0] ?? null;
    const open = await this.prisma.supervisorCover.findFirst({ where: { primaryId, endedAt: null } });
    const scope = await this.scopeOf(this.prisma, primaryId);
    return {
      supervisor: { id: primary.id, name: primary.name },
      backup: backup ? { id: backup.id, name: backup.name } : null,
      eligibleBackups: eligible,
      maxDays: await this.maxDays(),
      openCover: open ? await this.view(open, actor) : null,
      counts: {
        families: scope.families.length,
        groups: scope.groups.length,
        directs: scope.directs.length,
        openItems: scope.openItems,
      },
    };
  }

  /**
   * Open and recent covers the actor may see: the super admin, the
   * organization's; a manager, their department's; a supervisor, their own
   * (as the one away or the one covering).
   */
  async list(actorId: string, query: { active?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = requireOrg(actor);
    const activeOnly = query.active === 'true' || query.active === true;
    const where: Prisma.SupervisorCoverWhereInput = {
      organizationId: org,
      ...(activeOnly ? { endedAt: null } : {}),
    };
    if (actor.staffRole === StaffRole.MANAGER) {
      const dept = await this.prisma.department.findFirst({ where: { organizationId: org, managerId: actor.actorId }, include: { members: true } });
      where.primaryId = { in: dept ? dept.members.map((m) => m.staffId) : [] };
    } else if (actor.staffRole !== StaffRole.SUPER_ADMIN) {
      where.OR = [{ primaryId: actor.actorId }, { backupId: actor.actorId }];
    }
    const rows = await this.prisma.supervisorCover.findMany({ where, orderBy: { startsAt: 'desc' }, take: 100 });
    return { covers: await Promise.all(rows.map((c) => this.view(c, actor))) };
  }

  /** The signed-in staff member's own state: may they hand over, are they away, whom do they cover. */
  async mine(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const org = requireOrg(actor);
    const isPrimary = await this.isOperationsPrimary(org, actor.actorId);
    const away = await this.prisma.supervisorCover.findFirst({ where: { primaryId: actor.actorId, endedAt: null } });
    const covering = await this.prisma.supervisorCover.findMany({
      where: { backupId: actor.actorId, endedAt: null },
      orderBy: { startsAt: 'asc' },
    });
    return {
      canHandOver: isPrimary && actor.staffRole === StaffRole.ADMIN,
      away: away ? await this.view(away, actor) : null,
      covering: await Promise.all(covering.map((c) => this.view(c, actor))),
    };
  }

  // ------------------------------------------------------------------
  // Changing
  // ------------------------------------------------------------------

  /**
   * Start a cover: the link is activated for [from, until), the cover row is
   * written (the trigger re-checks eligibility and the one-open-cover rule),
   * and -- when it starts now -- every affected conversation gets its line and
   * the backup their one push. One transaction.
   */
  async start(actorId: string, body: { supervisorId?: unknown; backupId?: unknown; from?: unknown; until?: unknown; note?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = requireOrg(actor);
    const primaryId = requireUuid('supervisorId', body.supervisorId);
    const primary = await this.requirePrimary(org, primaryId);
    await this.authorize(actor, org, primaryId, null, 'start');

    const now = new Date();
    const from = body.from === undefined || body.from === null || body.from === '' ? now : requireInstant('from', body.from);
    if (from.getTime() < now.getTime() - 5 * 60_000) throw invalid('from', 'cannot be in the past');
    const fromAt = from < now ? now : from;
    const until = requireInstant('until', body.until);
    const maxDays = await this.maxDays();
    if (until <= fromAt) throw invalid('until', 'must be after the start');
    if (until.getTime() - fromAt.getTime() > maxDays * 86_400_000) {
      throw invalid('until', `a cover runs at most ${maxDays} days; for longer, change the supervisor`);
    }
    const note = optionalText('note', body.note, 500);

    const eligible = await this.eligibleBackups(this.prisma, primaryId, now);
    const backupId =
      body.backupId === undefined || body.backupId === null || body.backupId === ''
        ? (eligible.find((b) => b.linked) ?? eligible[0])?.id ?? null
        : requireUuid('backupId', body.backupId);
    if (!backupId) throw structure('this supervisor has no backup supervisor to hand over to');
    const choice = eligible.find((b) => b.id === backupId);
    if (!choice) throw structure('the cover must be a backup supervisor of the same department');
    if (choice.blockedReason) throw structure(choice.blockedReason);

    const pushes: Push[] = [];
    const cover = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      if (await tx.supervisorCover.findFirst({ where: { primaryId, endedAt: null }, select: { id: true } })) {
        throw structure(`${primary.name} is already handed over; extend or end that cover first`);
      }
      let link = await tx.supervisorBackup.findFirst({ where: { primaryId, backupId, endedAt: null } });
      if (!link) {
        link = await tx.supervisorBackup.create({ data: { organizationId: org, primaryId, backupId, createdBy: actor.actorId } });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'backup.created',
          entity: 'supervisor_backup',
          entityId: link.id,
          after: { primaryId, backupId },
          reason: 'PD-33: handed over to this backup',
        });
      }
      // An activation already running keeps its start; the cover owns the end.
      const live = link.activatedAt && link.activatedAt <= fromAt && !link.deactivatedAt && (!link.activeUntil || link.activeUntil > now);
      await tx.supervisorBackup.update({
        where: { id: link.id },
        data: {
          activatedAt: live ? link.activatedAt : fromAt,
          activeUntil: until,
          activatedBy: actor.actorId,
          deactivatedAt: null,
          deactivatedBy: null,
        },
      });
      const created = await tx.supervisorCover.create({
        data: {
          organizationId: org,
          primaryId,
          backupId,
          backupLinkId: link.id,
          startsAt: fromAt,
          endsAt: until,
          windowSeconds: Math.round((until.getTime() - fromAt.getTime()) / 1000),
          note,
          startedBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'cover.started',
        entity: 'supervisor_cover',
        entityId: created.id,
        after: { primaryId, backupId, startsAt: fromAt, endsAt: until },
        reason: note ?? 'PD-33: hand over to backup',
      });
      if (fromAt <= now) return this.announceStart(tx, created, pushes);
      return created;
    });
    await this.sendPushes(pushes);
    return this.view(cover, actor);
  }

  /** One tap: the same window again, never past cover.max_days from now. */
  async extend(actorId: string, coverId: string) {
    const { actor, cover } = await this.loadOpen(actorId, coverId, 'extend');
    const now = new Date();
    if (cover.endsAt <= now) throw structure('this cover has already ended');
    const maxDays = await this.maxDays();
    const endsAt = new Date(cover.endsAt.getTime() + cover.windowSeconds * 1000);
    const latest = new Date(Math.max(cover.startsAt.getTime(), now.getTime()) + maxDays * 86_400_000);
    if (endsAt > latest) throw invalid('until', `a cover runs at most ${maxDays} days; for longer, change the supervisor`);

    const updated = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const claimed = await tx.supervisorCover.updateMany({ where: { id: cover.id, endedAt: null }, data: { endsAt } });
      if (claimed.count === 0) throw structure('this cover has already ended');
      await tx.supervisorBackup.update({ where: { id: cover.backupLinkId }, data: { activeUntil: endsAt } });
      const row = await tx.supervisorCover.findUniqueOrThrow({ where: { id: cover.id } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'cover.extended',
        entity: 'supervisor_cover',
        entityId: cover.id,
        before: { endsAt: cover.endsAt },
        after: { endsAt },
        reason: 'PD-33: extended for the same window',
      });
      if (row.startAnnouncedAt) await this.postLines(tx, row, 'cover.extended');
      return row;
    });
    return this.view(updated, actor);
  }

  /**
   * "End cover now" -- by the supervisor, the backup, their manager or the
   * super admin. Claimed with a conditional update, so racing the sweep (or a
   * second tap) ends it once and posts ONE return line.
   */
  async end(actorId: string, coverId: string) {
    const { actor, cover } = await this.loadOpen(actorId, coverId, 'end');
    const pushes: Push[] = [];
    const ended = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      return this.close(tx, cover.id, 'ended_early', actor.actorId, new Date(), pushes);
    });
    await this.revocation.confirmRevoked();
    await this.sendPushes(pushes);
    return this.view(ended ?? (await this.prisma.supervisorCover.findUniqueOrThrow({ where: { id: cover.id } })), actor);
  }

  /**
   * The backup link a cover runs on was deactivated or ended by another path
   * (the Organization page, a department change): its open cover ends with it,
   * inside the caller's transaction. Returns the pushes to send after commit.
   */
  async closeForLink(tx: Tx, linkId: string, actorId: string | null): Promise<() => Promise<void>> {
    const open = await tx.supervisorCover.findMany({ where: { backupLinkId: linkId, endedAt: null }, select: { id: true } });
    const pushes: Push[] = [];
    for (const c of open) await this.close(tx, c.id, 'link_ended', actorId, new Date(), pushes);
    return () => this.sendPushes(pushes);
  }

  /** Is a cover running on this link? (A manual activation must not overwrite its window.) */
  async linkHasOpenCover(linkId: string): Promise<boolean> {
    return (await this.prisma.supervisorCover.count({ where: { backupLinkId: linkId, endedAt: null } })) > 0;
  }

  // ------------------------------------------------------------------
  // The worker's sweep
  // ------------------------------------------------------------------

  /**
   * Announce covers that have begun (a future-dated start) and close covers
   * whose window is over, posting the return lines. Access never waits for
   * this: the link's active_until already ended it. Every step is a claim by
   * conditional update, so every replica may run it at once.
   */
  async sweep(now = new Date()): Promise<{ started: number; returned: number }> {
    let started = 0;
    let returned = 0;
    const starting = await this.prisma.supervisorCover.findMany({
      where: { endedAt: null, startAnnouncedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true },
      take: 200,
    });
    for (const { id } of starting) {
      const pushes: Push[] = [];
      try {
        const done = await this.write(async (tx) => {
          const row = await tx.supervisorCover.findUnique({ where: { id } });
          if (!row || row.endedAt || row.startAnnouncedAt) return false;
          await this.announceStart(tx, row, pushes);
          return true;
        });
        if (done) {
          started += 1;
          await this.sendPushes(pushes);
        }
      } catch (e) {
        this.log.warn(`cover ${id}: start announcement failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
    const due = await this.prisma.supervisorCover.findMany({
      where: { endedAt: null, endsAt: { lte: now } },
      select: { id: true, endsAt: true },
      take: 200,
    });
    for (const { id, endsAt } of due) {
      const pushes: Push[] = [];
      try {
        const closed = await this.write((tx) => this.close(tx, id, 'returned', null, endsAt, pushes));
        if (closed) {
          returned += 1;
          await this.sendPushes(pushes);
        }
      } catch (e) {
        this.log.warn(`cover ${id}: return failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
    return { started, returned };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * End one open cover: the claim, the link, the lines, the audit. Returns the
   * ended row, or null when somebody else ended it first (then nothing else
   * happens here -- exactly one return line, whoever wins).
   */
  private async close(
    tx: Tx,
    coverId: string,
    kind: 'returned' | 'ended_early' | 'link_ended',
    actorId: string | null,
    at: Date,
    pushes: Push[],
  ): Promise<SupervisorCover | null> {
    const claimed = await tx.supervisorCover.updateMany({
      where: { id: coverId, endedAt: null },
      data: { endedAt: at, endedBy: actorId, endKind: kind },
    });
    if (claimed.count === 0) return null;
    const cover = await tx.supervisorCover.findUniqueOrThrow({ where: { id: coverId } });
    if (kind === 'ended_early') {
      // Access ends now, not at the planned `until`.
      const link = await tx.supervisorBackup.findUnique({ where: { id: cover.backupLinkId } });
      if (link && !link.endedAt && !link.deactivatedAt) {
        await tx.supervisorBackup.update({ where: { id: link.id }, data: { deactivatedAt: at, deactivatedBy: actorId } });
      }
    }
    await this.audit.audit(tx, {
      actorId,
      action: 'cover.ended',
      entity: 'supervisor_cover',
      entityId: cover.id,
      before: { status: 'open', endsAt: cover.endsAt },
      after: { endKind: kind, endedAt: at },
      reason: kind === 'returned' ? 'PD-33: the cover reached its end' : kind === 'link_ended' ? 'PD-33: the backup link ended' : 'PD-33: ended early',
    });
    if (cover.startAnnouncedAt) {
      await this.postLines(tx, cover, 'cover.ended');
      const names = await this.names(tx, [cover.backupId]);
      pushes.push({
        key: `cover_ended:${cover.id}`,
        template: 'cover_ended',
        recipientId: cover.primaryId,
        variables: { cover: names.get(cover.backupId) ?? '' },
      });
    }
    return cover;
  }

  private async announceStart(tx: Tx, cover: SupervisorCover, pushes: Push[]): Promise<SupervisorCover> {
    const row = await tx.supervisorCover.update({ where: { id: cover.id }, data: { startAnnouncedAt: new Date() } });
    const scope = await this.postLines(tx, row, 'cover.started');
    const names = await this.names(tx, [row.primaryId]);
    pushes.push({
      key: `cover_started:${row.id}`,
      template: 'cover_started',
      recipientId: row.backupId,
      variables: { supervisor: names.get(row.primaryId) ?? '', families: scope.families.length, startsAt: row.endsAt.toISOString() },
    });
    return row;
  }

  /** One silent line in every conversation the cover touches. */
  private async postLines(tx: Tx, cover: SupervisorCover, kind: 'cover.started' | 'cover.extended' | 'cover.ended'): Promise<CoverScope> {
    const scope = await this.scopeOf(tx, cover.primaryId);
    const names = await this.names(tx, [cover.primaryId, cover.backupId]);
    const payload = {
      supervisor: names.get(cover.primaryId) ?? null,
      cover: names.get(cover.backupId) ?? null,
      ...(kind === 'cover.ended' ? {} : { until: cover.endsAt.toISOString() }),
    };
    for (const id of [...scope.groups, ...scope.directs]) {
      await this.conversations.postAnnouncement(tx, id, kind, payload);
    }
    return scope;
  }

  /**
   * The supervisor's caseload, read live: the families of the children they
   * supervise, those children's student and family groups, their parents' 1:1s
   * with the supervisor, and the open items in them.
   */
  async scopeOf(db: Db, primaryId: string): Promise<CoverScope> {
    const [row] = await db.$queryRaw<
      Array<{ families: string[]; groups: string[]; directs: string[]; approvals: number; instalments: number; new_students: number }>
    >`
      WITH learners AS (
             SELECT ls.learner_id, l.family_id FROM chat.learner_supervision ls
               JOIN chat.learner l ON l.id = ls.learner_id
              WHERE ls.supervisor_id = ${primaryId}::uuid),
           groups AS (
             SELECT c.id FROM chat.conversation c
              WHERE c.type = 'student_group' AND c.archived_at IS NULL
                AND c.learner_id IN (SELECT learner_id FROM learners)
             UNION
             SELECT c.id FROM chat.conversation c
               JOIN chat.conversation_learner cl ON cl.conversation_id = c.id
              WHERE c.type = 'family_group' AND c.archived_at IS NULL
                AND cl.learner_id IN (SELECT learner_id FROM learners)),
           directs AS (
             SELECT c.id FROM chat.conversation c
               JOIN chat.conversation_member s ON s.conversation_id = c.id AND s.left_at IS NULL
                AND s.actor_kind = 'staff' AND s.actor_id = ${primaryId}::uuid
              WHERE c.type = 'direct' AND c.archived_at IS NULL AND c.family_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM chat.conversation_member p
                             WHERE p.conversation_id = c.id AND p.left_at IS NULL AND p.actor_kind = 'contact'))
      SELECT
        coalesce((SELECT array_agg(DISTINCT family_id::text) FROM learners), '{}') AS families,
        coalesce((SELECT array_agg(id::text ORDER BY id) FROM groups), '{}') AS groups,
        coalesce((SELECT array_agg(id::text ORDER BY id) FROM directs), '{}') AS directs,
        (SELECT count(*)::int FROM chat.message_approval a
          WHERE a.decision = 'pending'
            AND (a.conversation_id IN (SELECT id FROM groups) OR a.conversation_id IN (SELECT id FROM directs))) AS approvals,
        (SELECT count(*)::int FROM chat.family_instalment i
          WHERE i.paid_on IS NULL AND i.voided_at IS NULL
            AND (i.learner_id IN (SELECT learner_id FROM learners)
                 OR (i.learner_id IS NULL AND i.family_id IN (
                       SELECT b.family_id FROM chat.family_billing_supervision b WHERE b.supervisor_id = ${primaryId}::uuid))))
          AS instalments,
        (SELECT count(*)::int FROM chat.student_enrolment e
          WHERE e.group_conversation_id IS NULL
            AND e.learner_ids && (SELECT coalesce(array_agg(learner_id), '{}') FROM learners)) AS new_students`;
    return {
      families: row?.families ?? [],
      groups: row?.groups ?? [],
      directs: row?.directs ?? [],
      openItems: {
        approvals: row?.approvals ?? 0,
        instalments: row?.instalments ?? 0,
        newStudents: row?.new_students ?? 0,
        total: (row?.approvals ?? 0) + (row?.instalments ?? 0) + (row?.new_students ?? 0),
      },
    };
  }

  /**
   * The backup supervisors of the primary's department, linked one first, each
   * with why they cannot cover now (inactive, away, at the limit) or null.
   */
  private async eligibleBackups(db: Db, primaryId: string, now: Date) {
    const max = await this.config.get('cover.max_concurrent');
    const rows = await db.$queryRaw<Array<{ id: string; name: string; live: boolean; linked: boolean; covering: number; away: boolean }>>`
      SELECT s.id::text AS id, s.name, (s.is_active AND s.left_at IS NULL) AS live,
             EXISTS (SELECT 1 FROM chat.supervisor_backup b
                      WHERE b.primary_id = ${primaryId}::uuid AND b.backup_id = s.id AND b.ended_at IS NULL) AS linked,
             (SELECT count(*)::int FROM chat.supervisor_cover c
               WHERE c.backup_id = s.id AND c.ended_at IS NULL AND c.ends_at > ${now}) AS covering,
             EXISTS (SELECT 1 FROM chat.supervisor_cover c WHERE c.primary_id = s.id AND c.ended_at IS NULL) AS away
        FROM chat.department_member pm
        JOIN chat.department d ON d.id = pm.department_id AND d.kind = 'operations'
        JOIN chat.department_member bm ON bm.department_id = pm.department_id AND bm.position = 'backup_supervisor'
        JOIN chat.staff s ON s.id = bm.staff_id
       WHERE pm.staff_id = ${primaryId}::uuid AND pm.position = 'supervisor'
       ORDER BY 4 DESC, s.name`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      linked: r.linked,
      covering: r.covering,
      blockedReason: !r.live
        ? `${r.name} is not an active staff member`
        : r.away
          ? `${r.name} is away themselves`
          : r.covering >= max
            ? `${r.name} already covers ${r.covering} supervisors`
            : null,
    }));
  }

  private async view(c: SupervisorCover, actor: Actor) {
    const now = new Date();
    const names = await this.names(this.prisma, [c.primaryId, c.backupId]);
    const status: CoverStatus = c.endedAt || c.endsAt <= now ? 'ended' : c.startsAt > now ? 'scheduled' : 'active';
    const acts = await this.authz.actsFor(actor, c.primaryId, now);
    const ctx = { organizationId: c.organizationId, actsForPrimary: acts, isCoveringBackup: actor.actorId === c.backupId };
    return {
      id: c.id,
      supervisor: { id: c.primaryId, name: names.get(c.primaryId) ?? '' },
      backup: { id: c.backupId, name: names.get(c.backupId) ?? '' },
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      endedAt: c.endedAt?.toISOString() ?? null,
      endKind: c.endKind,
      note: c.note,
      status,
      canExtend: status !== 'ended' && this.authz.canManageCover(actor, ctx, 'extend').allowed,
      canEnd: status !== 'ended' && this.authz.canManageCover(actor, ctx, 'end').allowed,
    };
  }

  private async loadOpen(actorId: string, coverId: string, action: 'extend' | 'end') {
    const actor = await this.conversations.requireActor(actorId);
    const org = requireOrg(actor);
    if (!isUuid(coverId)) throw notFound();
    const cover = await this.prisma.supervisorCover.findUnique({ where: { id: coverId } });
    if (!cover || cover.organizationId !== org) throw notFound();
    await this.authorize(actor, org, cover.primaryId, cover.backupId, action);
    if (cover.endedAt) throw structure('this cover has already ended');
    return { actor, cover };
  }

  private async authorize(actor: Actor, org: string, primaryId: string, backupId: string | null, action: 'start' | 'extend' | 'end') {
    const decision = this.authz.canManageCover(
      actor,
      {
        organizationId: org,
        actsForPrimary: await this.authz.actsFor(actor, primaryId, new Date()),
        isCoveringBackup: backupId !== null && actor.actorId === backupId,
      },
      action,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  private async requirePrimary(org: string, primaryId: string) {
    const primary = await this.prisma.staff.findUnique({ where: { id: primaryId }, select: { id: true, name: true, organizationId: true } });
    if (!primary || primary.organizationId !== org) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'supervisor not found', 404);
    if (!(await this.isOperationsPrimary(org, primaryId))) {
      throw structure('only a primary supervisor of the Operations department hands over to a backup');
    }
    return primary;
  }

  private async isOperationsPrimary(org: string, staffId: string): Promise<boolean> {
    const member = await this.prisma.departmentMember.findUnique({ where: { staffId }, include: { department: true } });
    return !!member && member.organizationId === org && member.position === 'supervisor' && member.department.kind === 'operations';
  }

  private async names(db: Db, ids: string[]): Promise<Map<string, string>> {
    const rows = await db.staff.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async maxDays(): Promise<number> {
    return Number(await this.config.get('cover.max_days'));
  }

  /** Staff to staff, after commit; dedupe keys make a replay harmless. */
  private async sendPushes(pushes: Push[]): Promise<void> {
    for (const p of pushes) {
      await this.notifications.schedule({
        dedupeKey: p.key,
        templateKey: p.template,
        eventType: p.template,
        recipientId: p.recipientId,
        // Staff are addressed in Arabic, as IdentityService resolves them.
        locale: 'ar',
        variables: p.variables,
        scheduledAt: new Date(),
        respectQuietHours: false,
      });
    }
  }

  /** One transaction; a database refusal of an unlawful cover becomes 409, never a 500. */
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw refusal(e);
    }
  }
}

function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const code = (e as { meta?: { code?: string } })?.meta?.code ?? (e as { code?: string })?.code ?? '';
  if (code === 'P2002' || /supervisor_cover_one_open/.test(text)) {
    return structure('this supervisor is already handed over; extend or end that cover first');
  }
  if (['23514', '42501', '23503', '23505', 'P2003'].includes(code) || /check_violation|insufficient_privilege|violates/.test(text)) {
    const why = /ERROR:\s*([^\n]+)/.exec(text)?.[1] ?? /Message: `([^`]+)`/.exec(text)?.[1] ?? 'the cover was refused';
    return structure(why.replace(/^.*?ERROR:\s*/, ''));
  }
  return e;
}

const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
const structure = (why: string) => new CommError(CommErrorCode.ORG_STRUCTURE_INVALID, why, 409);
const notFound = () => new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'cover not found', 404);

function requireOrg(actor: Actor): string {
  if (!actor.organizationId) throw new CommError(CommErrorCode.ORG_STRUCTURE_DENIED, 'no organization');
  return actor.organizationId;
}

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(field, 'must be a uuid');
  return value.toLowerCase();
}

function requireInstant(field: string, value: unknown): Date {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(field, 'must be an ISO-8601 timestamp');
  return new Date(value);
}

function optionalText(field: string, value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid(field, 'must be text');
  const t = value.trim();
  if (t.length > max) throw invalid(field, `must be at most ${max} characters`);
  return t.length === 0 ? null : t;
}
