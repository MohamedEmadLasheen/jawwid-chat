/**
 * PD-59 (S1, S2): prospects recorded outside the pipeline (TrialService.createProspect, the booking's own
 * party) are owned by their creator when that is Sales staff, and a Sales REPRESENTATIVE reads and books
 * only the prospects assigned to them. Everyone else who may read prospects -- the Sales manager, the
 * super admin, Operations, the Teachers department -- reads exactly as before.
 */
import { TrialService } from '../../../src/lessons/trial.service';
import { CommErrorCode } from '../../../src/platform/errors';

const ORG = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const PROSPECT = '33333333-3333-4333-8333-333333333333';
const TEACHER = '44444444-4444-4444-8444-444444444444';

interface Who {
  role: 'admin' | 'manager' | 'super_admin';
  /** chat.sales_department_role */
  sales: 'member' | 'manager' | null;
  operations?: boolean;
  /** the Teachers department (LessonService.isManager) */
  teachers?: boolean;
}

function build(who: Who) {
  const actor = { actorId: ME, kind: 'staff', organizationId: ORG, isActive: true, staffRole: who.role };
  const wheres: Array<Record<string, unknown>> = [];
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    $queryRaw: async () => [{ role: who.sales }],
    $transaction: async (fn: (t: unknown) => unknown) => fn(prisma),
    trialProspect: {
      findMany: async (a: { where: Record<string, unknown> }) => { wheres.push(a.where); return []; },
      findFirst: async (a: { where: Record<string, unknown> }) => { wheres.push(a.where); return null; },
      create: async (a: { data: Record<string, unknown> }) => {
        created.push(a.data);
        return { id: PROSPECT, organizationId: ORG, displayName: 'x', level: null, note: null, createdAt: new Date() };
      },
    },
    trialStudent: { create: async () => undefined, createMany: async () => undefined },
    teacher: { findFirst: async () => ({ id: TEACHER }) },
  };
  const lessons = {
    inDepartment: async (_a: unknown, kind: string) => (kind === 'sales' ? who.sales !== null : who.operations === true),
    isManager: async () => who.teachers === true,
    teacherScope: { covers: async () => true },
  };
  const conversations = { requireActor: async () => actor };
  const audit = { audit: async () => undefined };
  const service = new TrialService(prisma as never, conversations as never, lessons as never, {} as never, audit as never, {} as never, {} as never);
  return { service, wheres, created };
}

const rep: Who = { role: 'admin', sales: 'member' };

describe('S1: a Sales representative reads and books only their own prospects', () => {
  it('prospects() is scoped to owner = me for a representative', async () => {
    const t = build(rep);
    await t.service.prospects(ME);
    expect(t.wheres).toEqual([{ organizationId: ORG, ownerStaffId: ME }]);
  });

  it.each([
    ['the Sales manager', { role: 'admin', sales: 'manager' } as Who],
    ['the super admin', { role: 'super_admin', sales: null } as Who],
    ['Operations', { role: 'admin', sales: null, operations: true } as Who],
    ['the Teachers department', { role: 'manager', sales: null, teachers: true } as Who],
    ['a Sales member who is also on Operations', { role: 'admin', sales: 'member', operations: true } as Who],
  ])('%s reads every prospect of the academy, exactly as before', async (_l, who) => {
    const t = build(who);
    await t.service.prospects(ME);
    expect(t.wheres).toEqual([{ organizationId: ORG }]);
  });

  it('booking a trial for a prospect looks it up inside the representative\'s own prospects: another\'s is "not found"', async () => {
    const t = build(rep);
    const body = { prospectId: PROSPECT, teacherId: TEACHER, startsAt: '2030-01-01T10:00:00Z' };
    await expect(t.service.book(ME, body)).rejects.toMatchObject({ code: CommErrorCode.LESSON_NOT_FOUND, message: 'prospect not found' });
    expect(t.wheres).toEqual([{ id: PROSPECT, organizationId: ORG, ownerStaffId: ME }]);
    // everyone else: the lookup is the academy's, as before
    const m = build({ role: 'admin', sales: 'manager' });
    await expect(m.service.book(ME, body)).rejects.toMatchObject({ message: 'prospect not found' });
    expect(m.wheres).toEqual([{ id: PROSPECT, organizationId: ORG }]);
  });
});

describe('S2: a prospect recorded outside the pipeline is owned by its creator when that is Sales staff', () => {
  it('createProspect: a Sales member or manager owns what they record', async () => {
    for (const sales of ['member', 'manager'] as const) {
      const t = build({ role: 'admin', sales });
      await t.service.createProspect(ME, { displayName: 'Layla' });
      expect(t.created[0]).toMatchObject({ createdBy: ME, ownerStaffId: ME });
    }
  });

  it.each([
    ['the super admin', { role: 'super_admin', sales: null } as Who],
    ['Operations', { role: 'admin', sales: null, operations: true } as Who],
    ['a Sales member who is also on Operations', { role: 'admin', sales: 'member', operations: true } as Who],
  ])('createProspect by %s leaves it unassigned (NULL: the Sales manager and the super admin reach it)', async (_l, who) => {
    const t = build(who);
    // Operations / the super admin may record prospects (the trial desk); a Teachers-department account may not.
    await t.service.createProspect(ME, { displayName: 'Layla' });
    expect(t.created[0]).toMatchObject({ createdBy: ME, ownerStaffId: null });
  });
});
