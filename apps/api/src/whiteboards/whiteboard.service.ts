import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { CommError, CommErrorCode } from '../platform/errors';
import { PrismaService } from '../platform/prisma.service';
import { currentImpersonationId } from '../platform/request-context';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { Actor } from '../platform/types';
import { BACKGROUNDS, LAYOUTS, checkDocument } from './whiteboard-document';

/** §6.4, sized for 200 teachers (owner 2026-10-28). */
export const BOARDS_PER_TEACHER = 200;
export const PAGES_PER_BOARD = 50;
/** Documents per teacher, in Postgres (§11.2). */
export const DOCUMENT_BYTES_PER_TEACHER = 25 * 1024 * 1024;
/** How many due boards one sweep purges; the next sweep takes the rest. */
const PURGE_BATCH = 50;

type Tx = Prisma.TransactionClient;
type Basis = 'owner' | 'supervisor' | 'backup' | 'teachers_manager' | 'super_admin' | 'support_session';
type Action = 'open' | 'trash' | 'restore' | 'copy';

interface BoardRow {
  id: string;
  organization_id: string;
  teacher_id: string;
  lesson_id: string | null;
  title: string;
  revision: number;
  state: 'active' | 'trashed' | 'retained';
  trashed_at: Date | null;
  purge_after: Date | null;
  retained_until: Date | null;
  created_at: Date;
  updated_at: Date;
  page_count: number;
}

interface PageRow {
  id: string;
  position: number;
  layout: string;
  background: string;
  document: unknown;
  updated_at: Date;
}

export interface BoardSummary {
  id: string;
  title: string;
  lessonId: string | null;
  state: BoardRow['state'];
  revision: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  /** Trash: the board is deleted for good after this moment. */
  purgeAfter: string | null;
  /** A departed teacher's board: kept until this moment. */
  retainedUntil: string | null;
}

