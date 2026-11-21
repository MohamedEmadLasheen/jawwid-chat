/**
 * PD-60: GET /learners, the Students page's list. Who may call it (the same
 * rule that lets someone open a Student Profile), the pagination bounds, the
 * filters, and that no contact field is ever in a row.
 */
import 'reflect-metadata';
import { JourneyController } from '../../../src/lessons/journey.controller';
import {
  StudentDirectoryService,
  STUDENTS_DEFAULT_LIMIT,
  STUDENTS_MAX_LIMIT,
  parseStudentsQuery,
} from '../../../src/lessons/student-directory.service';
import { ROUTE_ACCESS, type RouteAccess } from '../../../src/platform/permissions/route-access';
import { legacyBundle, legacyBundleNames, type StaffPlacement } from '../../../src/platform/permissions/legacy-bundles';
import { CommError, CommErrorCode } from '../../../src/platform/errors';

const ORG = '00000000-0000-4000-8000-000000000001';
const T1 = '00000000-0000-4000-8000-0000000000a1';
const SUP = '00000000-0000-4000-8000-0000000000b1';
const L1 = '00000000-0000-4000-8000-0000000000c1';
const L2 = '00000000-0000-4000-8000-0000000000c2';

function bundle(name: string): ReadonlySet<string> {
  if (name === 'super_admin') return legacyBundle('super_admin', { kind: null, position: null });
  const [tier, kind] = name.split(':') as ['manager' | 'supervisor' | 'legacy_department', string];
  const placement: StaffPlacement = {
    kind: kind === 'none' ? null : (kind as StaffPlacement['kind']),
    position: tier === 'manager' ? 'manager' : tier === 'supervisor' ? 'member' : null,
  };
  return legacyBundle(tier === 'legacy_department' ? null : tier, placement);
}

describe('GET /learners: the route key', () => {
  it('requires students.view, the key of the Student Profile', () => {
    const fn = JourneyController.prototype.students as unknown as object;
    const access = Reflect.getMetadata(ROUTE_ACCESS, fn) as RouteAccess;
    expect(access).toMatchObject({ kind: 'requires', anyOf: ['students.view'] });
    const passing = legacyBundleNames().filter((b) => bundle(b).has('students.view'));
    const profile = Reflect.getMetadata(ROUTE_ACCESS, JourneyController.prototype.studentProfile as unknown as object) as RouteAccess;
    expect(profile).toEqual(access);
    expect(passing.length).toBeGreaterThan(0);
  });
});

describe('parseStudentsQuery', () => {
  it('defaults, and caps the page size at the hard maximum', () => {
    expect(parseStudentsQuery({})).toMatchObject({ page: 1, limit: STUDENTS_DEFAULT_LIMIT, q: null, teacher: null, status: null });
    expect(parseStudentsQuery({ limit: String(STUDENTS_MAX_LIMIT) }).limit).toBe(STUDENTS_MAX_LIMIT);
  });
  it.each([
    [{ limit: '101' }],
    [{ limit: '0' }],
    [{ limit: '-1' }],
    [{ limit: 'abc' }],
    [{ page: '0' }],
    [{ page: '10001' }],
    [{ status: 'deleted' }],
    [{ teacher: 'not-an-id' }],
    [{ supervisor: 'x' }],
    [{ q: 'x'.repeat(101) }],
  ])('refuses %j with 400', (q) => {
    expect(() => parseStudentsQuery(q)).toThrow(CommError);
  });
  it('accepts none as a teacher, trims the search', () => {
    expect(parseStudentsQuery({ teacher: 'none', q: '  Ali ' })).toMatchObject({ teacher: 'none', q: 'Ali' });
  });
});

type Actor = { kind: string; staffRole?: string; isActive: boolean; organizationId: string | null; actorId: string };
const staff = (staffRole: string, extra: Partial<Actor> = {}): Actor => ({ kind: 'staff', staffRole, isActive: true, organizationId: ORG, actorId: SUP, ...extra });

function build(actor: Actor, opts: { department?: boolean; all?: boolean; scopeTeachers?: string[]; supervised?: string[] } = {}) {
  const calls: Record<string, Array<Record<string, unknown>>> = {};
  const rec = (name: string, rows: unknown) => (args: Record<string, unknown>) => {
    (calls[name] ??= []).push(args);
    return Promise.resolve(rows);
  };
  const learnerRows = [
    { id: L1, name: 'Child A', teacherId: T1, family: { id: 'f1', displayName: 'Family A', phone: '+20100', email: 'a@x.test' }, teacher: { id: T1, name: 'Teacher T', phone: '+20' } },
    { id: L2, name: 'Child B', teacherId: null, family: { id: 'f2', displayName: 'Family B' }, teacher: null },
  ];
  const prisma = {
    learner: { count: rec('count', 2), findMany: (a: Record<string, unknown>) => rec('learner', 'select' in a && (a.select as Record<string, unknown>).family ? learnerRows : learnerRows.map((r) => ({ id: r.id, teacherId: r.teacherId })))(a) },
    learnerSuspension: { findMany: rec('suspension', [{ learnerId: L2, kind: 'temporary', returnOn: new Date('2026-12-01T00:00:00Z') }]) },
    learnerScheduleSlot: { groupBy: rec('slots', [{ learnerId: L1, _count: { _all: 3 } }]) },
    learnerSupervision: { findMany: rec('supervision', [{ learnerId: L1, supervisorId: SUP }]) },
    teacher: { findMany: rec('teacher', [{ id: T1, name: 'Teacher T' }]) },
    staff: { findMany: rec('staff', [{ id: SUP, name: 'Supervisor S' }]) },
  };
  const lessons = {
    isManager: () => Promise.resolve(opts.department === true),
    supervisedLearnerIds: () => Promise.resolve(opts.supervised ?? []),
    teacherScope: { scopeOf: () => Promise.resolve({ all: opts.all ?? true, teacherIds: new Set(opts.scopeTeachers ?? []) }) },
  };
  const conversations = { requireActor: () => Promise.resolve(actor) };
  const svc = new StudentDirectoryService(prisma as never, conversations as never, lessons as never);
  return { svc, calls };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  return 'ok';
};

