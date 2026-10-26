/**
 * Student Group provisioning -- who may create or re-sync a learner's group.
 *
 * Before this gate, `POST /conversations/student-group` and
 * `POST /conversations/student-group/:learnerId/sync` checked nothing: any
 * authenticated parent or teacher holding a learner id could create or re-sync
 * another family's group and read the child's name from its title.
 *
 * Two layers are exercised here:
 *   1. the decisions themselves (pure, no database), as a role x scope matrix;
 *   2. ConversationService against a stub database, to prove ORDER -- the gate
 *      runs before the learner is looked up -- and that a refusal writes nothing.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { SYSTEM_ACTOR, type Actor } from '@platform/types';
import { ConversationService } from '@communication/conversations/conversation.service';
import {
  academicStaff,
  admin,
  authzWithScope,
  financeStaff,
  manager,
  parent,
  teacher,
} from '../../support/fixtures';

/**
 * PD-8: how each staff id acts for the learner's supervisor (admin-1) --
 * chat.staff_acts_for(), stubbed. admin-1 IS the supervisor, cov-1 is their
 * ACTIVE backup, m / manager-1 their department manager. Nobody else.
 */
const authz = authzWithScope(
  {},
  { 'admin-1': 'self', 'cov-1': 'backup', m: 'manager', 'manager-1': 'manager' },
);
const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const coverageAdmin = (id = 'coverage-1') => admin(id, 'coverage');
const target = (over: Partial<Parameters<typeof authz.canProvisionStudentGroupFor>[1]> = {}) => ({
  learnerOrganizationId: ORG,
  familyOrganizationId: ORG,
  supervisorId: 'admin-1' as string | null,
  actorActsFor: null as 'self' | 'backup' | 'manager' | null,
  ...over,
});

const deniedWith = (d: ReturnType<typeof authz.canProvisionStudentGroup>, code: CommErrorCode) => {
  expect(d.allowed).toBe(false);
  if (!d.allowed) expect(d.code).toBe(code);
};

