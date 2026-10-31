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
import { LocalFsBlobStore } from '../../src/communication/attachments/blob-store';
import { CommError, CommErrorCode } from '@platform/errors';
import { runWithRequestContext } from '@platform/request-context';
import type { Actor } from '@platform/types';
import { WhiteboardAssetService } from '../../src/whiteboards/whiteboard-asset.service';
import { WhiteboardService } from '../../src/whiteboards/whiteboard.service';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { join } from 'node:path';
import { EXPORT_QUEUE, EXPORT_WORKERS, composeInWorker } from '../../src/whiteboards/whiteboard-export-runner';
import { corruptPng, png } from './pd039-png';

jest.setTimeout(120_000);

const g = buildGraph();
const boards = new WhiteboardService(g.prisma, g.storage, g.notifications, new WhiteboardAssetService(g.storage), g.config);
const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);

let s: Scenario;
let org: string;
let sa: string;
let tmgr: string;
let tsup: string;
let tsup2: string;
let tbak: string;

const teacher = (id: string, isActive = true): Actor =>
  ({ actorId: id, kind: 'teacher', displayName: 'teacher', locale: 'en', isActive, organizationId: org }) as Actor;
const staff = (id: string, staffRole: string): Actor =>
  ({ actorId: id, kind: 'staff', staffRole, displayName: 'staff', locale: 'en', isActive: true, organizationId: org }) as Actor;
const asSupport = <T>(impersonationId: string, fn: () => Promise<T>) => runWithRequestContext({ impersonationId } as never, fn);