describe('StudentDirectoryService: who may list', () => {
  it('refuses a teacher, a parent contact and an inactive staff member', async () => {
    expect(await code(build({ kind: 'teacher', isActive: true, organizationId: ORG, actorId: T1 }, { department: true }).svc.list(T1, {}))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(build({ kind: 'contact', isActive: true, organizationId: ORG, actorId: T1 }).svc.list(T1, {}))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(build(staff('admin', { isActive: false }), { department: true }).svc.list(SUP, {}))).toBe(CommErrorCode.LESSON_DENIED);
  });
  it('refuses staff outside the Teachers department who supervise nobody (Sales, Operations)', async () => {
    expect(await code(build(staff('admin'), { department: false, supervised: [] }).svc.list(SUP, {}))).toBe(CommErrorCode.LESSON_DENIED);
  });
  it('allows the super admin, the Teachers department, and a supervisor of at least one child', async () => {
    expect(await code(build(staff('super_admin')).svc.list(SUP, {}))).toBe('ok');
    expect(await code(build(staff('admin'), { department: true }).svc.list(SUP, {}))).toBe('ok');
    expect(await code(build(staff('admin'), { supervised: [L1] }).svc.list(SUP, {}))).toBe('ok');
  });
});

describe('StudentDirectoryService: scope, filters, pagination, fields', () => {
  it('a scoped department sees its teachers\' learners; a supervisor adds only theirs', async () => {
    const { svc, calls } = build(staff('admin'), { department: true, all: false, scopeTeachers: [T1], supervised: [L2] });
    await svc.list(SUP, {});
    const where = JSON.stringify(calls.count[0]);
    expect(where).toContain(JSON.stringify({ teacherId: { in: [T1] } }));
    expect(where).toContain(JSON.stringify({ id: { in: [L2] } }));
    expect(where).toContain(ORG);
  });
  it('a pure supervisor is limited to the children they supervise', async () => {
    const { svc, calls } = build(staff('admin'), { supervised: [L1] });
    await svc.list(SUP, {});
    const where = JSON.stringify(calls.count[0]);
    expect(where).toContain(JSON.stringify({ id: { in: [L1] } }));
    expect(where).not.toContain('"teacherId"');
  });
  it('pages with a stable order and skip/take from page and limit', async () => {
    const { svc, calls } = build(staff('super_admin'));
    const r = await svc.list(SUP, { page: '3', limit: '10' });
    expect(calls.learner[0]).toMatchObject({ skip: 20, take: 10, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    expect(r).toMatchObject({ page: 3, limit: 10, total: 2 });
  });
  it('searches the student and the family name; filters by teacher, none, supervisor and status', async () => {
    const a = build(staff('super_admin'));
    await a.svc.list(SUP, { q: 'ali', teacher: T1, supervisor: SUP, status: 'paused' });
    const where = JSON.stringify(a.calls.count[0]);
    expect(where).toContain('"contains":"ali"');
    expect(where).toContain('displayName');
    expect(where).toContain(JSON.stringify({ teacherId: T1 }));
    expect(a.calls.suspension[0]).toMatchObject({ where: { kind: 'temporary', status: 'active' } });
    const b = build(staff('super_admin'));
    await b.svc.list(SUP, { teacher: 'none', status: 'stopped' });
    expect(JSON.stringify(b.calls.count[0])).toContain(JSON.stringify({ teacherId: null }));
    expect(b.calls.suspension[0]).toMatchObject({ where: { kind: 'permanent' } });
    const c = build(staff('super_admin'));
    await c.svc.list(SUP, { status: 'active' });
    expect(JSON.stringify(c.calls.count[0])).toContain('notIn');
  });
  it('returns essential fields only: no contact, birth date or money', async () => {
    const r = await build(staff('super_admin')).svc.list(SUP, {});
    const [a, b] = r.students;
    expect(a).toEqual({
      id: L1,
      name: 'Child A',
      family: { id: 'f1', displayName: 'Family A' },
      teacher: { id: T1, name: 'Teacher T' },
      supervisor: { id: SUP, name: 'Supervisor S' },
      status: 'active',
      returnOn: null,
      weeklySlots: 3,
    });
    expect(b).toMatchObject({ status: 'paused', returnOn: '2026-12-01', weeklySlots: 0, teacher: null });
    const text = JSON.stringify(r);
    for (const leak of ['phone', 'email', '+20', 'a@x.test', 'birthDate']) expect(text).not.toContain(leak);
    expect(r.filters.teachers).toEqual([{ id: T1, name: 'Teacher T' }]);
  });
});
