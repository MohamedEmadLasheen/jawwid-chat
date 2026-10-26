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

/** Conversations per transaction when posting announcement lines (a large caseload never holds one long transaction). */
const LINE_BATCH = 25;

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

    const eligible = await this.eligibleBackups(this.prisma, primaryId, new Date(), actor.actorId === primaryId);
    const chosenId = query.backupId === undefined || query.backupId === '' ? null : requireUuid('backupId', query.backupId);
    const backup = chosenId ? eligible.find((b) => b.id === chosenId) ?? null : eligible.find((b) => b.linked) ?? eligible[0] ?? null;
    const open = await this.prisma.supervisorCover.findFirst({ where: { primaryId, endedAt: null } });
    const scope = await this.scopeOf(this.prisma, primaryId);
    return {
      supervisor: { id: primary.id, name: primary.name },
      backup: backup ? { id: backup.id, name: backup.name } : null,
      eligibleBackups: eligible,
      maxDays: await this.maxDays(),
      openCover: open ? (await this.views([open], actor))[0]! : null,
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
    return { covers: await this.views(rows, actor) };
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
    const views = await this.views(away ? [away, ...covering] : covering, actor);
    return {
      canHandOver: isPrimary && actor.staffRole === StaffRole.ADMIN,
      away: away ? views[0]! : null,
      covering: away ? views.slice(1) : views,
    };
  }

  // ------------------------------------------------------------------
  // Changing
  // ------------------------------------------------------------------

  /**
   * Start a cover. One SHORT transaction: the pair's link (locked) is activated
   * for [from, until), the cover row is written (the trigger re-checks
   * eligibility and the one-open-cover rule), and -- when it starts now -- the
   * start is claimed and its announcement queued. The lines themselves are
   * posted after commit, in batches (deliver).
   *
   * Who chooses the backup: a supervisor handing themself over ("I'm away")
   * only to a backup a manager has ALREADY linked to them (PD-8
   * canConfigureBackup); a manager or the super admin to any eligible backup,
   * creating the link as part of the start.
   */
  async start(actorId: string, body: { supervisorId?: unknown; backupId?: unknown; from?: unknown; until?: unknown; note?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = requireOrg(actor);
    const primaryId = requireUuid('supervisorId', body.supervisorId);
    const primary = await this.requirePrimary(org, primaryId);
    await this.authorize(actor, org, primaryId, null, 'start');
    const selfService = actor.actorId === primaryId;

    const now = new Date();
    const from = body.from === undefined || body.from === null || body.from === '' ? now : requireInstant('from', body.from);
    if (from.getTime() < now.getTime() - 5 * 60_000) throw invalid('from', 'cannot be in the past');
    const fromAt = from < now ? now : from;
    const future = fromAt > now;
    const until = requireInstant('until', body.until);
    const maxDays = await this.maxDays();
    if (until <= fromAt) throw invalid('until', 'must be after the start');
    if (until.getTime() - fromAt.getTime() > maxDays * 86_400_000) {
      throw invalid('until', `a cover runs at most ${maxDays} days; for longer, change the supervisor`);
    }
    const note = optionalText('note', body.note, 500);

    const eligible = await this.eligibleBackups(this.prisma, primaryId, now, selfService);
    const backupId =
      body.backupId === undefined || body.backupId === null || body.backupId === ''
        ? (eligible.find((b) => b.linked) ?? (selfService ? undefined : eligible[0]))?.id ?? null
        : requireUuid('backupId', body.backupId);
    if (!backupId) {
      throw structure(selfService ? 'no backup is linked to you yet; ask your manager to link one' : 'this supervisor has no backup supervisor to hand over to');
    }
    const choice = eligible.find((b) => b.id === backupId);
    if (!choice) throw structure('the cover must be a backup supervisor of the same department');
    if (choice.blockedReason) throw structure(choice.blockedReason);

    const pushes: Push[] = [];
    const cover = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      if (await tx.supervisorCover.findFirst({ where: { primaryId, endedAt: null }, select: { id: true } })) {
        throw structure(`${primary.name} is already handed over; extend or end that cover first`);
      }
      let link = await this.lockLink(tx, primaryId, backupId);
      if (!link) {
        // Re-checked inside the transaction: a manager may have ended the link since.
        if (selfService) throw structure('only a manager links a new backup; choose your linked backup');
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
      const manuallyLive =
        !!link.activatedAt && link.activatedAt <= now && !link.deactivatedAt && (!link.activeUntil || link.activeUntil > now);
      if (future && manuallyLive) {
        // Otherwise the backup would keep access through the gap before the cover begins.
        throw structure('this backup link is already active; end the manual activation first');
      }
      await tx.supervisorBackup.update({
        where: { id: link.id },
        data: {
          // Starting now over a live manual activation keeps its start; the cover owns the end.
          activatedAt: !future && manuallyLive ? link.activatedAt : fromAt,
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
      if (!future) await this.claimStart(tx, created.id, pushes);
      return tx.supervisorCover.findUniqueOrThrow({ where: { id: created.id } });
    });
    await this.sendPushes(pushes);
    await this.deliverQuietly(cover.id);
    return (await this.views([cover], actor))[0]!;
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
    // The backup must still be able to cover: active, in the department, not away.
    const backup = (await this.eligibleBackups(this.prisma, cover.primaryId, now, false)).find((b) => b.id === cover.backupId);
    if (!backup || backup.blocked === 'inactive' || backup.blocked === 'away') {
      throw structure(backup?.blockedReason ?? 'the backup can no longer cover this supervisor');
    }

    const updated = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const claimed = await tx.supervisorCover.updateMany({ where: { id: cover.id, endedAt: null }, data: { endsAt } });
      if (claimed.count === 0) throw structure('this cover has already ended');
      await tx.$queryRaw`SELECT id FROM chat.supervisor_backup WHERE id = ${cover.backupLinkId}::uuid FOR UPDATE`;
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
      if (row.startAnnouncedAt) await this.queueAnnouncement(tx, row, 'cover.extended');
      return row;
    });
    await this.deliverQuietly(updated.id);
    return (await this.views([updated], actor))[0]!;
  }

  /**
   * "End cover now" -- by the supervisor, the backup, their manager or the
   * super admin. Claimed with a conditional update, so racing the sweep (or a
   * second tap) ends it once and queues ONE return announcement.
   */
  async end(actorId: string, coverId: string) {
    const { actor, cover } = await this.loadOpen(actorId, coverId, 'end');
    const pushes: Push[] = [];
    const ended = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      return this.close(tx, cover.id, 'ended_early', actor.actorId, new Date(), pushes);
    });
    try {
      await this.revocation.confirmRevoked();
    } finally {
      // The cover IS ended whatever the barrier says: the supervisor hears it.
      await this.sendPushes(pushes);
      await this.deliverQuietly(cover.id);
    }
    const row = ended ?? (await this.prisma.supervisorCover.findUniqueOrThrow({ where: { id: cover.id } }));
    return (await this.views([row], actor))[0]!;
  }

  /**
   * The backup link a cover runs on was deactivated or ended by another path
   * (the Organization page, a department change): its open cover ends with it,
   * inside the caller's transaction. Returns what to do after commit (the
   * pushes and the lines).
   */
  async closeForLink(tx: Tx, linkId: string, actorId: string | null): Promise<() => Promise<void>> {
    const open = await tx.supervisorCover.findMany({ where: { backupLinkId: linkId, endedAt: null }, select: { id: true } });
    const pushes: Push[] = [];
    for (const c of open) await this.close(tx, c.id, 'link_ended', actorId, new Date(), pushes);
    return async () => {
      await this.sendPushes(pushes);
      for (const c of open) await this.deliverQuietly(c.id);
    };
  }

  /**
   * A manual activation must not overwrite a running cover's window. Called
   * INSIDE the activation's transaction: the link row is locked, so a cover
   * starting at the same moment (which locks it too) is seen or waits.
   */
  async lockAndAssertNoCover(tx: Tx, linkId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM chat.supervisor_backup WHERE id = ${linkId}::uuid FOR UPDATE`;
    if ((await tx.supervisorCover.count({ where: { backupLinkId: linkId, endedAt: null } })) > 0) {
      throw structure('a cover runs on this link; extend or end the cover instead');
    }
  }

  // ------------------------------------------------------------------
  // The worker's sweep
  // ------------------------------------------------------------------

  /**
   * Announce covers that have begun (a future-dated start), close covers whose
   * window is over, and finish any announcement whose lines are not all posted
   * yet. Access never waits for this: the link's active_until already ended
   * it. Every step is a claim by conditional update, so every replica may run
   * it at once.
   */
  async sweep(now = new Date()): Promise<{ started: number; returned: number; delivered: number }> {
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
        if (await this.write((tx) => this.claimStart(tx, id, pushes))) {
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
      try {
        if (await this.returnDue(id, endsAt)) returned += 1;
      } catch (e) {
        this.log.warn(`cover ${id}: return failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
    const delivered = await this.deliver();
    return { started, returned, delivered };
  }

  /**
   * Close a cover the sweep found due, AS SEEN: `observedEndsAt` is the end it
   * read. An Extend that committed in between moved ends_at past it, so the
   * claim finds nothing and the cover stays open (and its link aligned).
   */
  async returnDue(coverId: string, observedEndsAt: Date): Promise<boolean> {
    const pushes: Push[] = [];
    const closed = await this.write((tx) => this.close(tx, coverId, 'returned', null, observedEndsAt, pushes));
    if (!closed) return false;
    await this.sendPushes(pushes);
    return true;
  }

  /**
   * Post the queued announcement lines -- for one cover, or every pending one --
   * in batches of LINE_BATCH conversations per transaction. Each line is
   * claimed in chat.supervisor_cover_line first, so a retry (or a second
   * runner) never posts it twice. Returns the number of lines posted.
   */
  async deliver(coverId?: string): Promise<number> {
    let posted = 0;
    const pending = await this.prisma.supervisorCoverAnnouncement.findMany({
      where: { doneAt: null, ...(coverId ? { coverId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const a of pending) {
      const cover = await this.prisma.supervisorCover.findUnique({ where: { id: a.coverId }, select: { primaryId: true } });
      if (!cover) continue;
      const scope = await this.scopeOf(this.prisma, cover.primaryId);
      const already = new Set(
        (await this.prisma.supervisorCoverLine.findMany({ where: { announcementId: a.id }, select: { conversationId: true } })).map(
          (l) => l.conversationId,
        ),
      );
      const todo = [...scope.groups, ...scope.directs].filter((id) => !already.has(id));
      for (let i = 0; i < todo.length; i += LINE_BATCH) {
        const batch = todo.slice(i, i + LINE_BATCH);
        posted += await this.write(async (tx) => {
          let n = 0;
          for (const conversationId of batch) {
            const claimed = await tx.$executeRaw`
              INSERT INTO chat.supervisor_cover_line (announcement_id, conversation_id)
              VALUES (${a.id}::uuid, ${conversationId}::uuid) ON CONFLICT DO NOTHING`;
            if (claimed !== 1) continue;
            const messageId = await this.conversations.postAnnouncement(tx, conversationId, a.kind, a.payload as Record<string, unknown>, {
              touchActivity: false, // informational: never reorders the chat list
            });
            await tx.supervisorCoverLine.update({
              where: { announcementId_conversationId: { announcementId: a.id, conversationId } },
              data: { messageId },
            });
            n += 1;
          }
          return n;
        });
      }
      await this.prisma.supervisorCoverAnnouncement.updateMany({ where: { id: a.id, doneAt: null }, data: { doneAt: new Date() } });
    }
    return posted;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Deliver after a change commits; a failure is left to the sweep, never to the caller. */
  private async deliverQuietly(coverId: string): Promise<void> {
    try {
      await this.deliver(coverId);
    } catch (e) {
      this.log.warn(`cover ${coverId}: lines left for the sweep: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  /**
   * Claim a cover's start: set start_announced_at only if nobody has, and only
   * while the cover is open -- then queue its announcement and the backup's
   * summary push. Two sweeps (or a sweep and the start itself) claim it once.
   */
  private async claimStart(tx: Tx, coverId: string, pushes: Push[]): Promise<boolean> {
    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE chat.supervisor_cover SET start_announced_at = now()
       WHERE id = ${coverId}::uuid AND start_announced_at IS NULL AND ended_at IS NULL
      RETURNING id::text AS id`;
    if (claimed.length === 0) return false;
    const cover = await tx.supervisorCover.findUniqueOrThrow({ where: { id: coverId } });
    await this.queueAnnouncement(tx, cover, 'cover.started');
    const scope = await this.scopeOf(tx, cover.primaryId);
    const names = await this.names(tx, [cover.primaryId]);
    pushes.push({
      key: `cover_started:${cover.id}`,
      template: 'cover_started',
      recipientId: cover.backupId,
      variables: { supervisor: names.get(cover.primaryId) ?? '', families: scope.families.length, startsAt: cover.endsAt.toISOString() },
    });
    return true;
  }

  /** One announcement per event (started / extended to a new end / ended); a repeat is a no-op. */
  private async queueAnnouncement(tx: Tx, cover: SupervisorCover, kind: 'cover.started' | 'cover.extended' | 'cover.ended') {
    const names = await this.names(tx, [cover.primaryId, cover.backupId]);
    const payload = {
      supervisor: names.get(cover.primaryId) ?? null,
      cover: names.get(cover.backupId) ?? null,
      ...(kind === 'cover.ended' ? {} : { until: cover.endsAt.toISOString() }),
    };
    const lineKey = kind === 'cover.started' ? 'started' : kind === 'cover.ended' ? 'ended' : `extended:${cover.endsAt.toISOString()}`;
    await tx.supervisorCoverAnnouncement.createMany({
      data: [{ coverId: cover.id, kind, lineKey, payload }],
      skipDuplicates: true,
    });
  }

  /**
   * End one open cover: the claim, the link, the audit, the return
   * announcement. Returns the ended row, or null when the claim found nothing
   * -- somebody else ended it first, or (for `returned`) an Extend moved its
   * end past `at`. Then nothing else happens here: one return line, whoever wins.
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
      where: { id: coverId, endedAt: null, ...(kind === 'returned' ? { endsAt: { lte: at } } : {}) },
      data: { endedAt: at, endedBy: actorId, endKind: kind },
    });
    if (claimed.count === 0) return null;
    const cover = await tx.supervisorCover.findUniqueOrThrow({ where: { id: coverId } });
    // The link never outlives its cover: clamp its window to `at` (or, for a
    // cover that had not begun yet, switch it off).
    await tx.$queryRaw`SELECT id FROM chat.supervisor_backup WHERE id = ${cover.backupLinkId}::uuid FOR UPDATE`;
    const link = await tx.supervisorBackup.findUnique({ where: { id: cover.backupLinkId } });
    if (link && !link.endedAt) {
      const begun = !!link.activatedAt && link.activatedAt < at;
      await tx.supervisorBackup.update({
        where: { id: link.id },
        data: {
          ...(begun && (!link.activeUntil || link.activeUntil > at) ? { activeUntil: at } : {}),
          ...((!begun || kind === 'ended_early') && !link.deactivatedAt ? { deactivatedAt: at, deactivatedBy: actorId } : {}),
        },
      });
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
      await this.queueAnnouncement(tx, cover, 'cover.ended');
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

  /** The pair's live link, locked for the rest of the transaction; null when there is none. */
  private async lockLink(tx: Tx, primaryId: string, backupId: string) {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.supervisor_backup
       WHERE primary_id = ${primaryId}::uuid AND backup_id = ${backupId}::uuid AND ended_at IS NULL
       FOR UPDATE`;
    return row ? tx.supervisorBackup.findUnique({ where: { id: row.id } }) : null;
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
  private async eligibleBackups(db: Db, primaryId: string, now: Date, selfService: boolean) {
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
      /**
       * Why they cannot cover now, for a client to word: inactive | away |
       * at_limit | not_linked (a supervisor handing themself over may choose
       * only a backup a manager has linked to them) | null.
       */
      blocked: (!r.live
        ? 'inactive'
        : r.away
          ? 'away'
          : r.covering >= max
            ? 'at_limit'
            : selfService && !r.linked
              ? 'not_linked'
              : null) as 'inactive' | 'away' | 'at_limit' | 'not_linked' | null,
      blockedReason: !r.live
        ? `${r.name} is not an active staff member`
        : r.away
          ? `${r.name} is away themselves`
          : r.covering >= max
            ? `${r.name} already covers ${r.covering} supervisors`
            : selfService && !r.linked
              ? `${r.name} is not linked to you; only a manager links a new backup`
              : null,
    }));
  }

  /** Many covers in one go: one names query, one actsFor per distinct supervisor. */
  private async views(covers: SupervisorCover[], actor: Actor) {
    if (covers.length === 0) return [];
    const now = new Date();
    const names = await this.names(this.prisma, [...new Set(covers.flatMap((c) => [c.primaryId, c.backupId]))]);
    const primaries = [...new Set(covers.map((c) => c.primaryId))];
    const acts = new Map(await Promise.all(primaries.map(async (p) => [p, await this.authz.actsFor(actor, p, now)] as const)));
    return covers.map((c) => {
      const status: CoverStatus = c.endedAt || c.endsAt <= now ? 'ended' : c.startsAt > now ? 'scheduled' : 'active';
      const ctx = { organizationId: c.organizationId, actsForPrimary: acts.get(c.primaryId) ?? null, isCoveringBackup: actor.actorId === c.backupId };
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
    });
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

  /**
   * One short transaction. A database refusal of an unlawful cover becomes
   * 409; a transaction that could not finish in time (P2028) a clean 503 --
   * nothing was committed and retrying is safe. Never a 500.
   */
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw refusal(e);
    }
  }
}

/** A failed cover transaction as the caller should see it (exported for its unit test). */
export function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const code = (e as { meta?: { code?: string } })?.meta?.code ?? (e as { code?: string })?.code ?? '';
  if (code === 'P2028') {
    return new CommError(CommErrorCode.ORG_STRUCTURE_BUSY, 'the change could not finish in time; nothing was saved -- try again', 503);
  }
  if (code === 'P2002' || /supervisor_cover_one_open/.test(text)) {
    return structure('this supervisor is already handed over; extend or end that cover first');
  }
  // A trigger's RAISE reaches us as Prisma text: `PostgresError { code: "23514", message: "..." }`.
  const pgCode = /code: "(\w+)"/.exec(text)?.[1] ?? '';
  if (
    ['23514', '42501', '23503', '23505', 'P2003'].includes(code) ||
    ['23514', '42501', '23503', '23505'].includes(pgCode) ||
    /check_violation|insufficient_privilege|violates/.test(text)
  ) {
    const why =
      /message: "([^"]+)"/.exec(text)?.[1] ?? /ERROR:\s*([^\n]+)/.exec(text)?.[1] ?? /Message: `([^`]+)`/.exec(text)?.[1] ?? 'the cover was refused';
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
