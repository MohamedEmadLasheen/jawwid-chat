/**
 * PD-38: who sees what on the calendar is the UNION of every basis a person holds
 * (Operations academy / own children; PD-35 Teachers scope). No single check is
 * final. The department guards make some combinations unreachable today (a
 * department member is admin/coverage in ONE department; a manager has the
 * manager role), so the rule is proven here on the facts themselves, with the
 * services that supply them stubbed. Synthetic ids only.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import { ActorKind, StaffRole } from '../../../src/communication/contracts/vocab';
import { CalendarService } from '../../../src/calendar/calendar.service';
import { WorkPatternService } from '../../../src/calendar/work-pattern.service';

const ORG = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-0000000000aa';
const T1 = '00000000-0000-4000-8000-000000000101';
const T2 = '00000000-0000-4000-8000-000000000102';

const actor = (role: StaffRole = StaffRole.ADMIN): Actor =>
  ({ actorId: STAFF, kind: ActorKind.STAFF, staffRole: role, isActive: true, organizationId: ORG, displayName: 'staff_a', locale: 'en' }) as Actor;

interface Facts {
  teachers: { department: boolean; all: boolean; ids?: string[] };
  managesOperations?: boolean;
  operationsMember?: boolean;
  ownLearners?: string[];
  learnersOfAssigned?: string[];
}

function service(f: Facts): CalendarService {
  const prisma = {
    // managesDepartment's EXISTS, or the assigned teachers' children.
    $queryRaw: async (sql: TemplateStringsArray) => {
      const text = sql.join('?');
      if (text.includes('FROM chat.department d')) return [{ ok: f.managesOperations === true }];
      if (text.includes('FROM chat.learner')) return (f.learnersOfAssigned ?? []).map((id) => ({ id }));
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const lessons = {
    teachersFacts: async () => ({
      department: f.teachers.department,
      scope: f.teachers.all ? { all: true } : { all: false, teacherIds: new Set(f.teachers.ids ?? []) },
    }),
    inDepartment: async (_a: Actor, kind: string) => kind === 'operations' && f.operationsMember === true,
    supervisedLearnerIds: async () => f.ownLearners ?? [],
  };
  return new CalendarService(prisma as never, {} as never, lessons as never, {} as never, {} as never);
}

describe('the calendar scope is the union of every basis', () => {
  it('the super admin, the Operations Manager, and the Teachers department with the switch off: the academy', async () => {
    expect(await service({ teachers: { department: false, all: false } }).scopeOf(actor(StaffRole.SUPER_ADMIN))).toMatchObject({ kind: 'academy' });
    expect(await service({ teachers: { department: false, all: false }, managesOperations: true }).scopeOf(actor(StaffRole.MANAGER)))
      .toMatchObject({ kind: 'academy' });
    expect(await service({ teachers: { department: true, all: true } }).scopeOf(actor())).toMatchObject({ kind: 'academy' });
  });

  it('the Operations Manager who is also a strict-scope teacher supervisor keeps the academy', async () => {
    const scope = await service({ teachers: { department: true, all: false, ids: [T1] }, managesOperations: true }).scopeOf(actor(StaffRole.MANAGER));
    expect(scope).toMatchObject({ kind: 'academy' });
  });

  it('an Operations supervisor who is also a strict-scope teacher supervisor keeps their own children AND names their teachers\' lessons', async () => {
    const scope = await service({
      teachers: { department: true, all: false, ids: [T1] },
      operationsMember: true,
      ownLearners: ['k-own'],
      learnersOfAssigned: ['k-of-t1'],
    }).scopeOf(actor());
    expect(scope).toMatchObject({ kind: 'supervisor' });
    if (scope?.kind !== 'supervisor') throw new Error('unreachable');
    expect([...scope.ownLearners].sort()).toEqual(['k-of-t1', 'k-own']);
    expect([...scope.namedTeachers]).toEqual([T1]);
  });

  it('one basis alone: an Operations supervisor names only their children; a teacher supervisor sees only their teachers', async () => {
    const ops = await service({ teachers: { department: false, all: false }, operationsMember: true, ownLearners: ['k-own'] }).scopeOf(actor());
    expect(ops).toMatchObject({ kind: 'supervisor' });
    if (ops?.kind !== 'supervisor') throw new Error('unreachable');
    expect([...ops.ownLearners]).toEqual(['k-own']);
    expect(ops.namedTeachers.size).toBe(0);
    const tsup = await service({ teachers: { department: true, all: false, ids: [T1] } }).scopeOf(actor());
    expect(tsup).toMatchObject({ kind: 'teachers' });
    if (tsup?.kind !== 'teachers') throw new Error('unreachable');
    expect([...tsup.teacherIds]).toEqual([T1]);
  });

  it('nobody else has a calendar', async () => {
    expect(await service({ teachers: { department: false, all: false } }).scopeOf(actor())).toBeNull();
  });
});

describe('a work pattern is written under the same scope it is read under', () => {
  it('an editor whose scope does not cover the teacher gets "not found" before anything is validated or written', async () => {
    let writes = 0;
    const prisma = {
      teacher: { findFirst: async () => ({ id: T2, organizationId: ORG }) },
      $transaction: async () => {
        writes += 1;
      },
      $queryRaw: async () => {
        writes += 1;
        return [];
      },
    };
    const calendar = {
      managesDepartment: async () => true,
      requireScope: async () => ({ actor: actor(), scope: { kind: 'teachers', staffId: STAFF, teacherIds: new Set([T1]) } }),
    };
    const conversations = { requireActor: async () => actor() };
    const patterns = new WorkPatternService(prisma as never, conversations as never, {} as never, {} as never, calendar as never, {} as never, {} as never);
    let code: string | null = null;
    try {
      await patterns.setPattern(STAFF, T2, { category: 'full_shift', timezone: 'Africa/Cairo', validFrom: '2099-01-01' });
    } catch (e) {
      code = e instanceof CommError ? e.code : String(e);
    }
    expect(code).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(writes).toBe(0);
  });
});
