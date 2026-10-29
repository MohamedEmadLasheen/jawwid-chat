/**
 * PD-39 PR-1 -- the teacher whiteboard's server half, against the owner's
 * safeguards (docs/product/pd039-whiteboard-design.md §10, decided 2026-10-28):
 *
 *   1a  only the teacher edits: every other reader, another teacher and a
 *       support session are refused, and the board is UNCHANGED afterwards
 *   1b  read-only viewers are exactly the assigned supervisor, the Teachers
 *       Manager and the super admin (chat.staff_supervised_teacher_ids), with
 *       the PD-35 switch off as well as on; anyone else gets 404
 *   1c  every open writes one access-log row, in the same transaction; the log
 *       is never changed
 *   4a  a teacher leaving retains their boards for the Teachers department; a
 *       retained board is copied to another teacher; a return brings them back
 *   4c  the retention notice, once, 30 days before
 *   4d  trash for 30 days, then the purge; the log outlives the board
 *   5c  a restore brings back the same pages, byte for byte
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { runWithRequestContext } from '@platform/request-context';
import type { Actor } from '@platform/types';
import { WhiteboardService } from '../../src/whiteboards/whiteboard.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const boards = new WhiteboardService(g.prisma, g.storage);
const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);

let s: Scenario;
let org: string;
let sa: string;
let tmgr: string;
let tsup: string;
let tsup2: string;

const teacher = (id: string, isActive = true): Actor =>
  ({ actorId: id, kind: 'teacher', displayName: 'teacher', locale: 'en', isActive, organizationId: org }) as Actor;
const staff = (id: string, staffRole: string): Actor =>
  ({ actorId: id, kind: 'staff', staffRole, displayName: 'staff', locale: 'en', isActive: true, organizationId: org }) as Actor;
const asSupport = <T>(fn: () => Promise<T>) => runWithRequestContext({ impersonationId: randomUUID() } as never, fn);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal');
}

/** Everything a write could change, so "refused" can be proved as "unchanged". */
const snapshot = async (id: string) =>
  (await g.prisma.$queryRaw<Array<{ revision: number; state: string; title: string; pages: string | null; assets: number }>>`
    SELECT w.revision, w.state, w.title,
           (SELECT string_agg(p.position || ':' || md5(p.document::text) || ':' || p.layout, ',' ORDER BY p.position)
              FROM chat.whiteboard_page p WHERE p.board_id = w.id) AS pages,
           (SELECT count(*)::int FROM chat.whiteboard_asset a WHERE a.board_id = w.id) AS assets
      FROM chat.whiteboard w WHERE w.id = ${id}::uuid`)[0];
const log = (boardId: string) =>
  g.prisma.$queryRaw<Array<{ viewer_id: string | null; viewer_kind: string; basis: string; action: string }>>`
    SELECT viewer_id::text AS viewer_id, viewer_kind, basis, action FROM chat.whiteboard_access_log
     WHERE board_id = ${boardId}::uuid ORDER BY id`;