/** A real PD-21 support session: the Teachers Manager acting as s.teacherId's account. */
async function supportSession(): Promise<string> {
  const staffAccount = await g.prisma.account.create({
    data: { organizationId: org, subject: `support-${randomUUID()}@pd39.qa.jawwid.test`, kind: 'staff', status: 'active', isActive: true },
  });
  const teacherAccount = await g.prisma.account.create({
    data: { organizationId: org, subject: `teacher-${randomUUID()}@pd39.qa.jawwid.test`, kind: 'teacher', status: 'active', isActive: true },
  });
  await exec(`update chat.staff set account_id = $1::uuid where id = $2::uuid`, staffAccount.id, tmgr);
  await exec(`update chat.teacher set account_id = $1::uuid where id = $2::uuid`, teacherAccount.id, s.teacherId);
  const session = await g.prisma.session.create({
    data: { organizationId: org, accountId: staffAccount.id, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  });
  const imp = await g.prisma.impersonationSession.create({
    data: {
      organizationId: org, staffId: tmgr, staffAccountId: staffAccount.id, staffSessionId: session.id,
      targetAccountId: teacherAccount.id, targetKind: 'teacher', reason: 'spec', expiresAt: new Date(Date.now() + 10 * 60_000),
    } as never,
  });
  return imp.id;
}

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
  [sa, tmgr, tsup, tsup2, tbak] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_w', 'super_admin', true)`, sa),
  ]);
  await exec(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_w', 'manager', true),
       ($2::uuid, 'tsup_w', 'admin', true), ($3::uuid, 'tsup2_w', 'admin', true), ($4::uuid, 'tbak_w', 'admin', true)`,
    tmgr, tsup, tsup2, tbak,
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
  // A Teachers-department backup: PD-8 activates backup links in Operations only,
  // so this backup has no active link and reaches no teacher (see §10 1b below).
  await exec(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'backup_supervisor')`, tbak, tdept,
  );
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
    // Thunks, run one at a time: a refusal is awaited the moment it happens.
    const writes = (a: Actor) => [
      () => boards.savePage(b.id, page, { revision: 2, document: drawing(5) }, a),
      () => boards.rename(b.id, { revision: 2, title: 'x' }, a),
      () => boards.addPage(b.id, { revision: 2 }, a),
      () => boards.duplicatePage(b.id, page, { revision: 2 }, a),
      () => boards.deletePage(b.id, page, { revision: 2 }, a),
      () => boards.reorderPages(b.id, { revision: 2, pageIds: [page] }, a),
      () => boards.moveToTrash(b.id, { revision: 2 }, a),
      () => boards.duplicate(b.id, a),
    ];
    for (const a of [teacher(s.unrelatedTeacherId), staff(sa, 'super_admin'), staff(tmgr, 'manager'), staff(tsup, 'admin')]) {
      for (const w of writes(a)) expect([CommErrorCode.WHITEBOARD_NOT_FOUND, CommErrorCode.WHITEBOARD_DENIED]).toContain(await code(w()));
    }
    const support = await supportSession();
    const asOwnerInSupport = await asSupport(support, async () => {
      const out: string[] = [];
      for (const w of writes(owner)) out.push(await code(w()));
      return out;
    });
    expect(asOwnerInSupport).toEqual(Array(8).fill(CommErrorCode.WHITEBOARD_DENIED));
    expect(await snapshot(b.id)).toEqual(before);
    // A support session may look: logged as its OPERATOR, the staff member behind it.
    const seen = await asSupport(support, () => boards.open(b.id, owner));
    expect(seen.canEdit).toBe(false);
    expect((await log(b.id)).at(-1)).toMatchObject({ viewer_id: tmgr, viewer_kind: 'support_session', basis: 'support_session', action: 'open' });
    const history = await boards.accessLog(b.id, staff(sa, 'super_admin'));
    expect(history.find((h) => h.viewerKind === 'support_session')).toMatchObject({ viewerId: tmgr, viewerName: 'tmgr_w', detail: { supportSessionId: support } });
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
      // A Teachers supervisor of other teachers, a Teachers backup with no
      // active link, and an Operations supervisor.
      for (const a of [staff(tsup2, 'admin'), staff(tbak, 'admin'), staff(s.ownerId, 'admin')]) {
        expect(await code(boards.review(b.id, a))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
        expect(await code(boards.teacherBoards(s.teacherId, a))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
      }
    }
    } finally {
      await exec(`update chat.config set value = $1::jsonb where key = 'teacher_supervisor.strict_scope'`, JSON.stringify(was?.value ?? false));
    }
    // Another teacher is not staff, and not the owner.
    expect(await code(boards.open(b.id, teacher(s.unrelatedTeacherId)))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);

    // Another organization's super admin: not found, however the id was learnt.
    const other = randomUUID();
    const otherSa = randomUUID();
    await exec(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'PD-39 other')`, other, `pd39-${other.slice(0, 8)}`);
    await g.prisma.$transaction([
      exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
      exec(`insert into chat.staff (id, organization_id, name, role, is_active) values ($1::uuid, $2::uuid, 'sa_other', 'super_admin', true)`, otherSa, other),
    ]);
    const outsider = { ...staff(otherSa, 'super_admin'), organizationId: other } as Actor;
    expect(await code(boards.review(b.id, outsider))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
    expect(await code(boards.teacherBoards(s.teacherId, outsider))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
    expect(await code(boards.accessLog(b.id, outsider))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
  });

  it('one row per open, and the log is never changed', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, t);
    await boards.open(b.id, t);
    await boards.review(b.id, staff(tsup, 'admin'));
    await boards.teacherBoards(s.teacherId, staff(tsup, 'admin'));
    await boards.accessLog(b.id, staff(tmgr, 'manager'));
    expect((await log(b.id)).map((r) => [r.viewer_kind, r.action])).toEqual([
      ['teacher', 'open'], ['staff', 'open'], ['staff', 'list'], ['staff', 'read_log'],
    ]);
    await expect(exec(`update chat.whiteboard_access_log set action = 'open' where board_id = $1::uuid`, b.id)).rejects.toThrow(/never changed/);
    await expect(exec(`delete from chat.whiteboard_access_log where board_id = $1::uuid`, b.id)).rejects.toThrow(/never changed/);
  });

  it('a read whose log row cannot be written is not served', async () => {
    const b = await boards.create({ title: 'Board' }, teacher(s.teacherId));
    await exec(`alter table chat.whiteboard_access_log add constraint pd039_spec_refuses_opens check (action <> 'open') not valid`);
    try {
      await expect(boards.review(b.id, staff(tsup, 'admin'))).rejects.toThrow();
      await expect(boards.open(b.id, teacher(s.teacherId))).rejects.toThrow();
    } finally {
      await exec(`alter table chat.whiteboard_access_log drop constraint pd039_spec_refuses_opens`);
    }
    expect(await log(b.id)).toEqual([]);
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
    // The history outlives the board, for those who reach its teacher.
    // (Reading it is logged too, and shows.)
    expect((await boards.accessLog(d.id, staff(tmgr, 'manager'))).map((h) => h.action)).toEqual(['trash', 'restore', 'trash', 'purge', 'read_log']);
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
    expect((await log(b.id)).map((r) => r.action)).toEqual(['retain', 'list', 'copy']);
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

  it('a copy retried with the same key is the same copy: two clicks, or a lost answer, never make two', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Once' }, t);
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, s.teacherId);
    const mgr = staff(tmgr, 'manager');
    const [first, second] = await Promise.all([
      boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'key-1'),
      boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'key-1'),
    ]);
    expect(second.id).toBe(first.id);
    const third = await boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'key-1');
    expect(third.id).toBe(first.id);
    expect((await boards.list(teacher(s.newTeacherId))).filter((x) => x.title === 'Once')).toHaveLength(1);
    expect((await log(b.id)).filter((r) => r.action === 'copy')).toHaveLength(1);
    // A new key is a new copy, as asked.
    const another = await boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'key-2');
    expect(another.id).not.toBe(first.id);
  });

  it('a key names one copy: reused for another teacher it is refused, and it is never another staff member\'s (review of #327)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Keyed' }, t);
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, s.teacherId);
    const mgr = staff(tmgr, 'manager');
    const first = await boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'key-x');
    // The same key for a different teacher: 409, and no copy for them.
    expect(await code(boards.copyToTeacher(b.id, { teacherId: s.unrelatedTeacherId }, mgr, 'key-x'))).toBe(CommErrorCode.WHITEBOARD_CONFLICT);
    expect((await boards.list(teacher(s.unrelatedTeacherId))).filter((x) => x.title === 'Keyed')).toHaveLength(0);
    // The same key from another staff member is their own request: a copy of their own, never the first one's answer.
    const theirs = await boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, staff(sa, 'super_admin'), 'key-x');
    expect(theirs.id).not.toBe(first.id);
    expect((await log(b.id)).filter((r) => r.action === 'copy').map((r) => r.viewer_id).sort()).toEqual([sa, tmgr].sort());
  });
});

describe('the staff pickers (review of #327)', () => {
  it("lists exactly the teachers a staff member may read, departed ones too; copy targets only for who copies", async () => {
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, s.teacherId);
    const sup = await boards.boardTeachers(staff(tsup, 'admin'));
    expect(sup.teachers).toEqual([{ id: s.teacherId, name: expect.any(String), isActive: false }]);
    expect(sup.copyTargets).toBeNull();
    // In the department but supervising nobody here: nothing.
    expect((await boards.boardTeachers(staff(tsup2, 'admin'))).teachers).toEqual([]);
    for (const who of [staff(tmgr, 'manager'), staff(sa, 'super_admin')]) {
      const seen = await boards.boardTeachers(who);
      expect(seen.teachers.map((t) => t.id)).toContain(s.teacherId);
      const targets = seen.copyTargets!.map((t) => t.id);
      expect(targets).toContain(s.newTeacherId);
      expect(targets).not.toContain(s.teacherId);
    }
    // Every teacher listed is one whose boards that staff member can open.
    for (const t of (await boards.boardTeachers(staff(tmgr, 'manager'))).teachers) {
      await expect(boards.teacherBoards(t.id, staff(tmgr, 'manager'))).resolves.toEqual(expect.any(Array));
    }
    expect(await code(boards.boardTeachers(teacher(s.teacherId)))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
  });
});

describe('limits and concurrency', () => {
  it('two saves at the same revision: one wins, the other is a conflict', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, t);
    const results = await Promise.allSettled([
      boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: drawing(2) }, t),
      boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: drawing(3) }, t),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as CommError).code).toBe(CommErrorCode.WHITEBOARD_CONFLICT);
    expect((await snapshot(b.id))!.revision).toBe(2);
  });

  it('the page size is the database\'s measure: a page over 512 KB as stored is a clean 413, nothing written', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Board' }, t);
    // Compact JSON under 512 KB that the stored text form (spaced separators) takes over it.
    const fields = Object.fromEntries('abcdefghijklmnop'.split('').map((k, i) => [k, i % 10]));
    const elements = Array.from({ length: 4000 }, (_, i) => ({ id: `e${i}`, kind: 'line', ...fields }));
    expect(Buffer.byteLength(JSON.stringify({ v: 1, elements }))).toBeLessThan(512 * 1024);
    const [{ stored }] = await g.prisma.$queryRaw<Array<{ stored: number }>>`SELECT octet_length(${JSON.stringify({ v: 1, elements })}::jsonb::text) AS stored`;
    expect(stored).toBeGreaterThan(512 * 1024);
    const refused = await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: { v: 1, elements } }, t).catch((e: CommError) => e);
    expect(refused).toBeInstanceOf(CommError);
    expect((refused as CommError).code).toBe(CommErrorCode.WHITEBOARD_LIMIT);
    expect((refused as CommError).status).toBe(413);
    expect((refused as CommError).message).not.toMatch(/whiteboard_page|constraint|violates/);
    expect((await snapshot(b.id))!.revision).toBe(1);
  });

  it('a teacher\'s drawings stop at 25 MB, counted after the write', async () => {
    const t = teacher(s.teacherId);
    const full = await boards.create({ title: 'Full' }, t);
    // About 25 MB of pages, written directly: 51 pages of ~500 KB.
    await exec(
      `insert into chat.whiteboard_page (board_id, position, document)
       select $1::uuid, g, jsonb_build_object('v', 1, 'elements', jsonb_build_array(jsonb_build_object('id', 't', 'kind', 'text', 'text', repeat('x', 500000))))
         from generate_series(1, 49) g`,
      full.id,
    );
    const b = await boards.create({ title: 'Next' }, t);
    const big = { v: 1, elements: [{ id: 't', kind: 'text', text: 'x'.repeat(1999) }] };
    const ok = await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: big }, t);
    expect(ok.revision).toBe(2);
    await exec(
      `update chat.whiteboard_page set document = jsonb_build_object('v', 1, 'elements', jsonb_build_array(jsonb_build_object('id', 't', 'kind', 'text', 'text', repeat('x', 520000))))
        where board_id = $1::uuid and position = 0`,
      full.id,
    );
    expect(await code(boards.duplicate(full.id, t))).toBe(CommErrorCode.WHITEBOARD_LIMIT);
    expect((await boards.list(t)).map((x) => x.title).sort()).toEqual(['Full', 'Next']);
  });
});

// ---------------------------------------------------------------------------
// PR-4: images and export (§4.4, §4.6, §6.3)
// ---------------------------------------------------------------------------

const blobs = new LocalFsBlobStore();

async function assetsSwitch(on: boolean, lifecycle = on) {
  for (const [key, value] of [['whiteboards.assets_enabled', on], ['whiteboards.assets_lifecycle_verified', lifecycle]] as const) {
    await exec(
      `insert into chat.config (key, value, scope) values ($1, $2::jsonb, 'whiteboards')
       on conflict (key) do update set value = excluded.value`,
      key, JSON.stringify(value),
    );
  }
  g.config.invalidate();
}

/** An image granted, uploaded and confirmed on `boardId`. */
async function addImage(boardId: string, t: Actor, bytes = png(40, 30)) {
  const { assetId, upload } = await boards.grantImage(boardId, { contentType: 'image/png', byteSize: bytes.length }, t);
  await blobs.put(upload.objectKey, 'image/png', bytes);
  const { asset } = await boards.confirmImage(boardId, assetId, { objectKey: upload.objectKey }, t);
  return { asset, upload };
}

const imageOn = (assetId: string) => ({ v: 1, elements: [{ id: 'i1', kind: 'image', assetId, x: 10, y: 10, w: 400, h: 300 }] });

describe('PR-4: images and export', () => {
  beforeEach(() => assetsSwitch(true));
  afterAll(() => assetsSwitch(false));

  it('is off until the environment switches it on AND records the lifecycle rule: nothing granted, nothing written', async () => {
    await assetsSwitch(true, false);
    const early = await boards.create({ title: 'Early' }, teacher(s.teacherId));
    expect(await code(boards.grantImage(early.id, { contentType: 'image/png', byteSize: 100 }, teacher(s.teacherId)))).toBe(CommErrorCode.WHITEBOARD_ASSETS_OFF);
    await assetsSwitch(false);
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Off' }, t);
    expect(await code(boards.grantImage(b.id, { contentType: 'image/png', byteSize: 100 }, t))).toBe(CommErrorCode.WHITEBOARD_ASSETS_OFF);
    expect(await code(boards.grantExport(b.id, { pages: [{ byteSize: 100 }] }, t))).toBe(CommErrorCode.WHITEBOARD_ASSETS_OFF);
    // Reading the images is off too, and logs nothing (review of #325).
    const before = (await log(b.id)).length;
    expect(await code(boards.imageUrls(b.id, t))).toBe(CommErrorCode.WHITEBOARD_ASSETS_OFF);
    expect((await log(b.id)).length).toBe(before);
    expect((await snapshot(b.id))!.assets).toBe(0);
  });

  it('an image is granted for a key the server chose, and kept only once its real bytes pass', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Images' }, t);
    const bytes = png(40, 30);
    const { assetId, upload } = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: bytes.length }, t);
    expect(upload.objectKey.split('/')).toEqual(['whiteboard-uploads', org, b.id, assetId, expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    await blobs.put(upload.objectKey, 'image/png', bytes);
    // Not ready yet: no page may name it.
    expect(await code(boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: imageOn(assetId) }, t))).toBe(CommErrorCode.WHITEBOARD_DENIED);
    // A key that is not this image's upload is refused, whatever it holds.
    const other = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: bytes.length }, t);
    await blobs.put(other.upload.objectKey, 'image/png', bytes);
    expect(await code(boards.confirmImage(b.id, assetId, { objectKey: other.upload.objectKey }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);
    expect(await code(boards.confirmImage(b.id, assetId, { objectKey: `whiteboards/${org}/${b.id}/${assetId}` }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);

    const { asset } = await boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t);
    expect(asset).toMatchObject({ id: assetId, width: 40, height: 30, contentType: 'image/png', byteSize: bytes.length });
    const [row] = await g.prisma.$queryRaw<Array<{ object_key: string; state: string; sha256: string }>>`
      SELECT object_key, state, sha256 FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid`;
    expect(row).toMatchObject({ object_key: `whiteboards/${org}/${b.id}/${assetId}`, state: 'ready' });
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The upload is gone; the kept bytes are the ones inspected.
    expect(await blobs.get(upload.objectKey)).toBeNull();
    expect((await blobs.get(row!.object_key))?.bytes.equals(bytes)).toBe(true);
    // A replay answers the ready image again.
    expect(await boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t)).toMatchObject({ replayed: true, asset: { id: assetId } });

    const saved = await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: imageOn(assetId) }, t);
    expect(saved.revision).toBe(2);
    const opened = await boards.open(b.id, t);
    expect(opened.assets.map((a) => a.id)).toEqual([assetId]);
    expect(opened.assets[0]!.url).toEqual(expect.any(String));
  });

  it('refuses a type that lies, and a foreign board\'s image, leaving nothing ready', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Lies' }, t);
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const lie = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: html.length }, t);
    await blobs.put(lie.upload.objectKey, 'image/png', html);
    expect(await code(boards.confirmImage(b.id, lie.assetId, { objectKey: lie.upload.objectKey }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);
    expect(await code(boards.grantImage(b.id, { contentType: 'image/svg+xml', byteSize: 10 }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);

    const theirs = await boards.create({ title: 'Theirs' }, teacher(s.newTeacherId));
    const foreign = await addImage(theirs.id, teacher(s.newTeacherId));
    expect(await code(boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: imageOn(foreign.asset.id) }, t))).toBe(CommErrorCode.WHITEBOARD_DENIED);
    // Another teacher can neither confirm nor sign this board's images.
    expect(await code(boards.confirmImage(b.id, lie.assetId, { objectKey: lie.upload.objectKey }, teacher(s.newTeacherId)))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
    expect(await code(boards.imageUrls(b.id, teacher(s.newTeacherId)))).toBe(CommErrorCode.WHITEBOARD_NOT_FOUND);
    const [{ ready }] = await g.prisma.$queryRaw<Array<{ ready: number }>>`
      SELECT count(*)::int AS ready FROM chat.whiteboard_asset WHERE board_id = ${b.id}::uuid AND state = 'ready'`;
    expect(Number(ready)).toBe(0);
  });

  it('staff reading a board get its images signed (the open is logged); no one but the teacher adds one', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Read' }, t);
    const { asset } = await addImage(b.id, t);
    const seen = await boards.review(b.id, staff(tsup, 'admin'));
    expect(seen.assets.map((a) => a.id)).toEqual([asset.id]);
    expect((await log(b.id)).filter((r) => r.viewer_id === tsup).map((r) => r.action)).toEqual(['open']);
    for (const who of [staff(tmgr, 'manager'), staff(sa, 'super_admin'), staff(tsup, 'admin')]) {
      expect(await code(boards.grantImage(b.id, { contentType: 'image/png', byteSize: 10 }, who))).toBe(CommErrorCode.WHITEBOARD_DENIED);
    }
    const support = await supportSession();
    expect(await code(asSupport(support, () => boards.grantImage(b.id, { contentType: 'image/png', byteSize: 10 }, t)))).toBe(CommErrorCode.WHITEBOARD_DENIED);
    expect(await code(asSupport(support, () => boards.grantExport(b.id, { pages: [{ byteSize: 10 }] }, t)))).toBe(CommErrorCode.WHITEBOARD_DENIED);
  });

  it('a board read never fails for its images: off here, or not signable, it opens with none (review of #336)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Signed' }, t);
    const { asset } = await addImage(b.id, t);
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: imageOn(asset.id) }, t);
    const mgr = staff(tmgr, 'manager');
    expect((await boards.open(b.id, t)).assets.map((a) => a.id)).toEqual([asset.id]);
    // Storage that cannot sign: the board, its pages and its log row, without the images.
    const sign = jest.spyOn(g.storage, 'signedReadUrl').mockRejectedValue(new Error('storage misconfigured'));
    try {
      const before = (await log(b.id)).length;
      const opened = await boards.open(b.id, t);
      expect([opened.id, opened.pages.length, opened.assets]).toEqual([b.id, 1, []]);
      expect((await boards.review(b.id, mgr)).assets).toEqual([]);
      expect((await log(b.id)).length).toBe(before + 2);
    } finally {
      sign.mockRestore();
    }
    // Images switched off here: none signed at all.
    await assetsSwitch(false);
    const signs = jest.spyOn(g.storage, 'signedReadUrl');
    try {
      expect((await boards.open(b.id, t)).assets).toEqual([]);
      expect((await boards.review(b.id, mgr)).assets).toEqual([]);
      expect(signs).not.toHaveBeenCalled();
    } finally {
      signs.mockRestore();
    }
  });

  it('a copy takes its images to keys of the new board, and the pages name the copies', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Original' }, t);
    const { asset } = await addImage(b.id, t);
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: imageOn(asset.id) }, t);
    const before = await snapshot(b.id);
    const copy = await boards.duplicate(b.id, t);
    expect(copy.assets).toHaveLength(1);
    const copied = copy.assets[0]!;
    expect(copied.id).not.toBe(asset.id);
    expect((copy.pages[0]!.document as { elements: Array<{ assetId: string }> }).elements[0]!.assetId).toBe(copied.id);
    const [row] = await g.prisma.$queryRaw<Array<{ object_key: string }>>`SELECT object_key FROM chat.whiteboard_asset WHERE id = ${copied.id}::uuid`;
    expect(row!.object_key).toBe(`whiteboards/${org}/${copy.id}/${copied.id}`);
    expect((await blobs.get(row!.object_key))?.bytes.length).toBe(asset.byteSize);
    expect(await snapshot(b.id)).toEqual(before);
  });

  it('an export: the pages checked as images, one PDF back, logged, and nothing of it kept', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Export me' }, t);
    await boards.addPage(b.id, { revision: 1 }, t);
    const pages = [png(64, 36), png(64, 36)];
    const grant = await boards.grantExport(b.id, { pages: pages.map((p) => ({ byteSize: p.length })) }, t);
    expect(grant.pages).toHaveLength(2);
    for (const [i, p] of grant.pages.entries()) await blobs.put(p.upload.objectKey, 'image/png', pages[i]!);
    // Every page of one export, each once.
    expect(await code(boards.composeExport(b.id, { pages: [{ assetId: grant.pages[0]!.assetId, objectKey: grant.pages[0]!.upload.objectKey }] }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);
    const { pdf, fileName } = await boards.composeExport(b.id, { pages: grant.pages.map((p) => ({ assetId: p.assetId, objectKey: p.upload.objectKey })) }, t);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(fileName).toBe('Export me.pdf');
    expect((await log(b.id)).map((r) => r.action)).toContain('export');
    expect((await snapshot(b.id))!.assets).toBe(0);
    for (const p of grant.pages) expect(await blobs.get(p.upload.objectKey)).toBeNull();
  });

  it('at most five exports at once; uploads never confirmed are swept an hour on', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Busy' }, t);
    for (let i = 0; i < 5; i++) {
      await boards.grantExport(b.id, { pages: [{ byteSize: 100 }] }, t);
      // Each export has its own expiry: the next grant is a new transaction.
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(await code(boards.grantExport(b.id, { pages: [{ byteSize: 100 }] }, t))).toBe(CommErrorCode.WHITEBOARD_LIMIT);
    await boards.grantImage(b.id, { contentType: 'image/png', byteSize: 100 }, t);
    await exec(`update chat.whiteboard_asset set expires_at = now() - interval '1 minute' where board_id = $1::uuid`, b.id);
    expect(await boards.sweepAbandonedAssets()).toBe(6);
    expect((await snapshot(b.id))!.assets).toBe(0);
  });

  it('a damaged export page is refused, by number, and the API goes on (review of #305, P0)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Broken' }, t);
    await boards.addPage(b.id, { revision: 1 }, t);
    const pages = [png(64, 36), corruptPng()];
    const grant = await boards.grantExport(b.id, { pages: pages.map((p) => ({ byteSize: p.length })) }, t);
    for (const [i, p] of grant.pages.entries()) await blobs.put(p.upload.objectKey, 'image/png', pages[i]!);
    const refused = await boards.composeExport(b.id, { pages: grant.pages.map((p) => ({ assetId: p.assetId, objectKey: p.upload.objectKey })) }, t).catch((e) => e);
    expect(refused).toBeInstanceOf(CommError);
    expect((refused as CommError).code).toBe(CommErrorCode.WHITEBOARD_INVALID);
    expect((refused as CommError).message).toBe('page 2: the PNG image data is damaged');
    expect((await log(b.id)).map((r) => r.action)).not.toContain('export');
    // Nothing of it was kept -- objects or rows (review of #325): a failed export
    // does not count against the five a teacher may have under way.
    for (const p of grant.pages) expect(await blobs.get(p.upload.objectKey)).toBeNull();
    expect((await snapshot(b.id))!.assets).toBe(0);
    expect((await boards.open(b.id, t)).id).toBe(b.id);
  });

  it('an export page larger than the board page is refused at the grant and at compose (review of #305, P1)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Big' }, t);
    expect(await code(boards.grantExport(b.id, { pages: [{ byteSize: 8 * 1024 * 1024 + 1 }] }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);
    const wide = png(1921, 4);
    const grant = await boards.grantExport(b.id, { pages: [{ byteSize: wide.length }] }, t);
    await blobs.put(grant.pages[0]!.upload.objectKey, 'image/png', wide);
    expect(await code(boards.composeExport(b.id, { pages: [{ assetId: grant.pages[0]!.assetId, objectKey: grant.pages[0]!.upload.objectKey }] }, t))).toBe(CommErrorCode.WHITEBOARD_INVALID);
  });

  it('two confirms of one image at once: one claims and keeps it; the other is told to wait, and its retry answers the ready image', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Twice' }, t);
    const bytes = png(40, 30);
    const { assetId, upload } = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: bytes.length }, t);
    await blobs.put(upload.objectKey, 'image/png', bytes);
    const both = await Promise.all([
      boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t).catch((e) => e),
      boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t).catch((e) => e),
    ]);
    const kept = both.filter((r) => !(r instanceof Error));
    expect(kept.length).toBeGreaterThanOrEqual(1);
    for (const r of both) if (r instanceof CommError) expect(r.code).toBe(CommErrorCode.WHITEBOARD_CONFLICT);
    expect(await boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t)).toMatchObject({ replayed: true, asset: { id: assetId } });
    const [row] = await g.prisma.$queryRaw<Array<{ state: string; object_key: string; claim_token: string | null }>>`
      SELECT state, object_key, claim_token::text AS claim_token FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid`;
    expect(row).toMatchObject({ state: 'ready', claim_token: null });
    expect((await blobs.get(row!.object_key))?.bytes.equals(bytes)).toBe(true);
  });

  it('while its bytes are read and checked, a confirm holds a claim, not a transaction; a claim that ran out cannot finish, and a retry claims it again', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Claims' }, t);
    const bytes = png(40, 30);
    const { assetId, upload } = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: bytes.length }, t);
    await blobs.put(upload.objectKey, 'image/png', bytes);
    const assets = (boards as unknown as { assets: WhiteboardAssetService }).assets;
    const real = assets.pin.bind(assets);
    const seen: Array<{ state: string; locked: boolean }> = [];
    const spy = jest.spyOn(assets, 'pin').mockImplementation(async (...args: Parameters<WhiteboardAssetService['pin']>) => {
      const [row] = await g.prisma.$queryRaw<Array<{ state: string }>>`SELECT state FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid`;
      // NOWAIT fails at once if any transaction still holds the row.
      const locked = await g.prisma.$transaction((tx) => tx.$queryRaw`SELECT 1 FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid FOR UPDATE NOWAIT`).then(() => false, () => true);
      seen.push({ state: row!.state, locked });
      // The lease runs out while the bytes are being checked.
      await exec(`update chat.whiteboard_asset set claimed_until = now() - interval '1 second' where id = $1::uuid`, assetId);
      return real(...args);
    });
    try {
      expect(await code(boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t))).toBe(CommErrorCode.WHITEBOARD_STATE);
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual([{ state: 'claimed', locked: false }]);
    const [after] = await g.prisma.$queryRaw<Array<{ state: string }>>`SELECT state FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid`;
    expect(after!.state).toBe('claimed');
    // The same caller's retry claims the lapsed row again and keeps the image.
    expect((await boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t)).asset).toMatchObject({ id: assetId, width: 40 });

    // A lapsed claim nobody retries is the sweep's: object and row both go.
    const other = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: 100 }, t);
    await exec(
      `update chat.whiteboard_asset set state = 'claimed', claim_token = gen_random_uuid(), claimed_until = now() - interval '1 second' where id = $1::uuid`,
      other.assetId,
    );
    expect(await boards.sweepAbandonedAssets()).toBe(1);
    expect((await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM chat.whiteboard_asset WHERE id = ${other.assetId}::uuid`)[0]!.n).toBe(0);
  });

  it('a row whose object cannot be deleted backs off on its own; the rest are swept', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Stuck' }, t);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await boards.grantImage(b.id, { contentType: 'image/png', byteSize: 100 }, t)).assetId);
    await exec(`update chat.whiteboard_asset set expires_at = now() - interval '1 minute' where board_id = $1::uuid`, b.id);
    // Long past its 11th failure: the back-off stays a day, never an overflow (review of #311).
    await exec(`update chat.whiteboard_asset set sweep_attempts = 40 where id = $1::uuid`, ids[0]);
    const stuck = `whiteboards/${org}/${b.id}/${ids[0]}`;
    const real = g.storage.delete.bind(g.storage);
    const spy = jest.spyOn(g.storage, 'delete').mockImplementation(async (key: string) => (key === stuck ? Promise.reject(new Error('storage says no')) : real(key)));
    try {
      expect(await boards.sweepAbandonedAssets()).toBe(2);
      // Backed off: the next sweep does not even try it.
      expect(await boards.sweepAbandonedAssets()).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const [row] = await g.prisma.$queryRaw<Array<{ sweep_attempts: number; later: boolean; within_a_day: boolean }>>`
      SELECT sweep_attempts, sweep_retry_at > now() AS later, sweep_retry_at <= now() + interval '1 day 1 minute' AS within_a_day
        FROM chat.whiteboard_asset WHERE id = ${ids[0]}::uuid`;
    expect(row).toEqual({ sweep_attempts: 41, later: true, within_a_day: true });
    await exec(`update chat.whiteboard_asset set sweep_retry_at = now() - interval '1 second' where id = $1::uuid`, ids[0]);
    expect(await boards.sweepAbandonedAssets()).toBe(1);
  });

  it('the sweep and a confirm at once: never a ready image without its bytes, never bytes without a row', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Race' }, t);
    for (let round = 0; round < 6; round++) {
      const bytes = png(40, 30);
      const { assetId, upload } = await boards.grantImage(b.id, { contentType: 'image/png', byteSize: bytes.length }, t);
      await blobs.put(upload.objectKey, 'image/png', bytes);
      await exec(`update chat.whiteboard_asset set expires_at = now() + interval '50 milliseconds' where id = $1::uuid`, assetId);
      await new Promise((r) => setTimeout(r, round * 15));
      await Promise.all([
        boards.confirmImage(b.id, assetId, { objectKey: upload.objectKey }, t).catch(() => null),
        new Promise((r) => setTimeout(r, 50)).then(() => boards.sweepAbandonedAssets()),
      ]);
      const [row] = await g.prisma.$queryRaw<Array<{ state: string }>>`SELECT state FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid`;
      const kept = await blobs.get(`whiteboards/${org}/${b.id}/${assetId}`);
      if (row?.state === 'ready') expect(kept).not.toBeNull();
      else {
        // Refused (expired) or swept: a leftover pending row is swept next time, and no kept bytes are served.
        await boards.sweepAbandonedAssets();
        expect((await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM chat.whiteboard_asset WHERE id = ${assetId}::uuid`)[0]!.n).toBe(0);
        expect(await blobs.get(`whiteboards/${org}/${b.id}/${assetId}`)).toBeNull();
      }
    }
  });

  it('copying a board with many images copies every one, outside the transaction, under the new board', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Many' }, t);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await addImage(b.id, t, png(10 + i, 10))).asset.id);
    const doc = { v: 1, elements: ids.map((assetId, i) => ({ id: `i${i}`, kind: 'image', assetId, x: i * 10, y: 0, w: 50, h: 50 })) };
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: doc }, t);
    const copy = await boards.duplicate(b.id, t);
    expect(copy.assets).toHaveLength(12);
    const named = (copy.pages[0]!.document as { elements: Array<{ assetId: string }> }).elements.map((e) => e.assetId);
    expect(new Set(named)).toEqual(new Set(copy.assets.map((a) => a.id)));
    expect(named.some((id) => ids.includes(id))).toBe(false);
    for (const a of copy.assets) expect((await blobs.get(`whiteboards/${org}/${copy.id}/${a.id}`))?.bytes.length).toBe(a.byteSize);
    // One source object gone: the copy is refused, and none of its copies is left behind.
    const [gone] = await g.prisma.$queryRaw<Array<{ object_key: string }>>`SELECT object_key FROM chat.whiteboard_asset WHERE id = ${ids[11]}::uuid`;
    await g.storage.delete(gone!.object_key);
    const boardsBefore = (await boards.list(t)).length;
    const copied: string[] = [];
    const real = g.storage.copy!.bind(g.storage);
    const spy = jest.spyOn(g.storage, 'copy').mockImplementation(async (from: string, to: string) => {
      const ok = await real(from, to);
      if (ok) copied.push(to);
      return ok;
    });
    try {
      expect(await code(boards.duplicate(b.id, t))).toBe(CommErrorCode.WHITEBOARD_STATE);
    } finally {
      spy.mockRestore();
    }
    expect(copied.length).toBeGreaterThan(0);
    for (const key of copied) expect(await blobs.get(key)).toBeNull();
    expect((await boards.list(t)).length).toBe(boardsBefore);
  });

  it('a copy that would not fit is refused before a single object is copied (review of #305)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Full up' }, t);
    await addImage(b.id, t);
    // The rest of the 300 MB, as images already kept on another board.
    const filler = await boards.create({ title: 'Filler' }, t);
    await exec(
      `insert into chat.whiteboard_asset (id, board_id, kind, object_key, content_type, byte_size, state)
       select x.id, $1::uuid, 'image', 'whiteboards/' || $2 || '/' || $1 || '/' || x.id, 'image/png', 20971520, 'ready'
         from (select gen_random_uuid() as id from generate_series(1, 15)) x`,
      filler.id, org,
    );
    const spy = jest.spyOn(g.storage, 'copy');
    try {
      expect(await code(boards.duplicate(b.id, t))).toBe(CommErrorCode.WHITEBOARD_LIMIT);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('a burst of exports is turned away before a single page is read (review of #311)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Burst' }, t);
    const page = png(64, 36);
    const grant = await boards.grantExport(b.id, { pages: [{ byteSize: page.length }] }, t);
    await blobs.put(grant.pages[0]!.upload.objectKey, 'image/png', page);
    const slow = join(__dirname, '..', 'unit', 'whiteboards', 'fixtures', 'export-never-answers.js');
    const job = { title: 'busy', pages: [page], credit: null };
    const busy = Array.from({ length: EXPORT_WORKERS + EXPORT_QUEUE }, () => composeInWorker(job, { module: slow, timeoutMs: 1500 }).catch(() => null));
    const assets = (boards as unknown as { assets: WhiteboardAssetService }).assets;
    const pin = jest.spyOn(assets, 'pin');
    try {
      const refused = await boards.composeExport(b.id, { pages: [{ assetId: grant.pages[0]!.assetId, objectKey: grant.pages[0]!.upload.objectKey }] }, t).catch((e) => e);
      expect([(refused as CommError).code, (refused as CommError).status]).toEqual([CommErrorCode.WHITEBOARD_LIMIT, 429]);
      expect(pin).not.toHaveBeenCalled();
    } finally {
      pin.mockRestore();
      await Promise.all(busy);
    }
    // Its page is untouched: the export can be made once the workers are free.
    const { pdf } = await boards.composeExport(b.id, { pages: [{ assetId: grant.pages[0]!.assetId, objectKey: grant.pages[0]!.upload.objectKey }] }, t);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('a copy writes its images only once their rows exist, pending with an expiry, so a crash leaves nothing unsweepable (review of #325)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Rows first' }, t);
    const ids = [(await addImage(b.id, t, png(20, 10))).asset.id, (await addImage(b.id, t, png(30, 10))).asset.id];
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: { v: 1, elements: ids.map((assetId, i) => ({ id: `i${i}`, kind: 'image', assetId, x: 0, y: 0, w: 10, h: 10 })) } }, t);
    const assets = (boards as unknown as { assets: WhiteboardAssetService }).assets;
    const real = assets.copyAll.bind(assets);
    const during: Array<{ object_key: string; state: string; expiring: boolean }> = [];
    const spy = jest.spyOn(assets, 'copyAll').mockImplementation(async (pairs) => {
      // At the moment the objects are written, each already has its row: pending, expiring.
      during.push(
        ...(await g.prisma.$queryRaw<Array<{ object_key: string; state: string; expiring: boolean }>>`
          SELECT object_key, state, (expires_at > now()) AS expiring FROM chat.whiteboard_asset
           WHERE object_key = ANY(${pairs.map((p) => p.to)})`),
      );
      return real(pairs);
    });
    let copy;
    try {
      copy = await boards.duplicate(b.id, t);
    } finally {
      spy.mockRestore();
    }
    expect(during).toHaveLength(2);
    expect(during.every((r) => r.state === 'pending' && r.expiring)).toBe(true);
    // Once copied: ready, and no longer expiring.
    const [{ pending }] = await g.prisma.$queryRaw<Array<{ pending: number }>>`
      SELECT count(*)::int AS pending FROM chat.whiteboard_asset WHERE board_id = ${copy.id}::uuid AND (state <> 'ready' OR expires_at IS NOT NULL)`;
    expect(Number(pending)).toBe(0);
    expect(copy.assets).toHaveLength(2);
  });

  it('two copies to a teacher with one key at once, images and all: one stands, the other is taken back with its objects (#326 + #327)', async () => {
    const t = teacher(s.teacherId);
    const b = await boards.create({ title: 'Raced' }, t);
    const { asset } = await addImage(b.id, t);
    await boards.savePage(b.id, b.pages[0]!.id, { revision: 1, document: imageOn(asset.id) }, t);
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, s.teacherId);
    const mgr = staff(tmgr, 'manager');
    const assets = (boards as unknown as { assets: WhiteboardAssetService }).assets;
    const real = assets.copyAll.bind(assets);
    // The first request's objects are copied, then it waits: the second runs start to end meanwhile.
    const firstKeys: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let copied!: () => void;
    const firstCopied = new Promise<void>((r) => (copied = r));
    let calls = 0;
    const spy = jest.spyOn(assets, 'copyAll').mockImplementation(async (pairs) => {
      if (calls++ > 0) return real(pairs);
      firstKeys.push(...pairs.map((p) => p.to));
      const out = await real(pairs);
      copied();
      await held;
      return out;
    });
    let first, second;
    try {
      const slow = boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'race');
      await firstCopied;
      second = await boards.copyToTeacher(b.id, { teacherId: s.newTeacherId }, mgr, 'race');
      release();
      first = await slow;
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(first.id).toBe(second.id);
    expect((await log(b.id)).filter((r) => r.action === 'copy')).toHaveLength(1);
    expect((await boards.list(teacher(s.newTeacherId))).filter((x) => x.title === 'Raced')).toHaveLength(1);
    expect(firstKeys).toHaveLength(1);
    for (const key of firstKeys) expect(await blobs.get(key)).toBeNull();
  });
});