describe('canProvisionStudentGroup -- the gate asked before any lookup', () => {
  it('admin, coverage and manager pass the gate', () => {
    for (const actor of [admin(), coverageAdmin(), manager()]) {
      expect(authz.canProvisionStudentGroup(actor).allowed).toBe(true);
    }
  });

  it('SYSTEM passes (Core ingestion and fixtures provision with no person behind them)', () => {
    expect(authz.canProvisionStudentGroup(SYSTEM_ACTOR).allowed).toBe(true);
  });

  it('a parent is refused', () => {
    deniedWith(authz.canProvisionStudentGroup(parent()), CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
  });

  it('a teacher is refused', () => {
    deniedWith(authz.canProvisionStudentGroup(teacher()), CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
  });

  it('department staff are refused', () => {
    for (const actor of [financeStaff(), academicStaff(), admin('tech-1', 'technical')]) {
      deniedWith(authz.canProvisionStudentGroup(actor), CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    }
  });

  it('an inactive admin is refused before the role is considered', () => {
    deniedWith(authz.canProvisionStudentGroup({ ...admin(), isActive: false }), CommErrorCode.ACTOR_INACTIVE);
  });

  it('staff with no organization are refused (fails closed, never compares undefined)', () => {
    const orphan: Actor = { ...manager(), organizationId: undefined };
    deniedWith(authz.canProvisionStudentGroup(orphan), CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
  });
});

describe('canProvisionStudentGroupFor -- tenant and supervisor scope (PD-8)', () => {
  it("the learner's supervisor may provision", () => {
    expect(authz.canProvisionStudentGroupFor(admin('admin-1'), target({ actorActsFor: 'self' })).allowed).toBe(true);
  });

  it('their ACTIVE backup may provision', () => {
    expect(
      authz.canProvisionStudentGroupFor(coverageAdmin('cov-1'), target({ actorActsFor: 'backup' })).allowed,
    ).toBe(true);
  });

  it('their department manager and the super admin may provision', () => {
    expect(authz.canProvisionStudentGroupFor(manager(), target({ actorActsFor: 'manager' })).allowed).toBe(true);
    expect(authz.canProvisionStudentGroupFor(admin('s', 'super_admin'), target()).allowed).toBe(true);
  });

  it('a manager of ANOTHER department is refused: the role alone is not scope', () => {
    deniedWith(authz.canProvisionStudentGroupFor(manager(), target()), CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
  });

  it('an admin who is not the supervisor is refused', () => {
    deniedWith(
      authz.canProvisionStudentGroupFor(admin('admin-2'), target()),
      CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP,
    );
  });

  it('a coverage admin with no active backup link is refused (on-duty is not scope)', () => {
    deniedWith(
      authz.canProvisionStudentGroupFor(coverageAdmin(), target()),
      CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP,
    );
  });

  it('a learner with NO supervisor has no group yet, whoever asks -- there would be no admin for BR-1', () => {
    for (const actor of [manager(), admin('s', 'super_admin'), SYSTEM_ACTOR]) {
      deniedWith(
        authz.canProvisionStudentGroupFor(actor, target({ supervisorId: null, actorActsFor: 'manager' })),
        CommErrorCode.LEARNER_UNSUPERVISED,
      );
    }
  });

  it("another organization's learner reads as NOT FOUND, even to a manager and even to the 'supervisor'", () => {
    for (const actor of [manager(), admin('admin-1')]) {
      deniedWith(
        authz.canProvisionStudentGroupFor(actor, target({ learnerOrganizationId: OTHER_ORG, actorActsFor: 'self' })),
        CommErrorCode.CONVERSATION_NOT_FOUND,
      );
    }
  });

  it("a learner whose FAMILY is in another organization reads as NOT FOUND (RT-029: neither is trusted alone)", () => {
    deniedWith(
      authz.canProvisionStudentGroupFor(manager(), target({ familyOrganizationId: OTHER_ORG, actorActsFor: 'manager' })),
      CommErrorCode.CONVERSATION_NOT_FOUND,
    );
  });

  it('the per-learner check repeats the gate, so it is safe to call on its own', () => {
    deniedWith(authz.canProvisionStudentGroupFor(parent(), target()), CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    deniedWith(
      authz.canProvisionStudentGroupFor({ ...admin('admin-1'), isActive: false }, target({ actorActsFor: 'self' })),
      CommErrorCode.ACTOR_INACTIVE,
    );
  });

  it('SYSTEM is allowed for any learner', () => {
    expect(
      authz.canProvisionStudentGroupFor(SYSTEM_ACTOR, target({ learnerOrganizationId: OTHER_ORG })).allowed,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ConversationService: order of checks, and no writes on refusal.
// ---------------------------------------------------------------------------

interface Stub {
  service: ConversationService;
  learnerLookups: number;
  writes: number;
}

/**
 * A ConversationService over a stub database. Only the calls the provisioning
 * paths make are implemented; every write path counts, so a refusal that wrote
 * anything would show up as a non-zero `writes`.
 */
function stubService(opts: {
  actors: Record<string, Actor>;
  learner: null | {
    organizationId: string;
    family: { organizationId: string; ownerId: string };
  };
  existingGroup?: boolean;
}): Stub {
  const state = { learnerLookups: 0, writes: 0 };
  const learnerRow = opts.learner && {
    id: 'learner-1',
    name: 'Ahmed',
    familyId: 'family-1',
    teacherId: null,
    organizationId: opts.learner.organizationId,
    family: { id: 'family-1', contacts: [], ...opts.learner.family },
  };
  const write = async () => {
    state.writes += 1;
    return { id: 'conv-new' };
  };
  const prisma = {
    // PD-8: the learner's supervisor is admin-1.
    learnerSupervision: { findUnique: async () => ({ supervisorId: 'admin-1' }) },
    learner: {
      findUnique: async () => {
        state.learnerLookups += 1;
        return learnerRow;
      },
    },
    conversation: {
      findFirst: async () => (opts.existingGroup ? { id: 'conv-existing' } : null),
      create: write,
      update: write,
    },
    conversationMember: { findMany: async () => [], createMany: write, updateMany: write },
    message: { create: write },
    // PD-35: the reconcile asks which members hold a seat (none here).
    $queryRaw: async () => [],
    $transaction: async () => write(),
  };
  const identity = { resolveActor: async (id: string) => opts.actors[id] ?? null };
  const service = new ConversationService(
    prisma as never,
    authz,
    {} as never,
    identity as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    get learnerLookups() {
      return state.learnerLookups;
    },
    get writes() {
      return state.writes;
    },
  };
}

const sameOrgLearner = { organizationId: ORG, family: { organizationId: ORG, ownerId: 'admin-1' } };

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

describe('ConversationService.ensureStudentGroup', () => {
  it('refuses a parent BEFORE looking the learner up, identically for a real and an unknown id', async () => {
    const real = stubService({ actors: { p: parent('p') }, learner: sameOrgLearner });
    const fake = stubService({ actors: { p: parent('p') }, learner: null });

    const a = await refusal(real.service.ensureStudentGroup('learner-1', 'p'));
    const b = await refusal(fake.service.ensureStudentGroup('no-such-learner', 'p'));

    expect([a.code, a.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect([b.code, b.status]).toEqual([a.code, a.status]);
    expect(a.message).toBe(b.message);
    expect(real.learnerLookups).toBe(0);
    expect(fake.learnerLookups).toBe(0);
    expect(real.writes + fake.writes).toBe(0);
  });

  it('refuses a teacher before the lookup, with no writes', async () => {
    const s = stubService({ actors: { t: teacher('t') }, learner: sameOrgLearner });
    const e = await refusal(s.service.ensureStudentGroup('learner-1', 't'));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(s.learnerLookups).toBe(0);
    expect(s.writes).toBe(0);
  });

  it('refuses an admin who is not the supervisor (403), with no writes', async () => {
    const s = stubService({ actors: { a2: admin('a2') }, learner: sameOrgLearner });
    const e = await refusal(s.service.ensureStudentGroup('learner-1', 'a2'));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(s.writes).toBe(0);
  });

  it("answers another organization's learner exactly like an unknown one (404), with no writes", async () => {
    const crossTenant = stubService({
      actors: { m: manager('m') },
      learner: { organizationId: OTHER_ORG, family: { organizationId: OTHER_ORG, ownerId: 'x' } },
    });
    const unknown = stubService({ actors: { m: manager('m') }, learner: null });

    const a = await refusal(crossTenant.service.ensureStudentGroup('learner-1', 'm'));
    const b = await refusal(unknown.service.ensureStudentGroup('learner-1', 'm'));

    expect([a.code, a.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
    expect([b.code, b.status]).toEqual([a.code, a.status]);
    expect(a.message).toBe(b.message);
    expect(crossTenant.writes).toBe(0);
  });

  it('does not reveal an existing group to a refused caller', async () => {
    const s = stubService({ actors: { a2: admin('a2') }, learner: sameOrgLearner, existingGroup: true });
    const e = await refusal(s.service.ensureStudentGroup('learner-1', 'a2'));
    expect(e.code).toBe(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
  });

  it("lets the learner's supervisor through to the existing group", async () => {
    const s = stubService({ actors: { 'admin-1': admin('admin-1') }, learner: sameOrgLearner, existingGroup: true });
    await expect(s.service.ensureStudentGroup('learner-1', 'admin-1')).resolves.toEqual({ id: 'conv-existing' });
    expect(s.writes).toBe(0);
  });

  it("lets the supervisor's department manager create the group", async () => {
    const s = stubService({ actors: { m: manager('m') }, learner: sameOrgLearner });
    await expect(s.service.ensureStudentGroup('learner-1', 'm')).resolves.toBeDefined();
    expect(s.writes).toBeGreaterThan(0);
  });

  it('an omitted actor is SYSTEM (the Core-ingestion seam), not a skipped check', async () => {
    const s = stubService({ actors: {}, learner: sameOrgLearner, existingGroup: true });
    await expect(s.service.ensureStudentGroup('learner-1')).resolves.toEqual({ id: 'conv-existing' });
  });

  it('an unknown actor id is refused as unknown, before the lookup', async () => {
    const s = stubService({ actors: {}, learner: sameOrgLearner });
    const e = await refusal(s.service.ensureStudentGroup('learner-1', 'ghost'));
    expect(e.code).toBe(CommErrorCode.UNKNOWN_ACTOR);
    expect(s.learnerLookups).toBe(0);
  });
});

describe('ConversationService.syncStudentGroup', () => {
  it('refuses a parent before the lookup, with no writes', async () => {
    const s = stubService({ actors: { p: parent('p') }, learner: sameOrgLearner, existingGroup: true });
    const e = await refusal(s.service.syncStudentGroup('learner-1', 'p'));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(s.learnerLookups).toBe(0);
    expect(s.writes).toBe(0);
  });

  it('refuses a teacher before the lookup', async () => {
    const s = stubService({ actors: { t: teacher('t') }, learner: sameOrgLearner, existingGroup: true });
    const e = await refusal(s.service.syncStudentGroup('learner-1', 't'));
    expect(e.code).toBe(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    expect(s.learnerLookups).toBe(0);
  });

  it('refuses an admin who is not the supervisor, with no writes', async () => {
    const s = stubService({ actors: { a2: admin('a2') }, learner: sameOrgLearner, existingGroup: true });
    const e = await refusal(s.service.syncStudentGroup('learner-1', 'a2'));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(s.writes).toBe(0);
  });

  it("answers another organization's learner as `{synced:false}` would an unknown one (null)", async () => {
    const s = stubService({
      actors: { m: manager('m') },
      learner: { organizationId: OTHER_ORG, family: { organizationId: OTHER_ORG, ownerId: 'x' } },
      existingGroup: true,
    });
    await expect(s.service.syncStudentGroup('learner-1', 'm')).resolves.toBeNull();
    expect(s.writes).toBe(0);
  });

  it("lets the learner's supervisor reconcile", async () => {
    // The stub group has no live members, so the owner is missing from it and
    // the reconcile writes -- which is the point: it got past the gate.
    const s = stubService({ actors: { 'admin-1': admin('admin-1') }, learner: sameOrgLearner, existingGroup: true });
    await expect(s.service.syncStudentGroup('learner-1', 'admin-1')).resolves.toBeDefined();
    expect(s.writes).toBeGreaterThan(0);
  });
});