const drawing = (n: number) => ({
  v: 1,
  elements: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, kind: 'stroke', points: `p${i}`, style: { color: '#123456', width: 3 } })),
});

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  [{ id: org }] = await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT chat.default_organization_id()::text AS id`;
  [sa, tmgr, tsup, tsup2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_w', 'super_admin', true)`, sa),
  ]);
  await exec(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_w', 'manager', true),
       ($2::uuid, 'tsup_w', 'admin', true), ($3::uuid, 'tsup2_w', 'admin', true)`,
    tmgr, tsup, tsup2,
  );
  const [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  for (const id of [tsup, tsup2]) {
    await exec(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, id, tdept,
    );
  }
  // tsup supervises s.teacherId; tsup2 is in the department but supervises nobody here.
  await exec(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.teacherId, tsup, tmgr,
  );
});

describe('the owning teacher', () => {
  it('creates, saves with a revision, adds, duplicates, reorders and deletes pages', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: '  Al-Fatihah  ' }, t);
    expect(b).toMatchObject({ title: 'Al-Fatihah', state: 'active', revision: 1, pageCount: 1, canEdit: true });
    const page = b.pages[0]!.id;

    const saved = await boards.savePage(b.id, page, { revision: 1, document: drawing(3), layout: 'arabic_lines' }, t);
    expect(saved.revision).toBe(2);

    let d = await boards.addPage(b.id, { revision: 2, layout: 'grid' }, t);
    d = await boards.duplicatePage(b.id, page, { revision: d.revision }, t);
    expect(d.pages.map((p) => p.layout)).toEqual(['arabic_lines', 'arabic_lines', 'grid']);
    const order = [d.pages[2]!.id, d.pages[0]!.id, d.pages[1]!.id];
    d = await boards.reorderPages(b.id, { revision: d.revision, pageIds: order }, t);
    expect(d.pages.map((p) => p.id)).toEqual(order);
    d = await boards.deletePage(b.id, order[0]!, { revision: d.revision }, t);
    expect(d.pages.map((p) => p.position)).toEqual([0, 1]);
    expect(await code(boards.reorderPages(b.id, { revision: d.revision, pageIds: [order[1]] }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);
  });

  it('a write against an old revision is a conflict and changes nothing', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, t);
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: drawing(2) }, t);
    const before = await snapshot(b.id);
    expect(await code(boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: drawing(9) }, t))).toBe(CommErrorCode.WHITEBOARD_CONFLICT);
    expect(await snapshot(b.id)).toEqual(before);
  });

  it('a verse with its text, or an image of another board, is refused', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, t);
    const other = await boards.create({ title: 'Other' }, t);
    const verse = { id: 'v', kind: 'verse', surah: 1, fromAyah: 1, toAyah: 2, datasetId: 'tanzil-uthmani-1.1', rangeSha256: 'a'.repeat(64) };
    expect(await code(boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: { v: 1, elements: [{ ...verse, text: 'x' }] } }, t)))
      .toBe(CommErrorCode.WHITEBOARD_INVALID);
    const asset = randomUUID();
    await exec(
      `insert into chat.whiteboard_asset (id, board_id, kind, object_key, content_type, byte_size, state)
       values ($1::uuid, $2::uuid, 'image', $3, 'image/png', 10, 'ready')`,
      asset, other.id, `whiteboards/${org}/${other.id}/${asset}`,
    );
    expect(await code(boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: { v: 1, elements: [{ id: 'i', kind: 'image', assetId: asset }] } }, t)))
      .toBe(CommErrorCode.WHITEBOARD_DENIED);
    expect((await snapshot(b.id))!.revision).toBe(1);
  });

  it('stops at 50 pages', async () => {
    const t = teacher(s.teacherId);
    let d = await boards.create({ title: 'Board' }, t);
    for (let i = 1; i < 50; i += 1) d = await boards.addPage(d.id, { revision: d.revision }, t);
    expect(d.pageCount).toBe(50);
    expect(await code(boards.addPage(d.id, { revision: d.revision }, t))).toBe(CommErrorCode.WHITEBOARD_LIMIT);
  });
});

describe('§10 1a: nobody but the teacher edits', () => {
  it('another teacher, every staff role and a support session are refused, and the board is unchanged', async () => {
    const owner = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, owner);
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: drawing(2) }, owner);
    const before = await snapshot(b.id);
    const page = b.pages[0]!.id;
    const writes = (a: Actor) => [
      boards.savePage(b.id, page, { revision: 2, document: drawing(5) }, a),
      boards.rename(b.id, { revision: 2, title: 'x' }, a),
      boards.addPage(b.id, { revision: 2 }, a),
      boards.duplicatePage(b.id, page, { revision: 2 }, a),
      boards.deletePage(b.id, page, { revision: 2 }, a),
      boards.reorderPages(b.id, { revision: 2, pageIds: [page] }, a),
      boards.moveToTrash(b.id, { revision: 2 }, a),
      boards.duplicate(b.id, a),
    ];
    for (const a of [teacher(s.unrelatedTeacherId), staff(sa, 'super_admin'), staff(tmgr, 'manager'), staff(tsup, 'admin')]) {
      for (const w of writes(a)) expect([CommErrorCode.WHITEBOARD_NOT_FOUND, CommErrorCode.WHITEBOARD_DENIED]).toContain(await code(w));
    }
    for (const w of await asSupport(async () => writes(owner).map((p) => code(p)))) expect(await w).toBe(CommErrorCode.WHITEBOARD_DENIED);
    expect(await snapshot(b.id)).toEqual(before);
    // A support session may look: logged as one.
    const seen = await asSupport(() => boards.open(b.id, owner));
    expect(seen.canEdit).toBe(false);
    expect((await log(b.id)).at(-1)).toMatchObject({ viewer_kind: 'support_session', basis: 'support_session', action: 'open' });
  });
});

describe('§10 1b, 1c: read-only viewers, every access logged', () => {
  it('the assigned supervisor, the Teachers Manager and the super admin read; the rest get 404', async () => {
    const b = await boards.create({ title: 'Board' }, teacher(s.teacherId));
    const [was] = await g.prisma.$queryRaw<Array<{ value: unknown }>>`SELECT value FROM chat.config WHERE key = 'teacher_supervisor.strict_scope'`;
    try {
    for (const strict of ['true', 'false']) {
      await exec(`insert into chat.config (key, value) values ('teacher_supervisor.strict_scope', to_jsonb($1::boolean))
                  on conflict (key) do update set value = excluded.value`, strict);
      for (const [id, role, basis] of [[tsup, 'admin', 'supervisor'], [tmgr, 'manager', 'teachers_manager'], [sa, 'super_admin', 'super_admin']] as const) {
        const seen = await boards.review(b.id, staff(id, role));
        expect(seen.canEdit).toBe(false);
        expect((await log(b.id)).at(-1)).toMatchObject({ viewer_id: id, viewer_kind: 'staff', basis, action: 'open' });
        expect((await boards.teacherBoards(s.teacherId, staff(id, role))).map((x) => x.id)).toEqual([b.id]);
      }
      // A Teachers supervisor of other teachers, and an Operations supervisor.
      for (const a of [staff(tsup2, 'admin'), staff(s.ownerId, 'admin')]) {
        expect(await code(boards.review(b.id, a))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
        expect(await code(boards.teacherBoards(s.teacherId, a))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
      }
    }
    } finally {
      await exec(`update chat.config set value = $1::jsonb where key = 'teacher_supervisor.strict_scope'`, JSON.stringify(was?.value ?? false));
    }
    // Another teacher is not staff, and not the owner.
    expect(await code(boards.open(b.id, teacher(s.unrelatedTeacherId)))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
  });

  it('one row per open, and the log is never changed', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, t);
    await boards.open(b.id, t);
    await boards.review(b.id, staff(tsup, 'admin'));
    expect((await log(b.id)).map((r) => [r.viewer_kind, r.action])).toEqual([['teacher', 'open'], ['staff', 'open']]);
    await expect(exec(`update chat.whiteboard_access_log set action = 'open' where board_id = $1::uuid`, b.id)).rejects.toThrow(/never changed/);
    await expect(exec(`delete from chat.whiteboard_access_log where board_id = $1::uuid`, b.id)).rejects.toThrow(/never changed/);
  });
});

describe('§10 4d, 5c: trash, restore and the purge', () => {
  it('restores the same board byte for byte; past 30 days it is purged and the log stays', async () => {
    const t = teacher(s.teacherId);
    let d = await boards.create({ title: 'Lesson 1' }, t);
    await boards.savePage(d.id, d.pages[0]!.id, { revision: 1, document: drawing(4) }, t);
    d = await boards.addPage(d.id, { revision: 2, layout: 'ruled' }, t);
    const before = await snapshot(d.id);

    const trashed = await boards.moveToTrash(d.id, { revision: d.revision }, t);
    expect(trashed.state).toBe('trashed');
    expect(new Date(trashed.purgeAfter!).getTime() - new Date(trashed.trashedAt!).getTime()).toBe(30 * 24 * 3600_000);
    expect(await boards.list(t)).toEqual([]);
    expect((await boards.trash(t)).map((x) => x.id)).toEqual([d.id]);
    expect(await code(boards.review(d.id, staff(tmgr, 'manager')))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);

    const back = await boards.restore(d.id, t);
    const after = await snapshot(d.id);
    expect({ ...after, revision: 0, state: '' }).toEqual({ ...before, revision: 0, state: '' });
    expect(back).toMatchObject({ state: 'active', title: 'Lesson 1', pageCount: 2 });

    await boards.moveToTrash(d.id, { revision: back.revision }, t);
    await exec(`update chat.whiteboard set trashed_at = now() - interval '31 days', purge_after = now() - interval '1 day' where id = $1::uuid`, d.id);
    expect(await code(boards.restore(d.id, t))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
    expect(await boards.purgeDue()).toEqual({ purged: 1, failed: 0 });
    expect(await snapshot(d.id)).toBeUndefined();
    expect((await log(d.id)).map((r) => r.action)).toEqual(['trash', 'restore', 'trash', 'purge']);
  });
});

describe('§10 4a, 4c: a teacher who leaves', () => {
  it('retains the boards for the department, lets the manager copy one, and brings them back on return', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Kept' }, t);
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: drawing(2) }, t);
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, s.teacherId);

    const [kept] = await boards.teacherBoards(s.teacherId, staff(tmgr, 'manager'));
    expect(kept).toMatchObject({ id: b.id, state: 'retained' });
    expect(new Date(kept!.retainedUntil!).getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 3600_000);
    expect(await code(boards.savePage(b.id, b.pages[0]!.id, { revision: 2, document: drawing(1) }, teacher(s.teacherId, false))))
      .toBe(CommErrorCode.WHITEBOARD_DENIED);

    const copy = await boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, staff(tmgr, 'manager'));
    expect(copy).toMatchObject({ state: 'active', title: 'Kept', pageCount: 1 });
    const mine = await boards.open(copy.id, teacher(s.newTeacherId));
    expect(mine.canEdit).toBe(true);
    expect((await log(b.id)).map((r) => r.action)).toEqual(['retain', 'copy']);
    expect(await code(boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, staff(tsup2, 'admin')))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);

    // 30 days before the end: one notice to the Teachers Manager and the super admin, once.
    await exec(`update chat.whiteboard set retained_until = now() + interval '20 days' where id = $1::uuid`, b.id);
    expect(await boards.retentionNotices()).toBe(1);
    expect(await boards.retentionNotices()).toBe(0);
    const told = await g.prisma.notification.findMany({ where: { templateKey: 'whiteboard_retention_expiring' } });
    expect(told.map((n) => n.recipientId).sort()).toEqual([sa, tmgr].sort());

    await exec(`update chat.teacher set is_active = true, left_at = null where id = $1::uuid`, s.teacherId);
    expect(await boards.list(t)).toEqual([expect.objectContaining({ id: b.id, state: 'active', retainedUntil: null })]);
  });
});