export interface BoardDetail extends BoardSummary {
  teacherId: string;
  /** False for every reader but the owning teacher (and for the owner in a support session). */
  canEdit: boolean;
  pages: Array<{ id: string; position: number; layout: string; background: string; document: unknown; updatedAt: string }>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function summary(b: BoardRow): BoardSummary {
  return {
    id: b.id,
    title: b.title,
    lessonId: b.lesson_id,
    state: b.state,
    revision: b.revision,
    pageCount: Number(b.page_count),
    createdAt: b.created_at.toISOString(),
    updatedAt: b.updated_at.toISOString(),
    trashedAt: iso(b.trashed_at),
    purgeAfter: iso(b.purge_after),
    retainedUntil: iso(b.retained_until),
  };
}

const notFound = () => new CommError(CommErrorCode.WHITEBOARD_NOT_FOUND, 'no such board');
const invalid = (detail: string) => new CommError(CommErrorCode.WHITEBOARD_INVALID, detail, 422);
const limit = (detail: string) => new CommError(CommErrorCode.WHITEBOARD_LIMIT, detail, 409);
const state = (detail: string) => new CommError(CommErrorCode.WHITEBOARD_STATE, detail, 409);

/** A refusal raised by the database becomes an answer; anything else is rethrown. */
export function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) && !(e instanceof Prisma.PrismaClientUnknownRequestError)) return e;
  const meta = (e as { meta?: { code?: string; message?: string } }).meta;
  const raw = String(meta?.message ?? e.message);
  const sqlstate = meta?.code ?? (/\b(23514|23505|23503)\b/.exec(raw)?.[1] ?? '');
  const words = (/ERROR:\s*([^\n`]+)/.exec(raw)?.[1] ?? raw).trim();
  if (sqlstate === '23514' || /check_violation/.test(raw)) return invalid(words);
  if (sqlstate === '23503') return invalid('a board names a lesson or teacher that does not exist');
  return e;
}

/**
 * PD-39: the teacher whiteboard (docs/product/pd039-whiteboard-design.md §6, §10).
 *
 * WHO WRITES. Only the owning teacher, signed in as themself: an active teacher
 * account, the board's teacher_id, and NOT a PD-21 support session (§10 1a).
 * Staff routes are read-only, and the staff controller has no write but the
 * Teachers Manager's copy of a departed teacher's board (4a).
 *
 * WHO READS. The owner; and staff for whom chat.staff_supervised_teacher_ids
 * contains the teacher -- the assigned supervisor, their active backup, the
 * Teachers Manager, the super admin -- whatever the PD-35 switch says (§11.1).
 * Everyone else, and every other organization, gets 404.
 *
 * EVERY OPEN IS LOGGED in chat.whiteboard_access_log, in the same transaction
 * as the read: no read is served without its row (§10 1c).
 *
 * CONCURRENCY. Every write names the board revision it was made against; a
 * different current revision is 409 WHITEBOARD_CONFLICT (another tab) and
 * nothing is written. Limits are counted under a per-teacher advisory lock.
 */
@Injectable()
export class WhiteboardService {
  private readonly log = new Logger(WhiteboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ---------------------------------------------------------------------------
  // The teacher's own boards
  // ---------------------------------------------------------------------------

  async list(actor: Actor): Promise<BoardSummary[]> {
    const { teacherId } = this.teacher(actor);
    const rows = await this.prisma.$queryRaw<BoardRow[]>`${BOARD_SELECT}
      WHERE w.teacher_id = ${teacherId}::uuid AND w.state = 'active'
      ORDER BY w.updated_at DESC`;
    return rows.map(summary);
  }

  /** "Deleted boards": restorable until purgeAfter (§10 4d, 5a). */
  async trash(actor: Actor): Promise<BoardSummary[]> {
    const { teacherId } = this.teacher(actor);
    const rows = await this.prisma.$queryRaw<BoardRow[]>`${BOARD_SELECT}
      WHERE w.teacher_id = ${teacherId}::uuid AND w.state = 'trashed'
      ORDER BY w.trashed_at DESC`;
    return rows.map(summary);
  }

  async open(boardId: string, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.teacher(actor);
    const support = currentImpersonationId();
    return this.prisma.$transaction(async (tx) => {
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId);
      if (board.state !== 'active') throw state('a board in Deleted boards opens only after it is restored');
      await this.record(tx, board, support ? { id: support, kind: 'support_session', basis: 'support_session' } : { id: teacherId, kind: 'teacher', basis: 'owner' }, 'open');
      return this.detail(tx, board, !support);
    });
  }

  async create(body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    const title = this.title(body.title);
    const lessonId = body.lessonId == null ? null : this.uuid(body.lessonId, 'lessonId');
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      await this.assertBoardRoom(tx, teacherId);
      const [{ id }] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO chat.whiteboard (organization_id, teacher_id, lesson_id, title)
        VALUES (${organizationId}::uuid, ${teacherId}::uuid, ${lessonId}::uuid, ${title})
        RETURNING id::text AS id`;
      await tx.$executeRaw`INSERT INTO chat.whiteboard_page (board_id, position) VALUES (${id}::uuid, 0)`;
      return this.detail(tx, await this.ownBoard(tx, id, teacherId, organizationId), true);
    });
  }

  async rename(boardId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    const title = this.title(body.title);
    return this.write(async (tx) => {
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      await tx.$executeRaw`UPDATE chat.whiteboard SET title = ${title} WHERE id = ${board.id}::uuid`;
      return this.detail(tx, await this.ownBoard(tx, board.id, teacherId, organizationId), true);
    });
  }

  async duplicate(boardId: string, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const source = await this.ownBoard(tx, boardId, teacherId, organizationId);
      if (source.state !== 'active') throw state('only a board in use can be duplicated');
      await this.assertBoardRoom(tx, teacherId);
      await this.assertDocumentRoom(tx, teacherId, await this.boardBytes(tx, source.id), null);
      const copy = await this.copyBoard(tx, source, teacherId, organizationId, this.copyTitle(source.title));
      return this.detail(tx, await this.ownBoard(tx, copy, teacherId, organizationId), true);
    });
  }

  /** §10 4d: to Deleted boards for 30 days. Nothing is removed until the purge. */
  async moveToTrash(boardId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardSummary> {
    const { teacherId, organizationId } = this.writer(actor);
    return this.write(async (tx) => {
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      await tx.$executeRaw`
        UPDATE chat.whiteboard
           SET state = 'trashed', trashed_at = now(), purge_after = now() + interval '30 days'
         WHERE id = ${board.id}::uuid`;
      const trashed = await this.ownBoard(tx, board.id, teacherId, organizationId);
      await this.record(tx, trashed, { id: teacherId, kind: 'teacher', basis: 'owner' }, 'trash');
      return summary(trashed);
    });
  }

  /** §10 5c: the same board, pages and revision, back as they were. */
  async restore(boardId: string, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId, true);
      if (board.state !== 'trashed') throw state('only a board in Deleted boards can be restored');
      // Past its 30 days the purge owns it: restoring now could race the deletion.
      if (!board.purge_after || board.purge_after.getTime() <= Date.now()) throw notFound();
      await this.assertBoardRoom(tx, teacherId);
      await tx.$executeRaw`
        UPDATE chat.whiteboard
           SET state = 'active', trashed_at = NULL, purge_after = NULL, updated_at = now()
         WHERE id = ${board.id}::uuid AND state = 'trashed'`;
      const restored = await this.ownBoard(tx, board.id, teacherId, organizationId);
      await this.record(tx, restored, { id: teacherId, kind: 'teacher', basis: 'owner' }, 'restore');
      return this.detail(tx, restored, true);
    });
  }

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------

  async addPage(boardId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    const layout = this.choice(body.layout, LAYOUTS, 'layout', 'plain');
    const background = this.choice(body.background, BACKGROUNDS, 'background', 'white');
    return this.write(async (tx) => {
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      const count = Number(board.page_count);
      if (count >= PAGES_PER_BOARD) throw limit(`pages: a board holds at most ${PAGES_PER_BOARD}`);
      const position = this.position(body.position, count);
      await this.openGap(tx, board.id, position);
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_page (board_id, position, layout, background)
        VALUES (${board.id}::uuid, ${position}, ${layout}, ${background})`;
      return this.detail(tx, await this.ownBoard(tx, board.id, teacherId, organizationId), true);
    });
  }

  /** The autosave: one page's drawing, layout and background. */
  async savePage(boardId: string, pageId: string, body: Record<string, unknown>, actor: Actor): Promise<{ revision: number; pageId: string; updatedAt: string }> {
    const { teacherId, organizationId } = this.writer(actor);
    const page = this.uuid(pageId, 'pageId');
    const checked = checkDocument(body.document);
    if (!checked.ok) throw invalid(checked.reason);
    const layout = body.layout === undefined ? null : this.choice(body.layout, LAYOUTS, 'layout', 'plain');
    const background = body.background === undefined ? null : this.choice(body.background, BACKGROUNDS, 'background', 'white');
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      await this.assertPage(tx, board.id, page);
      await this.assertAssets(tx, board.id, checked.value.assetIds);
      await this.assertDocumentRoom(tx, teacherId, checked.value.bytes, page);
      const [row] = await tx.$queryRaw<Array<{ updated_at: Date }>>`
        UPDATE chat.whiteboard_page
           SET document = ${JSON.stringify(checked.value.document)}::jsonb,
               layout = COALESCE(${layout}, layout),
               background = COALESCE(${background}, background),
               updated_at = now()
         WHERE id = ${page}::uuid AND board_id = ${board.id}::uuid
        RETURNING updated_at`;
      return { revision: board.revision, pageId: page, updatedAt: row.updated_at.toISOString() };
    });
  }

  async duplicatePage(boardId: string, pageId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    const page = this.uuid(pageId, 'pageId');
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      if (Number(board.page_count) >= PAGES_PER_BOARD) throw limit(`pages: a board holds at most ${PAGES_PER_BOARD}`);
      const source = await this.assertPage(tx, board.id, page);
      const [{ bytes }] = await tx.$queryRaw<Array<{ bytes: number }>>`
        SELECT document_bytes AS bytes FROM chat.whiteboard_page WHERE id = ${page}::uuid`;
      await this.assertDocumentRoom(tx, teacherId, Number(bytes), null);
      await this.openGap(tx, board.id, source.position + 1);
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_page (board_id, position, layout, background, document)
        SELECT board_id, ${source.position + 1}, layout, background, document
          FROM chat.whiteboard_page WHERE id = ${page}::uuid`;
      return this.detail(tx, await this.ownBoard(tx, board.id, teacherId, organizationId), true);
    });
  }

  async deletePage(boardId: string, pageId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    const page = this.uuid(pageId, 'pageId');
    return this.write(async (tx) => {
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      if (Number(board.page_count) <= 1) throw state('a board keeps at least one page');
      const removed = await this.assertPage(tx, board.id, page);
      await tx.$executeRaw`DELETE FROM chat.whiteboard_page WHERE id = ${page}::uuid`;
      await tx.$executeRaw`SET CONSTRAINTS chat.whiteboard_page_position DEFERRED`;
      await tx.$executeRaw`
        UPDATE chat.whiteboard_page SET position = position - 1
         WHERE board_id = ${board.id}::uuid AND position > ${removed.position}`;
      return this.detail(tx, await this.ownBoard(tx, board.id, teacherId, organizationId), true);
    });
  }

  /** The new order, as every page id of the board exactly once. */
  async reorderPages(boardId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    if (!Array.isArray(body.pageIds) || body.pageIds.length > PAGES_PER_BOARD) throw invalid('pageIds: every page id of the board, in the new order');
    const order = body.pageIds.map((p, i) => this.uuid(p, `pageIds[${i}]`).toLowerCase());
    return this.write(async (tx) => {
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      const pages = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM chat.whiteboard_page WHERE board_id = ${board.id}::uuid`;
      const have = new Set(pages.map((p) => p.id));
      if (order.length !== have.size || new Set(order).size !== order.length || order.some((id) => !have.has(id))) {
        throw invalid('pageIds: every page id of the board, each once');
      }
      await tx.$executeRaw`SET CONSTRAINTS chat.whiteboard_page_position DEFERRED`;
      for (const [position, id] of order.entries()) {
        await tx.$executeRaw`UPDATE chat.whiteboard_page SET position = ${position} WHERE id = ${id}::uuid`;
      }
      return this.detail(tx, await this.ownBoard(tx, board.id, teacherId, organizationId), true);
    });
  }

  // ---------------------------------------------------------------------------
  // Staff: read-only (§10 1b), and a departed teacher's boards (4a)
  // ---------------------------------------------------------------------------

  /** A teacher's boards in use and kept, for a reader of that teacher. Opening one is logged; listing is not. */
  async teacherBoards(teacherId: string, actor: Actor): Promise<BoardSummary[]> {
    const teacher = this.uuid(teacherId, 'teacherId');
    await this.readerBasis(this.prisma, actor, teacher);
    const rows = await this.prisma.$queryRaw<BoardRow[]>`${BOARD_SELECT}
      WHERE w.teacher_id = ${teacher}::uuid AND w.organization_id = ${actor.organizationId}::uuid
        AND w.state IN ('active', 'retained')
      ORDER BY w.updated_at DESC`;
    return rows.map(summary);
  }

  async review(boardId: string, actor: Actor): Promise<BoardDetail> {
    return this.prisma.$transaction(async (tx) => {
      const board = await this.readableBoard(tx, boardId, actor);
      const basis = await this.readerBasis(tx, actor, board.teacher_id);
      await this.record(tx, board, { id: actor.actorId, kind: 'staff', basis }, 'open');
      return this.detail(tx, board, false);
    });
  }

  /** §10 1c, 4b: who opened or acted on the board, oldest first. Whiteboards.retention holders. */
  async accessLog(boardId: string, actor: Actor) {
    const board = await this.readableBoard(this.prisma, boardId, actor);
    await this.readerBasis(this.prisma, actor, board.teacher_id);
    const rows = await this.prisma.$queryRaw<Array<{ viewer_id: string | null; viewer_kind: string; viewer_name: string | null; basis: string; action: string; detail: unknown; at: Date }>>`
      SELECT l.viewer_id::text AS viewer_id, l.viewer_kind, COALESCE(s.name, t.name) AS viewer_name,
             l.basis, l.action, l.detail, l.at
        FROM chat.whiteboard_access_log l
        LEFT JOIN chat.staff s ON s.id = l.viewer_id AND l.viewer_kind = 'staff'
        LEFT JOIN chat.teacher t ON t.id = l.viewer_id AND l.viewer_kind = 'teacher'
       WHERE l.board_id = ${board.id}::uuid AND l.organization_id = ${board.organization_id}::uuid
       ORDER BY l.at, l.id`;
    return rows.map((r) => ({
      viewerId: r.viewer_id,
      viewerKind: r.viewer_kind,
      viewerName: r.viewer_name,
      basis: r.basis,
      action: r.action,
      detail: r.detail ?? null,
      at: r.at.toISOString(),
    }));
  }

  /**
   * §10 4a: a departed teacher's board, given to an active teacher as a new
   * board of their own. The original is unchanged and keeps its 12 months.
   */
  async copyToTeacher(boardId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardSummary> {
    const target = this.uuid(body.teacherId, 'teacherId');
    if (currentImpersonationId()) throw new CommError(CommErrorCode.WHITEBOARD_DENIED, 'a support session never copies a board');
    return this.write(async (tx) => {
      const source = await this.readableBoard(tx, boardId, actor);
      const basis = await this.readerBasis(tx, actor, source.teacher_id);
      if (source.state !== 'retained') throw state("only a departed teacher's board is copied to another teacher");
      const [teacher] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM chat.teacher
         WHERE id = ${target}::uuid AND organization_id = ${source.organization_id}::uuid AND is_active AND left_at IS NULL`;
      if (!teacher) throw invalid('teacherId: an active teacher of this organization');
      await this.lockTeacher(tx, target);
      await this.assertBoardRoom(tx, target);
      await this.assertDocumentRoom(tx, target, await this.boardBytes(tx, source.id), null);
      const copy = await this.copyBoard(tx, source, target, source.organization_id, source.title);
      await this.record(tx, source, { id: actor.actorId, kind: 'staff', basis }, 'copy', { toBoardId: copy, toTeacherId: target });
      const [row] = await tx.$queryRaw<BoardRow[]>`${BOARD_SELECT} WHERE w.id = ${copy}::uuid`;
      return summary(row);
    });
  }

  // ---------------------------------------------------------------------------
  // The worker: purge (§10 4d, 4a) and the retention notice (4c)
  // ---------------------------------------------------------------------------

  /**
   * Boards past their 30 days in trash or 12 months kept: storage objects
   * first, then the rows (with a 'purge' log row that outlives them). A board
   * whose objects could not all be deleted stays for the next sweep.
   * Idempotent and safe on every replica (each board is claimed with SKIP LOCKED).
   */
  async purgeDue(now: Date = new Date()): Promise<{ purged: number; failed: number }> {
    const due = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.whiteboard
       WHERE (state = 'trashed' AND purge_after <= ${now})
          OR (state = 'retained' AND retained_until <= ${now})
       ORDER BY COALESCE(purge_after, retained_until)
       LIMIT ${PURGE_BATCH}`;
    let purged = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        const keys = await this.prisma.$queryRaw<Array<{ object_key: string }>>`
          SELECT object_key FROM chat.whiteboard_asset WHERE board_id = ${id}::uuid`;
        for (const { object_key } of keys) await this.storage.delete(object_key);
        const done = await this.prisma.$transaction(async (tx) => {
          const [board] = await tx.$queryRaw<Array<{ organization_id: string; teacher_id: string; state: string }>>`
            SELECT organization_id::text AS organization_id, teacher_id::text AS teacher_id, state FROM chat.whiteboard
             WHERE id = ${id}::uuid
               AND ((state = 'trashed' AND purge_after <= ${now}) OR (state = 'retained' AND retained_until <= ${now}))
             FOR UPDATE SKIP LOCKED`;
          if (!board) return false;
          await tx.$executeRaw`DELETE FROM chat.whiteboard WHERE id = ${id}::uuid`;
          await tx.$executeRaw`
            INSERT INTO chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action, detail)
            VALUES (${board.organization_id}::uuid, ${id}::uuid, ${board.teacher_id}::uuid, NULL, 'system', 'system', 'purge',
                    jsonb_build_object('from', ${board.state}::text))`;
          return true;
        });
        if (done) purged += 1;
      } catch (e) {
        failed += 1;
        this.log.warn(`board ${id} not purged this sweep: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { purged, failed };
  }

  /**
   * §10 4c: once per departed teacher, 30 days before their boards' 12 months
   * end, the Teachers Manager and the super admin are told (PD-34 Center and
   * push). A name, a count and a date: never a board's content.
   */
  async retentionNotices(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.$queryRaw<Array<{ organization_id: string; teacher_id: string; name: string; boards: number; until: Date }>>`
      SELECT w.organization_id::text AS organization_id, w.teacher_id::text AS teacher_id, t.name,
             count(*)::int AS boards, min(w.retained_until) AS until
        FROM chat.whiteboard w JOIN chat.teacher t ON t.id = w.teacher_id
       WHERE w.state = 'retained' AND w.retention_notified_at IS NULL
         AND w.retained_until <= ${now}::timestamptz + interval '30 days'
       GROUP BY w.organization_id, w.teacher_id, t.name`;
    let sent = 0;
    for (const d of due) {
      const date = d.until.toISOString().slice(0, 10);
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO chat.notification
            (organization_id, dedupe_key, template_key, event_type, recipient_id, locale, channel, priority, variables, status, scheduled_at)
          SELECT ${d.organization_id}::uuid,
                 'whiteboard_retention_expiring:' || ${d.teacher_id} || ':' || ${date} || ':' || r.id,
                 'whiteboard_retention_expiring', 'whiteboard_retention_expiring', r.id, 'ar', 'push', 'normal',
                 jsonb_build_object('teacher', ${d.name}::text, 'boards', ${d.boards}::int, 'date', ${date}::text),
                 'scheduled', ${now}::timestamptz
            FROM (
              SELECT s.id FROM chat.department dep JOIN chat.staff s ON s.id = dep.manager_id
               WHERE dep.organization_id = ${d.organization_id}::uuid AND dep.kind = 'teachers'
                 AND s.is_active AND s.left_at IS NULL
              UNION
              SELECT s.id FROM chat.staff s
               WHERE s.organization_id = ${d.organization_id}::uuid AND s.role = 'super_admin'
                 AND s.is_active AND s.left_at IS NULL
            ) r
          ON CONFLICT (dedupe_key) DO NOTHING`;
        await tx.$executeRaw`
          UPDATE chat.whiteboard SET retention_notified_at = ${now}::timestamptz
           WHERE teacher_id = ${d.teacher_id}::uuid AND state = 'retained' AND retention_notified_at IS NULL
             AND retained_until <= ${now}::timestamptz + interval '30 days'`;
      });
      sent += 1;
    }
    return sent;
  }

  // ---------------------------------------------------------------------------
  // Who the caller is
  // ---------------------------------------------------------------------------

  private teacher(actor: Actor): { teacherId: string; organizationId: string } {
    if (actor.kind !== ActorKind.TEACHER || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.WHITEBOARD_DENIED, 'boards belong to teachers');
    }
    return { teacherId: actor.actorId, organizationId: actor.organizationId };
  }

  /** §10 1a: the teacher themself -- never a support session opened on their account. */
  private writer(actor: Actor): { teacherId: string; organizationId: string } {
    const who = this.teacher(actor);
    if (currentImpersonationId()) throw new CommError(CommErrorCode.WHITEBOARD_DENIED, 'a support session reads boards; only the teacher edits them');
    return who;
  }

  /**
   * §10 1b: the staff member's basis for reading this teacher's boards, or 404.
   * chat.staff_supervised_teacher_ids is exactly the owner's four roles in
   * both states of the PD-35 switch (TeacherScopeService.covers is
   * department-wide while it is off: never used here).
   */
  private async readerBasis(db: Tx | PrismaService, actor: Actor, teacherId: string): Promise<Basis> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw notFound();
    const [row] = await db.$queryRaw<Array<{ reaches: boolean; manager: boolean; assigned: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM chat.staff_supervised_teacher_ids(${actor.actorId}::uuid, now()) t WHERE t = ${teacherId}::uuid) AS reaches,
             EXISTS (SELECT 1 FROM chat.department d
                      WHERE d.kind = 'teachers' AND d.manager_id = ${actor.actorId}::uuid
                        AND d.organization_id = ${actor.organizationId}::uuid) AS manager,
             EXISTS (SELECT 1 FROM chat.teacher_supervisor_assignment a
                      WHERE a.teacher_id = ${teacherId}::uuid AND a.supervisor_id = ${actor.actorId}::uuid) AS assigned`;
    if (!row?.reaches) throw notFound();
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return 'super_admin';
    if (row.manager) return 'teachers_manager';
    return row.assigned ? 'supervisor' : 'backup';
  }

  // ---------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------

  private async ownBoard(tx: Tx, boardId: unknown, teacherId: string, organizationId: string, includeTrash = true): Promise<BoardRow> {
    const id = this.boardId(boardId);
    const [row] = await tx.$queryRaw<BoardRow[]>`${BOARD_SELECT}
      WHERE w.id = ${id}::uuid AND w.teacher_id = ${teacherId}::uuid AND w.organization_id = ${organizationId}::uuid`;
    if (!row || (!includeTrash && row.state === 'trashed') || row.state === 'retained') throw notFound();
    return row;
  }

  /** A board staff may read: in use or kept, in the caller's organization. Trash is the teacher's. */
  private async readableBoard(db: Tx | PrismaService, boardId: unknown, actor: Actor): Promise<BoardRow> {
    const id = this.boardId(boardId);
    if (!actor.organizationId) throw notFound();
    const [row] = await db.$queryRaw<BoardRow[]>`${BOARD_SELECT}
      WHERE w.id = ${id}::uuid AND w.organization_id = ${actor.organizationId}::uuid AND w.state IN ('active', 'retained')`;
    if (!row) throw notFound();
    return row;
  }

  /**
   * Claims the next revision: the board must be the caller's, in use, and at
   * the revision the write names. Locks the board row for the transaction.
   */
  private async bump(tx: Tx, boardId: unknown, teacherId: string, organizationId: string, revision: unknown): Promise<BoardRow> {
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) throw invalid('revision: the board revision this change was made against');
    const id = this.boardId(boardId);
    const [bumped] = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE chat.whiteboard SET revision = revision + 1, updated_at = now()
       WHERE id = ${id}::uuid AND teacher_id = ${teacherId}::uuid AND organization_id = ${organizationId}::uuid
         AND state = 'active' AND revision = ${revision}
      RETURNING id::text AS id`;
    if (bumped) return this.ownBoard(tx, id, teacherId, organizationId);
    const board = await this.ownBoard(tx, id, teacherId, organizationId);
    if (board.state !== 'active') throw state('this board is in Deleted boards; restore it first');
    throw new CommError(CommErrorCode.WHITEBOARD_CONFLICT, `the board is at revision ${board.revision}: reload it, or save your page as a copy`, 409);
  }

  private async assertPage(tx: Tx, boardId: string, pageId: string): Promise<{ position: number }> {
    const [page] = await tx.$queryRaw<Array<{ position: number }>>`
      SELECT position FROM chat.whiteboard_page WHERE id = ${pageId}::uuid AND board_id = ${boardId}::uuid`;
    if (!page) throw new CommError(CommErrorCode.WHITEBOARD_NOT_FOUND, 'no such page on this board');
    return { position: Number(page.position) };
  }

  /** An image names only a ready asset of THIS board (§6.3): 403, never a stored foreign key. */
  private async assertAssets(tx: Tx, boardId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.whiteboard_asset
       WHERE board_id = ${boardId}::uuid AND state = 'ready' AND id = ANY(${assetIds}::uuid[])`;
    if (rows.length !== assetIds.length) throw new CommError(CommErrorCode.WHITEBOARD_DENIED, 'an image names an asset that is not this board\'s', 403);
  }

  private async assertBoardRoom(tx: Tx, teacherId: string): Promise<void> {
    const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.whiteboard WHERE teacher_id = ${teacherId}::uuid AND state = 'active'`;
    if (Number(n) >= BOARDS_PER_TEACHER) throw limit(`boards: at most ${BOARDS_PER_TEACHER} in use; move some to Deleted boards`);
  }

  /** The teacher's documents, without `exceptPage`, plus `adding`, within the quota. */
  private async assertDocumentRoom(tx: Tx, teacherId: string, adding: number, exceptPage: string | null): Promise<void> {
    const [{ used }] = await tx.$queryRaw<Array<{ used: bigint }>>`
      SELECT COALESCE(sum(p.document_bytes), 0)::bigint AS used
        FROM chat.whiteboard_page p JOIN chat.whiteboard w ON w.id = p.board_id
       WHERE w.teacher_id = ${teacherId}::uuid AND (${exceptPage}::uuid IS NULL OR p.id <> ${exceptPage}::uuid)`;
    if (Number(used) + adding > DOCUMENT_BYTES_PER_TEACHER) {
      throw limit(`storage: a teacher's boards hold at most ${DOCUMENT_BYTES_PER_TEACHER / (1024 * 1024)} MB of drawings; delete boards you no longer need`);
    }
  }

  private async boardBytes(tx: Tx, boardId: string): Promise<number> {
    const [{ bytes }] = await tx.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT COALESCE(sum(document_bytes), 0)::bigint AS bytes FROM chat.whiteboard_page WHERE board_id = ${boardId}::uuid`;
    return Number(bytes);
  }

  /**
   * A new board of `teacherId` with the source's pages. Images come with the
   * asset routes (PR-4): until then no board has any, and a copy of one that
   * has is refused rather than made with broken references.
   */
  private async copyBoard(tx: Tx, source: BoardRow, teacherId: string, organizationId: string, title: string): Promise<string> {
    const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.whiteboard_asset WHERE board_id = ${source.id}::uuid`;
    if (Number(n) > 0) throw state('a board with images cannot be copied yet');
    const lessonId = teacherId === source.teacher_id ? source.lesson_id : null;
    const [{ id }] = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO chat.whiteboard (organization_id, teacher_id, lesson_id, title)
      VALUES (${organizationId}::uuid, ${teacherId}::uuid, ${lessonId}::uuid, ${title})
      RETURNING id::text AS id`;
    await tx.$executeRaw`
      INSERT INTO chat.whiteboard_page (board_id, position, layout, background, document)
      SELECT ${id}::uuid, position, layout, background, document
        FROM chat.whiteboard_page WHERE board_id = ${source.id}::uuid`;
    return id;
  }

  /** Makes room at `position` by moving the pages from there on down by one. */
  private async openGap(tx: Tx, boardId: string, position: number): Promise<void> {
    await tx.$executeRaw`SET CONSTRAINTS chat.whiteboard_page_position DEFERRED`;
    await tx.$executeRaw`
      UPDATE chat.whiteboard_page SET position = position + 1
       WHERE board_id = ${boardId}::uuid AND position >= ${position}`;
  }

  private async detail(tx: Tx, board: BoardRow, canEdit: boolean): Promise<BoardDetail> {
    const pages = await tx.$queryRaw<PageRow[]>`
      SELECT id::text AS id, position, layout, background, document, updated_at
        FROM chat.whiteboard_page WHERE board_id = ${board.id}::uuid ORDER BY position`;
    return {
      ...summary(board),
      teacherId: board.teacher_id,
      canEdit: canEdit && board.state === 'active',
      pages: pages.map((p) => ({
        id: p.id,
        position: Number(p.position),
        layout: p.layout,
        background: p.background,
        document: p.document,
        updatedAt: p.updated_at.toISOString(),
      })),
    };
  }

  /** §10 1c: written in the caller's transaction, so a read never outruns its row. */
  private async record(tx: Tx, board: BoardRow, viewer: { id: string; kind: 'teacher' | 'staff' | 'support_session'; basis: Basis }, action: Action, detail?: Record<string, string>): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action, detail)
      VALUES (${board.organization_id}::uuid, ${board.id}::uuid, ${board.teacher_id}::uuid, ${viewer.id}::uuid,
              ${viewer.kind}, ${viewer.basis}, ${action}, ${detail ? JSON.stringify(detail) : null}::jsonb)`;
  }

  private async lockTeacher(tx: Tx, teacherId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'whiteboard:' + teacherId}))`;
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw refusal(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Request fields
  // ---------------------------------------------------------------------------

  private boardId(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw notFound();
    return value.toLowerCase();
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field}: an id`);
    return value.toLowerCase();
  }

  private title(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120) throw invalid('title: 1-120 characters');
    return value.trim();
  }

  private copyTitle(title: string): string {
    const suffix = ' (2)';
    return (title.length + suffix.length > 120 ? title.slice(0, 120 - suffix.length) : title) + suffix;
  }

  private choice<T extends string>(value: unknown, options: readonly T[], field: string, fallback: T): T {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) throw invalid(`${field}: one of ${options.join(', ')}`);
    return value as T;
  }

  private position(value: unknown, count: number): number {
    if (value === undefined || value === null) return count;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > count) throw invalid(`position: 0-${count}`);
    return value;
  }
}

/** Every board read selects the same columns, with its page count. */
const BOARD_SELECT = Prisma.sql`
  SELECT w.id::text AS id, w.organization_id::text AS organization_id, w.teacher_id::text AS teacher_id,
         w.lesson_id::text AS lesson_id, w.title, w.revision, w.state, w.trashed_at, w.purge_after,
         w.retained_until, w.created_at, w.updated_at,
         (SELECT count(*)::int FROM chat.whiteboard_page p WHERE p.board_id = w.id) AS page_count
    FROM chat.whiteboard w`;
