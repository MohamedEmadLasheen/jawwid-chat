/**
 * C1 -- the central conversation-read policy, as a pure decision table.
 *
 * AuthorizationService.canRead with resolved StaffScopeFacts (approved
 * 2026-10-14): organization first (another organization's conversation is NOT
 * FOUND, 404), then status, then role, then scope -- manager: organization;
 * any staff: live membership; admin: owned family; admin and coverage: the
 * active handler (interim, PD-3 routing). Parents and teachers: live membership.
 *
 * The second half pins the TRANSITIONAL path: with UNSCOPED_LEGACY_READ (the
 * default) the decision is exactly the pre-scope one, so no un-migrated caller
 * changes behaviour in C1.
 */
import { CommErrorCode } from '@platform/errors';
import { SYSTEM_ACTOR, type Actor } from '@platform/types';
import {
  UNSCOPED_LEGACY_READ,
  type Decision,
  type StaffScopeFacts,
} from '@platform/authorization.service';
import {
  admin,
  academicStaff,
  authzWithOnDuty,
  conversation,
  financeStaff,
  manager,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const conv = (over: Parameters<typeof conversation>[0] = {}) =>
  conversation({ organizationId: ORG, familyId: 'family-1', ...over });
const NO_FACTS: StaffScopeFacts = { familyOwnerId: null, activeHandlerId: null };
const facts = (over: Partial<StaffScopeFacts> = {}): StaffScopeFacts => ({ ...NO_FACTS, ...over });

const coverage = (id = 'coverage-1') => admin(id, 'coverage');
const superAdmin = (id = 'super-1') => admin(id, 'super_admin');
const inOrg = (a: Actor, organizationId: string | undefined): Actor => ({ ...a, organizationId });
const inactive = (a: Actor): Actor => ({ ...a, isActive: false });

function expectAllowed(d: Decision) {
  expect(d).toMatchObject({ allowed: true });
}
function expectDenied(d: Decision, code: CommErrorCode, status?: 404) {
  expect(d.allowed).toBe(false);
  if (d.allowed) return;
  expect(d.code).toBe(code);
  expect(d.status).toBe(status);
}

// ===========================================================================
describe('organization first: another organization reads as NOT FOUND (404)', () => {
  const foreign = conv({ organizationId: OTHER_ORG });

  it.each([
    ['manager', manager()],
    ['admin who owns the family', admin('owner-1')],
    ['admin who is the active handler', admin('handler-1')],
    ['coverage', coverage()],
    ['parent', parent()],
    ['teacher', teacher()],
  ])('%s, even holding every scope fact and a membership row', (_n, actor) => {
    const d = authz.canRead(
      actor,
      foreign,
      member(actor),
      facts({ familyOwnerId: actor.actorId, activeHandlerId: actor.actorId }),
    );
    expectDenied(d, CommErrorCode.CONVERSATION_NOT_FOUND, 404);
    if (!d.allowed) expect(d.reason).toBe('conversation not found');
  });

  it('an INACTIVE foreign actor learns nothing either: not found, not "inactive"', () => {
    expectDenied(
      authz.canRead(inactive(manager()), conv({ organizationId: OTHER_ORG }), null, NO_FACTS),
      CommErrorCode.CONVERSATION_NOT_FOUND,
      404,
    );
  });

  it('a conversation with no proven organization fails closed', () => {
    expectDenied(
      authz.canRead(manager(), conv({ organizationId: undefined }), null, NO_FACTS),
      CommErrorCode.CONVERSATION_NOT_FOUND,
      404,
    );
  });

  it('an actor with no organization fails closed', () => {
    expectDenied(
      authz.canRead(inOrg(manager(), undefined), conv(), null, NO_FACTS),
      CommErrorCode.CONVERSATION_NOT_FOUND,
      404,
    );
  });

  it('SYSTEM (automation; not reachable over HTTP) is not subject to the boundary', () => {
    expectAllowed(authz.canRead(SYSTEM_ACTOR, conv({ organizationId: OTHER_ORG }), null, NO_FACTS));
  });
});

// ===========================================================================
describe('status and role inside the organization', () => {
  it('an inactive actor in the same organization is refused as inactive (403)', () => {
    expectDenied(authz.canRead(inactive(manager()), conv(), null, NO_FACTS), CommErrorCode.ACTOR_INACTIVE);
  });

  it.each([
    ['super_admin', superAdmin()],
    ['finance', financeStaff()],
    ['academic', academicStaff()],
  ])('%s has no family-facing read by role, whatever the facts', (_n, actor) => {
    expectDenied(
      authz.canRead(
        actor,
        conv(),
        member(actor),
        facts({ familyOwnerId: actor.actorId, activeHandlerId: actor.actorId }),
      ),
      CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
    );
  });
});

// ===========================================================================
describe('staff scope', () => {
  it('a manager reads every conversation of their organization, with no facts', () => {
    expectAllowed(authz.canRead(manager(), conv(), null, NO_FACTS));
    expectAllowed(authz.canRead(manager(), conv({ familyId: null }), null, NO_FACTS));
  });

  it('any family-facing staff reads a conversation they are a live member of', () => {
    for (const a of [admin('a-1'), coverage('c-1')]) {
      expectAllowed(authz.canRead(a, conv(), member(a), NO_FACTS));
      expectAllowed(authz.canRead(a, conv({ familyId: null }), member(a), NO_FACTS));
    }
  });

  it('a member who has LEFT is not a member', () => {
    const a = admin('a-1');
    expectDenied(
      authz.canRead(a, conv(), member(a, { leftAt: new Date() }), NO_FACTS),
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
  });

  it('an admin reads a conversation of a family they own', () => {
    expectAllowed(authz.canRead(admin('owner-1'), conv(), null, facts({ familyOwnerId: 'owner-1' })));
  });

  it('ownership needs a family: a family-less conversation grants nothing by ownership', () => {
    expectDenied(
      authz.canRead(admin('owner-1'), conv({ familyId: null }), null, facts({ familyOwnerId: 'owner-1' })),
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
  });

  it('U2: a COVERAGE actor recorded as owner gains nothing from ownership', () => {
    expectDenied(
      authz.canRead(coverage('cov-owner'), conv(), null, facts({ familyOwnerId: 'cov-owner' })),
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
  });

  it('interim: the active handler (admin or coverage) reads that conversation', () => {
    expectAllowed(authz.canRead(admin('h-1'), conv(), null, facts({ activeHandlerId: 'h-1' })));
    expectAllowed(authz.canRead(coverage('h-2'), conv(), null, facts({ activeHandlerId: 'h-2' })));
    expectAllowed(
      authz.canRead(admin('h-3'), conv({ familyId: null }), null, facts({ activeHandlerId: 'h-3' })),
    );
  });

  it('somebody ELSE being the handler or owner grants nothing', () => {
    expectDenied(
      authz.canRead(
        admin('unrelated'),
        conv(),
        null,
        facts({ familyOwnerId: 'owner-1', activeHandlerId: 'handler-1' }),
      ),
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
    expectDenied(
      authz.canRead(coverage('unrelated'), conv(), null, facts({ activeHandlerId: 'handler-1' })),
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
  });

  it('an out-of-scope refusal inside the organization is 403, never a 404', () => {
    const d = authz.canRead(admin('unrelated'), conv(), null, NO_FACTS);
    expectDenied(d, CommErrorCode.NOT_CONVERSATION_MEMBER);
  });
});

// ===========================================================================
describe('parents and teachers: live membership, unchanged (PD-6 is enforced on send and call)', () => {
  it.each([
    ['parent', parent()],
    ['teacher', teacher()],
  ])('%s reads as a live member and only as one -- staff facts never apply', (_n, a) => {
    expectAllowed(authz.canRead(a, conv(), member(a), NO_FACTS));
    expectDenied(
      authz.canRead(a, conv(), null, facts({ familyOwnerId: a.actorId, activeHandlerId: a.actorId })),
      CommErrorCode.NOT_CONVERSATION_MEMBER,
    );
  });

  it('a direct teacher<->parent conversation is readable by its members', () => {
    const c = conv({ type: 'direct' });
    expectAllowed(authz.canRead(teacher(), c, member(teacher()), NO_FACTS));
    expectAllowed(authz.canRead(parent(), c, member(parent()), NO_FACTS));
  });
});

// ===========================================================================
describe('which facts a decision needs (lazy resolution)', () => {
  const none = { familyOwner: false, activeHandler: false };
  it.each([
    ['parent', parent(), null],
    ['teacher', teacher(), null],
    ['manager', manager(), null],
    ['live member admin', admin('a-1'), member(admin('a-1'))],
    ['super_admin', superAdmin(), null],
    ['inactive admin', inactive(admin()), null],
  ])('%s needs none', (_n, a, m) => {
    expect(authz.readScopeFactsNeeded(a, conv(), m)).toEqual(none);
  });

  it('a foreign-organization admin needs none (refused before facts)', () => {
    expect(authz.readScopeFactsNeeded(admin(), conv({ organizationId: OTHER_ORG }), null)).toEqual(none);
  });

  it('a non-member admin needs the owner and the handler; coverage only the handler', () => {
    expect(authz.readScopeFactsNeeded(admin(), conv(), null)).toEqual({ familyOwner: true, activeHandler: true });
    expect(authz.readScopeFactsNeeded(coverage(), conv(), null)).toEqual({ familyOwner: false, activeHandler: true });
    expect(authz.readScopeFactsNeeded(admin(), conv({ familyId: null }), null)).toEqual({
      familyOwner: false,
      activeHandler: true,
    });
  });
});

// ===========================================================================
describe('NO FALLBACK: a malformed scope fails closed, it never becomes the legacy decision', () => {
  // The legacy decision ALLOWS an unrelated admin (and a foreign one). A scoped
  // caller with a bug must therefore get the opposite answer, not that one.
  const unrelated = admin('unrelated');
  const foreign = inOrg(admin('foreign'), OTHER_ORG);

  it.each([
    ['explicit undefined', undefined],
    ['null', null],
    ['empty object', {}],
    ['owner only', { familyOwnerId: null }],
    ['handler only', { activeHandlerId: null }],
    ['numeric id', { familyOwnerId: 1, activeHandlerId: null }],
    ['empty-string id', { familyOwnerId: '', activeHandlerId: null }],
    ['a string', 'facts'],
    ['another symbol', Symbol('UNSCOPED_LEGACY_READ')],
  ])('%s -> 404, for an actor the legacy path would allow', (_n, bad) => {
    for (const a of [unrelated, foreign, manager()]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (authz.canRead as any).call(authz, a, conv(), null, bad) as Decision;
      expectDenied(d, CommErrorCode.CONVERSATION_NOT_FOUND, 404);
    }
  });

  it('only the absent argument and the sentinel itself reach the legacy decision', () => {
    expect(authz.canRead(unrelated, conv(), null).allowed).toBe(true);
    expect(authz.canRead(unrelated, conv(), null, UNSCOPED_LEGACY_READ).allowed).toBe(true);
    expect(authz.canRead(unrelated, conv(), null, NO_FACTS).allowed).toBe(false);
  });
});

// ===========================================================================
describe('TRANSITIONAL: UNSCOPED_LEGACY_READ is exactly the pre-scope decision', () => {
  /** The pre-C1 rule, restated independently so the comparison means something. */
  function preScope(actor: Actor, membership: ReturnType<typeof member> | null): boolean | CommErrorCode {
    if (!actor.isActive) return CommErrorCode.ACTOR_INACTIVE;
    if (actor.kind === 'system') return true;
    if (actor.kind === 'staff') {
      return ['admin', 'coverage', 'manager'].includes(actor.staffRole ?? '')
        ? true
        : CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY;
    }
    return membership && membership.leftAt === null ? true : CommErrorCode.NOT_CONVERSATION_MEMBER;
  }

  const actors: Actor[] = [
    manager(), admin(), coverage(), superAdmin(), financeStaff(), academicStaff(),
    parent(), teacher(), inactive(admin()), inactive(parent()), SYSTEM_ACTOR,
    inOrg(admin(), OTHER_ORG), inOrg(parent(), OTHER_ORG),
  ];
  const convs = [conv(), conv({ familyId: null }), conv({ organizationId: OTHER_ORG }), studentGroup({ organizationId: ORG })];

  it('agrees with the pre-scope rule for every actor, conversation and membership, by default and explicitly', () => {
    let cases = 0;
    for (const a of actors) {
      for (const c of convs) {
        for (const m of [null, member(a), member(a, { leftAt: new Date() })]) {
          const expected = preScope(a, m);
          for (const d of [authz.canRead(a, c, m), authz.canRead(a, c, m, UNSCOPED_LEGACY_READ)]) {
            if (expected === true) expect(d.allowed).toBe(true);
            else {
              expect(d).toMatchObject({ allowed: false, code: expected });
              if (!d.allowed) expect(d.status).toBeUndefined();
            }
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(actors.length * convs.length * 3 * 2);
  });

  it('...including the known defect it preserves: cross-organization staff are allowed (removed in C4)', () => {
    expect(authz.canRead(admin(), conv({ organizationId: OTHER_ORG }), null).allowed).toBe(true);
  });
});
