import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { NotificationService } from '../communication/notifications/notification.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { PrismaService } from '../platform/prisma.service';
import { currentImpersonationId } from '../platform/request-context';
import { ACADEMY_ZONE, canonicalZone, dayIn } from '../platform/time-zone';
import { zonesOf } from '../platform/time-zone.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { Actor } from '../platform/types';
import { WhiteboardAssetService, keptKey, type AssetRow, type AssetView } from './whiteboard-asset.service';
import { BACKGROUNDS, LAYOUTS, checkDocument } from './whiteboard-document';
import { composeBoardPdf } from './whiteboard-export';
import { BOARD_IMAGE_MAX_BYTES, BOARD_IMAGE_TYPES } from './whiteboard-image';

/** §6.4, sized for 200 teachers (owner 2026-10-28). */
export const BOARDS_PER_TEACHER = 200;
export const PAGES_PER_BOARD = 50;
/** Documents per teacher, in Postgres (§11.2). */
export const DOCUMENT_BYTES_PER_TEACHER = 25 * 1024 * 1024;
/** §6.4: images per board, and a teacher's images in object storage (boards in trash count until purged). */
export const ASSETS_PER_BOARD = 60;
export const ASSET_BYTES_PER_TEACHER = 300 * 1024 * 1024;
/** §6.4: exports a teacher may have under way at once. */
export const EXPORTS_IN_FLIGHT = 5;
/** How many abandoned uploads one sweep clears. */
const ASSET_SWEEP_BATCH = 200;
/** How many due boards one sweep purges; the next sweep takes the rest. */
const PURGE_BATCH = 50;
/** A board whose objects could not be deleted waits 1 h, 2 h, 4 h ... up to 7 days behind the rest. */
const PURGE_RETRY_MAX_HOURS = 7 * 24;

type Tx = Prisma.TransactionClient;
type Basis = 'owner' | 'supervisor' | 'backup' | 'teachers_manager' | 'super_admin' | 'support_session';
type Action = 'open' | 'list' | 'read_log' | 'trash' | 'restore' | 'copy' | 'export';
interface Viewer {
  id: string;
  kind: 'teacher' | 'staff' | 'support_session';
  basis: Basis;
  /** A support session: which one (the viewer is its operator). */
  detail?: Record<string, string>;
}

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
  /** PR-4: the board's images, each with a short-lived signed URL (§6.3). */
  assets: AssetView[];
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
/** `which` is named in `detail.limit` so a client can say which limit was hit. */
const limit = (which: 'boards' | 'pages' | 'storage' | 'assets' | 'exports', message: string) => new CommError(CommErrorCode.WHITEBOARD_LIMIT, message, 409, { limit: which });
const state = (detail: string) => new CommError(CommErrorCode.WHITEBOARD_STATE, detail, 409);

/**
 * A refusal raised by the database becomes an answer in our own words: never
 * the database's or Prisma's text, which names tables and constraints
 * (review of #279, P2-8). Anything that is not a refusal is rethrown (500).
 */
export function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) && !(e instanceof Prisma.PrismaClientUnknownRequestError)) return e;
  const meta = (e as { meta?: { code?: string; message?: string } }).meta;
  const raw = String(meta?.message ?? e.message);
  const sqlstate = meta?.code ?? (/\b(23514|23503)\b/.exec(raw)?.[1] ?? '');
  if (/whiteboard_page_size/.test(raw)) return pageTooLarge();
  if (sqlstate === '23514' || /check_violation/.test(raw)) return invalid('the board refused this change');
  if (sqlstate === '23503') return invalid('the board names a lesson or teacher that does not exist');
  return e;
}

