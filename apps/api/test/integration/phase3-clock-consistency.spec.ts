/**
 * ONE AUTHORITATIVE CLOCK FOR EVERY RELATIONSHIP WINDOW (defect P3-7).
 *
 * Phase 3 history is a set of windows -- started_at/ended_at,
 * joined_at/left_at -- each protected by a `window_ordered` CHECK. A window is
 * only meaningful if BOTH of its boundaries come from the same clock.
 *
 * Prisma's `@default(now())` generates its value CLIENT-side and sends it. Had
 * the openers been written that way, an app host running a few milliseconds
 * behind the database would close a window before the database thinks it
 * opened, and `left_at >= joined_at` would reject an entirely legitimate
 * removal. The failure would be intermittent, environment-dependent and
 * invisible in any single-host test run -- which is exactly the kind of defect
 * that reaches production.
 *
 * So the DATABASE owns every boundary. This suite pins that down three ways:
 * structurally (the column defaults), behaviourally (Prisma omits the columns),
 * and under real concurrency.
 *
 * It must not be "fixed" by relaxing a window_ordered constraint.
 */
import { PrismaService } from '@platform/prisma.service';
import { buildGraph, buildGraphOn, seed, truncate, Scenario } from './harness';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

describe('the database owns every window boundary', () => {
  it('every Phase 3 window OPENER defaults to clock_timestamp()', async () => {
    // Structural. If a future schema change reintroduces a client-side default,
    // this fails before anyone has to reproduce a clock-skew race.
    const rows = await prisma.$queryRawUnsafe<Array<{ col: string; def: string | null }>>(`
      select table_name||'.'||column_name as col, column_default as def
        from information_schema.columns
       where table_schema = 'chat'
         and (table_name, column_name) in (
           ('learner_teacher_assignment','started_at'),
           ('group_member','joined_at'),
           ('group_teacher','started_at'))`);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(`${row.col} -> ${row.def}`).toBe(`${row.col} -> clock_timestamp()`);
    }
  });

  it('no window_ordered constraint has been weakened away', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
      select conname as name from pg_constraint where conname in (
        'learner_teacher_assignment_window_ordered',
        'group_member_window_ordered',
        'group_teacher_window_ordered')`);
    expect(rows.map((r) => r.name).sort()).toEqual([
      'group_member_window_ordered',
      'group_teacher_window_ordered',
      'learner_teacher_assignment_window_ordered',
    ]);
  });

  it('Prisma OMITS the opener columns, so the database default applies', async () => {
    // Behavioural counterpart to the structural check: a default is only
    // authoritative if the ORM actually lets it fire.
    const logged = new PrismaService({ log: [{ emit: 'event', level: 'query' }] } as never);
    const graph = buildGraphOn(logged);
    const sql: string[] = [];
    (logged as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on(
      'query',
      (e) => sql.push(e.query),
    );
    try {
      const manager = (await graph.identity.resolveActor(s.managerId))!;
      const group = await graph.groups.create(manager, { name: 'clock', ownerId: s.ownerId });
      await graph.groups.addMember(manager, group.id, s.learnerId);
      await graph.groups.addTeacher(manager, group.id, s.teacherId);

      const memberInsert = sql.find((q) => /INSERT INTO "chat"\."group_member"/.test(q))!;
      const teacherInsert = sql.find((q) => /INSERT INTO "chat"\."group_teacher"/.test(q))!;
      const columns = (q: string) => q.slice(q.indexOf('('), q.indexOf('VALUES'));

      expect(memberInsert).toBeDefined();
      expect(columns(memberInsert)).not.toContain('joined_at');
      expect(columns(teacherInsert)).not.toContain('started_at');
    } finally {
      await logged.$disconnect();
    }
  });

  it('closing a window uses the database clock too', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.groups.create(manager, { name: 'clock2', ownerId: s.ownerId });
    await g.groups.addMember(manager, group.id, s.learnerId);
    await g.groups.removeMember(manager, group.id, s.learnerId, 'probe');

    const row = await prisma.groupMember.findFirstOrThrow({
      where: { groupId: group.id, learnerId: s.learnerId },
    });
    expect(row.leftAt).not.toBeNull();
    // Both boundaries from one clock: the close is at or after the open.
    expect(row.leftAt!.getTime()).toBeGreaterThanOrEqual(row.joinedAt.getTime());
  });
});

describe('teacher assignment windows', () => {
  it('every ended assignment satisfies ended_at >= started_at', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'first');
    await g.learners.assignTeacher(manager, s.learnerId, s.newTeacherId, 'second');
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'third');

    const rows = await prisma.learnerTeacherAssignment.findMany({
      where: { learnerId: s.learnerId },
      orderBy: { startedAt: 'asc' },
    });
    for (const row of rows) {
      if (row.endedAt) expect(row.endedAt.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
    }
  });

  it('the history is a CONTIGUOUS chain: each window ends as the next begins', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'first');
    await g.learners.assignTeacher(manager, s.learnerId, s.newTeacherId, 'second');

    const rows = await prisma.learnerTeacherAssignment.findMany({
      where: { learnerId: s.learnerId },
      orderBy: { startedAt: 'asc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < rows.length - 1; i++) {
      // No gap that reverses, and no overlap: the predecessor is closed at or
      // before its successor opens. Both stamps come from the same clock, so
      // this comparison is meaningful rather than a race on host time.
      expect(rows[i].endedAt).not.toBeNull();
      expect(rows[i].endedAt!.getTime()).toBeLessThanOrEqual(rows[i + 1].startedAt.getTime());
    }
    // Exactly one open window, and it is the last.
    expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1);
    expect(rows[rows.length - 1].endedAt).toBeNull();
  });
});

describe('concurrent transfers cannot produce a backwards window', () => {
  it('two overlapping transfers serialise, leaving one live row and no reversal', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'initial');

    // Two SEPARATE connections, each in its own transaction, deliberately
    // overlapped. This is the shape that produced both P3-3 (unique_violation)
    // and P3-4 (backwards window) before the learner-row lock and
    // clock_timestamp() landed.
    const a = new PrismaService();
    const b = new PrismaService();
    const transfer = (client: PrismaService, teacherId: string, delayMs: number) =>
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select pg_sleep(${delayMs / 1000})`);
        await tx.$executeRawUnsafe(
          `select chat.assign_learner_teacher('${s.learnerId}'::uuid, '${teacherId}'::uuid,
             'concurrent', '${s.managerId}'::uuid)`,
        );
      }, { timeout: 20_000 });

    try {
      const results = await Promise.allSettled([
        transfer(a, s.newTeacherId, 200),
        transfer(b, s.teacherId, 400),
      ]);
      // Neither may fail: a legitimate concurrent transfer must be APPLIED
      // after the first, not rejected with a raw constraint error.
      for (const r of results) {
        if (r.status === 'rejected') {
          throw new Error(`a concurrent transfer was refused: ${String(r.reason).slice(0, 300)}`);
        }
      }
    } finally {
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }

    const rows = await prisma.learnerTeacherAssignment.findMany({
      where: { learnerId: s.learnerId },
      orderBy: { startedAt: 'asc' },
    });

    expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1);
    for (const row of rows) {
      if (row.endedAt) expect(row.endedAt.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
    }
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].endedAt!.getTime()).toBeLessThanOrEqual(rows[i + 1].startedAt.getTime());
    }

    // And the mirror agrees with the one live row.
    const learner = await prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } });
    expect(learner.teacherId).toBe(rows.find((r) => r.endedAt === null)!.teacherId);
  });
});