/** The one size measure is the database's (chat.whiteboard_page.document_bytes); 413 like an oversized body. */
const pageTooLarge = () => new CommError(CommErrorCode.WHITEBOARD_LIMIT, 'page: a page holds at most 512 KB; add a page', 413, { limit: 'page' });

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
    private readonly notifications: NotificationService,
    private readonly assets: WhiteboardAssetService,
    private readonly config: AppConfigService,
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
    return this.read(async (tx) => {
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId);
      if (board.state !== 'active') throw state('a board in Deleted boards opens only after it is restored');
      await this.record(tx, board, support ? await this.operatorOf(tx, support) : { id: teacherId, kind: 'teacher', basis: 'owner' }, 'open');
      await this.readOnly(tx);
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
      const copy = await this.copyBoard(tx, source, teacherId, organizationId, this.copyTitle(source.title));
      await this.assertQuota(tx, teacherId);
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
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId);
      if (board.state !== 'trashed') throw state('only a board in Deleted boards can be restored');
      await this.assertBoardRoom(tx, teacherId);
      // Past its 30 days the purge owns it (the database's clock decides, as the purge's does).
      const [restoredRow] = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE chat.whiteboard
           SET state = 'active', trashed_at = NULL, purge_after = NULL, purge_attempts = 0, purge_retry_at = NULL, updated_at = now()
         WHERE id = ${board.id}::uuid AND state = 'trashed' AND purge_after > now()
        RETURNING id::text AS id`;
      if (!restoredRow) throw notFound();
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
      if (count >= PAGES_PER_BOARD) throw limit('pages', `pages: a board holds at most ${PAGES_PER_BOARD}`);
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
    if (!checked.ok) throw checked.tooLarge ? pageTooLarge() : invalid(checked.reason);
    const layout = body.layout === undefined ? null : this.choice(body.layout, LAYOUTS, 'layout', 'plain');
    const background = body.background === undefined ? null : this.choice(body.background, BACKGROUNDS, 'background', 'white');
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      await this.assertPage(tx, board.id, page);
      await this.assertAssets(tx, board.id, checked.value.assetIds);
      const [row] = await tx.$queryRaw<Array<{ updated_at: Date }>>`
        UPDATE chat.whiteboard_page
           SET document = ${JSON.stringify(checked.value.document)}::jsonb,
               layout = COALESCE(${layout}, layout),
               background = COALESCE(${background}, background),
               updated_at = now()
         WHERE id = ${page}::uuid AND board_id = ${board.id}::uuid
        RETURNING updated_at`;
      await this.assertQuota(tx, teacherId);
      return { revision: board.revision, pageId: page, updatedAt: row.updated_at.toISOString() };
    });
  }

  async duplicatePage(boardId: string, pageId: string, body: Record<string, unknown>, actor: Actor): Promise<BoardDetail> {
    const { teacherId, organizationId } = this.writer(actor);
    const page = this.uuid(pageId, 'pageId');
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.bump(tx, boardId, teacherId, organizationId, body.revision);
      if (Number(board.page_count) >= PAGES_PER_BOARD) throw limit('pages', `pages: a board holds at most ${PAGES_PER_BOARD}`);
      const source = await this.assertPage(tx, board.id, page);
      await this.openGap(tx, board.id, source.position + 1);
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_page (board_id, position, layout, background, document)
        SELECT board_id, ${source.position + 1}, layout, background, document
          FROM chat.whiteboard_page WHERE id = ${page}::uuid`;
      await this.assertQuota(tx, teacherId);
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

  /**
   * A teacher's boards in use and kept, for a reader of that teacher. A listing
   * names the boards, so each one named is logged ('list'), as an open is.
   */
  async teacherBoards(teacherId: string, actor: Actor): Promise<BoardSummary[]> {
    const teacher = this.uuid(teacherId, 'teacherId');
    return this.read(async (tx) => {
      const basis = await this.readerBasis(tx, actor, teacher);
      const rows = await tx.$queryRaw<BoardRow[]>`${BOARD_SELECT}
        WHERE w.teacher_id = ${teacher}::uuid AND w.organization_id = ${actor.organizationId}::uuid
          AND w.state IN ('active', 'retained')
        ORDER BY w.updated_at DESC`;
      for (const board of rows) await this.record(tx, board, { id: actor.actorId, kind: 'staff', basis }, 'list');
      await this.readOnly(tx);
      return rows.map(summary);
    });
  }

  async review(boardId: string, actor: Actor): Promise<BoardDetail> {
    return this.read(async (tx) => {
      const board = await this.readableBoard(tx, boardId, actor);
      const basis = await this.readerBasis(tx, actor, board.teacher_id);
      await this.record(tx, board, { id: actor.actorId, kind: 'staff', basis }, 'open');
      await this.readOnly(tx);
      return this.detail(tx, board, false);
    });
  }

  /**
   * §10 1c, 4b: who opened or acted on the board, oldest first -- read from the
   * log itself, so it stays readable for a board in trash and after its purge.
   * The reader must still reach the board's teacher (a departed teacher's are
   * reached by the Teachers Manager and the super admin). Reading it is logged.
   */
  async accessLog(boardId: string, actor: Actor) {
    const id = this.boardId(boardId);
    if (!actor.organizationId) throw notFound();
    return this.read(async (tx) => {
      const [owner] = await tx.$queryRaw<Array<{ teacher_id: string }>>`
        SELECT teacher_id::text AS teacher_id FROM chat.whiteboard_access_log
         WHERE board_id = ${id}::uuid AND organization_id = ${actor.organizationId}::uuid
         LIMIT 1`;
      if (!owner) throw notFound();
      const basis = await this.readerBasis(tx, actor, owner.teacher_id);
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action)
        VALUES (${actor.organizationId}::uuid, ${id}::uuid, ${owner.teacher_id}::uuid, ${actor.actorId}::uuid, 'staff', ${basis}, 'read_log')`;
      await this.readOnly(tx);
      const rows = await tx.$queryRaw<Array<{ viewer_id: string | null; viewer_kind: string; viewer_name: string | null; basis: string; action: string; detail: unknown; at: Date }>>`
        SELECT l.viewer_id::text AS viewer_id, l.viewer_kind, COALESCE(s.name, t.name) AS viewer_name,
               l.basis, l.action, l.detail, l.at
          FROM chat.whiteboard_access_log l
          LEFT JOIN chat.staff s ON s.id = l.viewer_id AND l.viewer_kind IN ('staff', 'support_session')
          LEFT JOIN chat.teacher t ON t.id = l.viewer_id AND l.viewer_kind = 'teacher'
         WHERE l.board_id = ${id}::uuid AND l.organization_id = ${actor.organizationId}::uuid
         ORDER BY l.at, l.id`;
      return rows.map((r) => ({
        viewerId: r.viewer_id,
        // A support session is shown as "support session by <viewerName>", the operator.
        viewerKind: r.viewer_kind,
        viewerName: r.viewer_name,
        basis: r.basis,
        action: r.action,
        detail: r.detail ?? null,
        at: r.at.toISOString(),
      }));
    });
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
      const copy = await this.copyBoard(tx, source, target, source.organization_id, source.title);
      await this.assertQuota(tx, target);
      await this.record(tx, source, { id: actor.actorId, kind: 'staff', basis }, 'copy', { toBoardId: copy, toTeacherId: target });
      const [row] = await tx.$queryRaw<BoardRow[]>`${BOARD_SELECT} WHERE w.id = ${copy}::uuid`;
      return summary(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Images and export (PR-4, §4.4, §4.6, §6.3): off until the bucket is ready
  // ---------------------------------------------------------------------------

  /**
   * A signed PUT for one image of the teacher's board, for a key the server
   * chose: the client never names one. The asset waits as `pending` for an
   * hour; only a confirm makes it something a page may name.
   */
  async grantImage(boardId: string, body: Record<string, unknown>, actor: Actor) {
    await this.assetsOn();
    const { teacherId, organizationId } = this.writer(actor);
    if (body.kind !== undefined && body.kind !== 'image') throw invalid('kind: image (PDF pages are not imported yet)');
    if (typeof body.contentType !== 'string' || !(BOARD_IMAGE_TYPES as readonly string[]).includes(body.contentType)) {
      throw invalid(`contentType: one of ${BOARD_IMAGE_TYPES.join(', ')}`);
    }
    const contentType = body.contentType;
    const byteSize = this.byteSize(body.byteSize, 'byteSize');
    const assetId = randomUUID();
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId, false);
      if (board.state !== 'active') throw state('restore the board first');
      const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM chat.whiteboard_asset WHERE board_id = ${board.id}::uuid AND kind IN ('image', 'pdf_page')`;
      if (Number(n) >= ASSETS_PER_BOARD) throw limit('assets', `images: at most ${ASSETS_PER_BOARD} on one board`);
      await this.assertAssetQuota(tx, teacherId, byteSize);
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_asset (id, board_id, kind, object_key, content_type, byte_size, expires_at)
        VALUES (${assetId}::uuid, ${board.id}::uuid, 'image', ${keptKey(board.organization_id, board.id, assetId)},
                ${contentType}, ${byteSize}, now() + interval '1 hour')`;
      const upload = await this.assets.grant(board.organization_id, board.id, assetId, contentType, byteSize);
      return { assetId, upload };
    });
  }

  /**
   * The upload copied to the image's own key and inspected THERE (type, end,
   * size, a still image, at most 8,000 px): only then is it `ready`. Replaying
   * a confirm answers the ready image again.
   */
  async confirmImage(boardId: string, assetId: string, body: Record<string, unknown>, actor: Actor): Promise<{ asset: AssetView; replayed?: true }> {
    await this.assetsOn();
    const { teacherId, organizationId } = this.writer(actor);
    const id = this.uuid(assetId, 'assetId');
    const found = await this.read(async (tx) => {
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId, false);
      const [row] = await tx.$queryRaw<Array<AssetRow & { state: string; expired: boolean }>>`
        SELECT id::text AS id, kind, object_key, content_type, byte_size, width, height, state,
               (expires_at IS NOT NULL AND expires_at <= now()) AS expired
          FROM chat.whiteboard_asset WHERE id = ${id}::uuid AND board_id = ${board.id}::uuid AND kind = 'image'`;
      return { board, row };
    });
    const { board, row } = found;
    if (!row) throw new CommError(CommErrorCode.WHITEBOARD_NOT_FOUND, 'no such image on this board');
    if (row.state === 'ready') return { asset: (await this.assets.sign(board, [row]))[0], replayed: true };
    if (row.expired) throw state('the upload expired; add the image again');
    if (!this.assets.isUploadOf(body.objectKey, board.organization_id, board.id, row.id)) throw invalid('objectKey: the upload this image was granted');
    const pinned = await this.assets.pin(body.objectKey, row.object_key, { contentType: row.content_type, byteSize: Number(row.byte_size) });
    const ready = await this.write(async (tx) => {
      const [r] = await tx.$queryRaw<AssetRow[]>`
        UPDATE chat.whiteboard_asset
           SET state = 'ready', sha256 = ${pinned.sha256}, width = ${pinned.width}, height = ${pinned.height}, expires_at = NULL
         WHERE id = ${row.id}::uuid AND board_id = ${board.id}::uuid AND state = 'pending'
        RETURNING id::text AS id, kind, object_key, content_type, byte_size, width, height`;
      return r ?? null;
    });
    await this.assets.deleteQuietly([body.objectKey]);
    if (!ready) throw state('this image was confirmed or removed meanwhile; reload the board');
    return { asset: (await this.assets.sign(board, [ready]))[0] };
  }

  /**
   * The board's images signed again (a signed URL lives 15 minutes). The
   * owner, or a support session reading the board; logged as an open (§10 1c).
   */
  async imageUrls(boardId: string, actor: Actor): Promise<{ assets: AssetView[] }> {
    const { teacherId, organizationId } = this.teacher(actor);
    const support = currentImpersonationId();
    return this.read(async (tx) => {
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId, false);
      await this.record(tx, board, support ? await this.operatorOf(tx, support) : { id: teacherId, kind: 'teacher', basis: 'owner' }, 'open', { what: 'images' });
      await this.readOnly(tx);
      return { assets: await this.signedImages(tx, board) };
    });
  }

  /**
   * §4.6: a PDF export starts with a signed PUT per page, for the PNG the
   * client draws of it (the one renderer). The pages of one export share one
   * expiry, which is how compose knows them as one; at most 5 exports may be
   * under way per teacher.
   */
  async grantExport(boardId: string, body: Record<string, unknown>, actor: Actor) {
    await this.assetsOn();
    const { teacherId, organizationId } = this.writer(actor);
    if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > PAGES_PER_BOARD) {
      throw invalid(`pages: 1-${PAGES_PER_BOARD} entries of {byteSize}`);
    }
    const sizes = body.pages.map((p, i) => this.byteSize((p as Record<string, unknown> | null)?.byteSize, `pages[${i}].byteSize`));
    return this.write(async (tx) => {
      await this.lockTeacher(tx, teacherId);
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId, false);
      if (board.state !== 'active') throw state('restore the board first');
      if (sizes.length > Number(board.page_count)) throw invalid(`pages: the board has ${board.page_count}`);
      const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(DISTINCT a.expires_at)::int AS n
          FROM chat.whiteboard_asset a JOIN chat.whiteboard w ON w.id = a.board_id
         WHERE w.teacher_id = ${teacherId}::uuid AND a.kind = 'export_page' AND a.state = 'pending' AND a.expires_at > now()`;
      if (Number(n) >= EXPORTS_IN_FLIGHT) throw limit('exports', `exports: at most ${EXPORTS_IN_FLIGHT} at once; wait for one to finish`);
      const pages: Array<{ assetId: string; upload: Awaited<ReturnType<WhiteboardAssetService['grant']>> }> = [];
      for (const byteSize of sizes) {
        const assetId = randomUUID();
        // now() is the transaction's: every page of this export gets the same expiry.
        await tx.$executeRaw`
          INSERT INTO chat.whiteboard_asset (id, board_id, kind, object_key, content_type, byte_size, expires_at)
          VALUES (${assetId}::uuid, ${board.id}::uuid, 'export_page', ${keptKey(board.organization_id, board.id, assetId)},
                  'image/png', ${byteSize}, now() + interval '1 hour')`;
        pages.push({ assetId, upload: await this.assets.grant(board.organization_id, board.id, assetId, 'image/png', byteSize) });
      }
      return { pages };
    });
  }

  /**
   * The export's PNGs, each checked like an image, laid out as a PDF with the
   * Quran text's credit when the board carries a verse (§4.3). Logged as
   * 'export'. Nothing of it is kept: the PDF goes back in the answer, and the
   * pages are deleted.
   */
  async composeExport(boardId: string, body: Record<string, unknown>, actor: Actor): Promise<{ pdf: Buffer; fileName: string }> {
    await this.assetsOn();
    const { teacherId, organizationId } = this.writer(actor);
    if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > PAGES_PER_BOARD) {
      throw invalid(`pages: 1-${PAGES_PER_BOARD} entries of {assetId, objectKey}, in page order`);
    }
    const asked = body.pages.map((p, i) => {
      const item = (p ?? {}) as Record<string, unknown>;
      return { id: this.uuid(item.assetId, `pages[${i}].assetId`), objectKey: item.objectKey };
    });
    if (new Set(asked.map((a) => a.id)).size !== asked.length) throw invalid('pages: each page once');
    const { board, rows } = await this.read(async (tx) => {
      const board = await this.ownBoard(tx, boardId, teacherId, organizationId, false);
      if (board.state !== 'active') throw state('restore the board first');
      const rows = await tx.$queryRaw<Array<AssetRow & { batch: Date; expired: boolean; in_batch: number }>>`
        SELECT a.id::text AS id, a.kind, a.object_key, a.content_type, a.byte_size, a.width, a.height,
               a.expires_at AS batch, a.expires_at <= now() AS expired,
               (SELECT count(*)::int FROM chat.whiteboard_asset b
                 WHERE b.board_id = a.board_id AND b.kind = 'export_page' AND b.state = 'pending' AND b.expires_at = a.expires_at) AS in_batch
          FROM chat.whiteboard_asset a
         WHERE a.board_id = ${board.id}::uuid AND a.kind = 'export_page' AND a.state = 'pending'
           AND a.id = ANY(${asked.map((a) => a.id)}::uuid[])`;
      return { board, rows };
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const first = rows[0];
    if (rows.length !== asked.length || !first || rows.some((r) => r.batch.getTime() !== first.batch.getTime()) || Number(first.in_batch) !== asked.length) {
      throw invalid('pages: every page of one export, each once');
    }
    if (first.expired) throw state('the export expired; export again');
    const kept: string[] = [];
    try {
      const pngs: Buffer[] = [];
      for (const a of asked) {
        const row = byId.get(a.id) as AssetRow;
        if (!this.assets.isUploadOf(a.objectKey, board.organization_id, board.id, row.id)) throw invalid('pages: an objectKey is not the upload its page was granted');
        const pinned = await this.assets.pin(a.objectKey, row.object_key, { contentType: 'image/png', byteSize: Number(row.byte_size) });
        kept.push(row.object_key);
        pngs.push(pinned.bytes);
      }
      const credits = await this.prisma.$queryRaw<Array<{ attribution: string }>>`
        SELECT DISTINCT d.attribution
          FROM chat.whiteboard_page p
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.document -> 'elements', '[]'::jsonb)) e
          JOIN chat.quran_dataset d ON d.id = e ->> 'datasetId'
         WHERE p.board_id = ${board.id}::uuid AND e ->> 'kind' = 'verse'`;
      const credit = credits.length ? `Quran text: ${credits.map((c) => c.attribution).join('; ')}` : null;
      const pdf = await composeBoardPdf({ title: board.title, pages: pngs, credit });
      await this.write(async (tx) => {
        await this.record(tx, board, { id: teacherId, kind: 'teacher', basis: 'owner' }, 'export', { pages: String(asked.length) });
        await tx.$executeRaw`DELETE FROM chat.whiteboard_asset WHERE id = ANY(${asked.map((a) => a.id)}::uuid[]) AND board_id = ${board.id}::uuid`;
      });
      return { pdf, fileName: exportFileName(board.title) };
    } finally {
      // Nothing of an export is kept: its pages, pinned or not, and its uploads.
      const uploads = asked.flatMap((a) => (this.assets.isUploadOf(a.objectKey, board.organization_id, board.id, a.id) ? [a.objectKey] : []));
      await this.assets.deleteQuietly([...kept, ...uploads]);
    }
  }

  /**
   * The worker: uploads granted but never confirmed (and export pages never
   * composed) are removed an hour on -- their kept-key object if a confirm got
   * that far, then the row. Their upload objects are the bucket lifecycle
   * rule's (`whiteboard-uploads/`), as no grant's key is kept.
   */
  async sweepAbandonedAssets(): Promise<number> {
    const due = await this.prisma.$queryRaw<Array<{ id: string; object_key: string }>>`
      SELECT id::text AS id, object_key FROM chat.whiteboard_asset
       WHERE state = 'pending' AND expires_at <= now()
       ORDER BY expires_at LIMIT ${ASSET_SWEEP_BATCH}`;
    let swept = 0;
    for (const a of due) {
      try {
        await this.storage.delete(a.object_key);
        swept += await this.prisma.$executeRaw`DELETE FROM chat.whiteboard_asset WHERE id = ${a.id}::uuid AND state = 'pending'`;
      } catch (e) {
        this.log.warn(`abandoned board upload ${a.id} not swept: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return swept;
  }

  // ---------------------------------------------------------------------------
  // The worker: purge (§10 4d, 4a) and the retention notice (4c)
  // ---------------------------------------------------------------------------

  /**
   * Boards past their 30 days in trash or 12 months kept. Each board is locked
   * and re-checked FIRST (SKIP LOCKED: safe on every replica, and a restore in
   * flight wins), then its storage objects are deleted, then its rows, with a
   * 'purge' log row that outlives them -- all in that one transaction. A board
   * whose objects cannot be deleted is rolled back and waits behind the rest
   * (purge_retry_at, doubling to 7 days), so it never stalls a sweep. The
   * database's clock decides what is due, as it does for a restore.
   */
  async purgeDue(): Promise<{ purged: number; failed: number }> {
    const due = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.whiteboard
       WHERE ((state = 'trashed' AND purge_after <= now()) OR (state = 'retained' AND retained_until <= now()))
         AND (purge_retry_at IS NULL OR purge_retry_at <= now())
       ORDER BY purge_attempts, COALESCE(purge_after, retained_until)
       LIMIT ${PURGE_BATCH}`;
    let purged = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        const done = await this.prisma.$transaction(
          async (tx) => {
            const [board] = await tx.$queryRaw<Array<{ organization_id: string; teacher_id: string; state: string }>>`
              SELECT organization_id::text AS organization_id, teacher_id::text AS teacher_id, state FROM chat.whiteboard
               WHERE id = ${id}::uuid
                 AND ((state = 'trashed' AND purge_after <= now()) OR (state = 'retained' AND retained_until <= now()))
               FOR UPDATE SKIP LOCKED`;
            if (!board) return false;
            const keys = await tx.$queryRaw<Array<{ object_key: string }>>`
              SELECT object_key FROM chat.whiteboard_asset WHERE board_id = ${id}::uuid`;
            for (const { object_key } of keys) await this.storage.delete(object_key);
            await tx.$executeRaw`DELETE FROM chat.whiteboard WHERE id = ${id}::uuid`;
            await tx.$executeRaw`
              INSERT INTO chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action, detail)
              VALUES (${board.organization_id}::uuid, ${id}::uuid, ${board.teacher_id}::uuid, NULL, 'system', 'system', 'purge',
                      jsonb_build_object('from', ${board.state}::text))`;
            return true;
          },
          { timeout: 60_000 },
        );
        if (done) purged += 1;
      } catch (e) {
        failed += 1;
        this.log.warn(`board ${id} not purged this sweep: ${e instanceof Error ? e.message : String(e)}`);
        await this.prisma.$executeRaw`
          UPDATE chat.whiteboard
             SET purge_attempts = purge_attempts + 1,
                 purge_retry_at = now() + make_interval(hours => LEAST(${PURGE_RETRY_MAX_HOURS}::int, power(2, purge_attempts)::int))
           WHERE id = ${id}::uuid`;
      }
    }
    return { purged, failed };
  }

  /**
   * §10 4c: once per departed teacher, 30 days before their boards' 12 months
   * end, the Teachers Manager and the super admin are told -- through
   * NotificationService.schedule, so the recipient's organization is checked
   * (RT-031) and their quiet hours kept; in the language of their latest
   * device, with the date in their own time zone (PD-22). A name, a count and
   * a date: never a board's content.
   */
  async retentionNotices(): Promise<number> {
    const due = await this.prisma.$queryRaw<Array<{ organization_id: string; teacher_id: string; name: string; boards: number; until: Date }>>`
      SELECT w.organization_id::text AS organization_id, w.teacher_id::text AS teacher_id, t.name,
             count(*)::int AS boards, min(w.retained_until) AS until
        FROM chat.whiteboard w JOIN chat.teacher t ON t.id = w.teacher_id
       WHERE w.state = 'retained' AND w.retention_notified_at IS NULL
         AND w.retained_until <= now() + interval '30 days'
       GROUP BY w.organization_id, w.teacher_id, t.name`;
    if (due.length === 0) return 0;
    const academy = await this.academyZone();
    let sent = 0;
    for (const d of due) {
      const recipients = await this.prisma.$queryRaw<Array<{ id: string; locale: string | null }>>`
        SELECT r.id::text AS id,
               (SELECT dt.locale FROM chat.device_token dt WHERE dt.actor_id = r.id AND dt.is_active
                 ORDER BY dt.last_seen_at DESC LIMIT 1) AS locale
          FROM (
            SELECT s.id FROM chat.department dep JOIN chat.staff s ON s.id = dep.manager_id
             WHERE dep.organization_id = ${d.organization_id}::uuid AND dep.kind = 'teachers'
               AND s.is_active AND s.left_at IS NULL
            UNION
            SELECT s.id FROM chat.staff s
             WHERE s.organization_id = ${d.organization_id}::uuid AND s.role = 'super_admin'
               AND s.is_active AND s.left_at IS NULL
          ) r`;
      const zones = await zonesOf(this.prisma, recipients.map((r) => r.id));
      for (const r of recipients) {
        const lang = r.locale === 'en' ? 'en' : 'ar';
        await this.notifications.schedule({
          dedupeKey: `whiteboard_retention_expiring:${d.teacher_id}:${d.until.toISOString().slice(0, 10)}:${r.id}`,
          templateKey: 'whiteboard_retention_expiring',
          eventType: 'whiteboard_retention_expiring',
          recipientId: r.id,
          locale: lang,
          variables: { teacher: d.name, boards: d.boards, date: dayIn(d.until, zones.get(r.id) ?? academy, lang) },
          scheduledAt: new Date(),
        });
      }
      await this.prisma.$executeRaw`
        UPDATE chat.whiteboard SET retention_notified_at = now()
         WHERE teacher_id = ${d.teacher_id}::uuid AND state = 'retained' AND retention_notified_at IS NULL
           AND retained_until <= now() + interval '30 days'`;
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
    if (Number(n) >= BOARDS_PER_TEACHER) throw limit('boards', `boards: at most ${BOARDS_PER_TEACHER} in use; move some to Deleted boards`);
  }

  /**
   * The teacher's drawings, AFTER the write, within the quota: the database's
   * own measure (document_bytes), the same one the page limit uses (review of
   * #279, P2-2). Over it, the transaction rolls back and nothing is written.
   */
  private async assertQuota(tx: Tx, teacherId: string): Promise<void> {
    const [{ used }] = await tx.$queryRaw<Array<{ used: bigint }>>`
      SELECT COALESCE(sum(p.document_bytes), 0)::bigint AS used
        FROM chat.whiteboard_page p JOIN chat.whiteboard w ON w.id = p.board_id
       WHERE w.teacher_id = ${teacherId}::uuid`;
    if (Number(used) > DOCUMENT_BYTES_PER_TEACHER) {
      throw limit('storage', `storage: a teacher's boards hold at most ${DOCUMENT_BYTES_PER_TEACHER / (1024 * 1024)} MB of drawings; delete boards you no longer need`);
    }
  }

  /**
   * A new board of `teacherId` with the source's pages and its images (§10
   * 4a): each ready image is copied server-side to a key of the NEW board and
   * the pages name the copies, so the new board never points at the old one's
   * objects. Unconfirmed uploads and exports are not copied. The objects are
   * copied last, after every row and limit is in place.
   */
  private async copyBoard(tx: Tx, source: BoardRow, teacherId: string, organizationId: string, title: string): Promise<string> {
    const lessonId = teacherId === source.teacher_id ? source.lesson_id : null;
    const [{ id }] = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO chat.whiteboard (organization_id, teacher_id, lesson_id, title)
      VALUES (${organizationId}::uuid, ${teacherId}::uuid, ${lessonId}::uuid, ${title})
      RETURNING id::text AS id`;
    const images = await tx.$queryRaw<Array<AssetRow & { sha256: string | null }>>`
      SELECT id::text AS id, kind, object_key, content_type, byte_size, width, height, sha256
        FROM chat.whiteboard_asset
       WHERE board_id = ${source.id}::uuid AND state = 'ready' AND kind IN ('image', 'pdf_page')`;
    if (images.length === 0) {
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_page (board_id, position, layout, background, document)
        SELECT ${id}::uuid, position, layout, background, document
          FROM chat.whiteboard_page WHERE board_id = ${source.id}::uuid`;
      return id;
    }
    const renamed = new Map(images.map((a) => [a.id, randomUUID()]));
    const pages = await tx.$queryRaw<Array<{ position: number; layout: string; background: string; document: { v: number; elements: Array<Record<string, unknown>> } }>>`
      SELECT position, layout, background, document FROM chat.whiteboard_page WHERE board_id = ${source.id}::uuid`;
    for (const p of pages) {
      const elements = (p.document?.elements ?? []).map((e) =>
        e.kind === 'image' && typeof e.assetId === 'string' && renamed.has(e.assetId.toLowerCase()) ? { ...e, assetId: renamed.get(e.assetId.toLowerCase()) } : e,
      );
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_page (board_id, position, layout, background, document)
        VALUES (${id}::uuid, ${p.position}, ${p.layout}, ${p.background}, ${JSON.stringify({ ...p.document, elements })}::jsonb)`;
    }
    const pairs: Array<{ from: string; to: string }> = [];
    for (const a of images) {
      const to = renamed.get(a.id) as string;
      const key = keptKey(organizationId, id, to);
      await tx.$executeRaw`
        INSERT INTO chat.whiteboard_asset (id, board_id, kind, object_key, content_type, byte_size, sha256, width, height, state)
        VALUES (${to}::uuid, ${id}::uuid, ${a.kind}, ${key}, ${a.content_type}, ${a.byte_size}, ${a.sha256}, ${a.width}, ${a.height}, 'ready')`;
      pairs.push({ from: a.object_key, to: key });
    }
    await this.assertAssetQuota(tx, teacherId, 0);
    await this.assets.copyAll(pairs);
    return id;
  }

  /**
   * The board's ready images, signed: only ever for a board the caller has
   * just been authorized for (open, review, a write of their own), by the
   * board's own id (§6.3).
   */
  private async signedImages(tx: Tx | PrismaService, board: BoardRow): Promise<AssetView[]> {
    const rows = await tx.$queryRaw<AssetRow[]>`
      SELECT id::text AS id, kind, object_key, content_type, byte_size, width, height
        FROM chat.whiteboard_asset
       WHERE board_id = ${board.id}::uuid AND state = 'ready' AND kind IN ('image', 'pdf_page')
       ORDER BY created_at`;
    return this.assets.sign(board, rows);
  }

  /** §6.4: a teacher's images (all their boards, trash included), plus `adding`, within 300 MB. */
  private async assertAssetQuota(tx: Tx, teacherId: string, adding: number): Promise<void> {
    const [{ used }] = await tx.$queryRaw<Array<{ used: bigint }>>`
      SELECT COALESCE(sum(a.byte_size), 0)::bigint AS used
        FROM chat.whiteboard_asset a JOIN chat.whiteboard w ON w.id = a.board_id
       WHERE w.teacher_id = ${teacherId}::uuid AND a.kind IN ('image', 'pdf_page')`;
    if (Number(used) + adding > ASSET_BYTES_PER_TEACHER) {
      throw limit('storage', `storage: a teacher's boards hold at most ${ASSET_BYTES_PER_TEACHER / (1024 * 1024)} MB of images; delete boards you no longer need`);
    }
  }

  /** PR-4 is off until the environment's bucket and its versioning exist (§11.3). */
  private async assetsOn(): Promise<void> {
    if (!(await this.config.get('whiteboards.assets_enabled'))) {
      throw new CommError(CommErrorCode.WHITEBOARD_ASSETS_OFF, 'images and export are not switched on here yet', 503);
    }
  }

  private byteSize(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > BOARD_IMAGE_MAX_BYTES) {
      throw invalid(`${field}: 1-${BOARD_IMAGE_MAX_BYTES} bytes`);
    }
    return value;
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
    const assets = await this.signedImages(tx, board);
    return {
      assets,
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
  private async record(tx: Tx, board: BoardRow, viewer: Viewer, action: Action, detail?: Record<string, string>): Promise<void> {
    const extra = viewer.detail || detail ? { ...viewer.detail, ...detail } : null;
    await tx.$executeRaw`
      INSERT INTO chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action, detail)
      VALUES (${board.organization_id}::uuid, ${board.id}::uuid, ${board.teacher_id}::uuid, ${viewer.id}::uuid,
              ${viewer.kind}, ${viewer.basis}, ${action}, ${extra ? JSON.stringify(extra) : null}::jsonb)`;
  }

  /**
   * A support session's viewer is its OPERATOR, the staff member behind it
   * (review of #279, P2-4): the access history shows who really looked.
   */
  private async operatorOf(tx: Tx, supportSessionId: string): Promise<Viewer> {
    const [row] = await tx.$queryRaw<Array<{ staff_id: string }>>`
      SELECT staff_id::text AS staff_id FROM chat.impersonation_session WHERE id = ${supportSessionId}::uuid`;
    if (!row) throw new CommError(CommErrorCode.WHITEBOARD_DENIED, 'no such support session');
    return { id: row.staff_id, kind: 'support_session', basis: 'support_session', detail: { supportSessionId } };
  }

  /** A read: its log row first, then nothing more may be written (§10 1d). */
  private async read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw refusal(e);
    }
  }

  /** After the access-log row: the rest of this transaction can only read. */
  private async readOnly(tx: Tx): Promise<void> {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  }

  private async academyZone(): Promise<string> {
    const [row] = await this.prisma.$queryRaw<Array<{ value: unknown }>>`SELECT value FROM chat.config WHERE key = 'schedule.timezone'`;
    return canonicalZone(row?.value) ?? ACADEMY_ZONE;
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

/** "Al-Fatihah review.pdf": the title, safe in a Content-Disposition header. */
export function exportFileName(title: string): string {
  const safe = title.replace(/[^\p{L}\p{N} ._-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe || 'board'}.pdf`;
}
