/**
 * RT-030 -- the tenant rules that make correct organization attribution safe.
 *
 * Correcting where a direct conversation or a message is FILED would, on its
 * own, turn writes the database used to refuse (default tenant vs the target's)
 * into writes it accepts. These two rules are what keep a cross-organization
 * write refused once the attribution is right. Pure: no database.
 */
import { CommErrorCode } from '@platform/errors';
import { SYSTEM_ACTOR, type Actor } from '@platform/types';
import { admin, authzWithOnDuty, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const inOrg = <T extends Actor>(a: T, organizationId: string | undefined): T => ({ ...a, organizationId });

describe('canOpenDirect -- both participants must share one organization', () => {
  it('same organization: the existing matrix is unchanged (parent<->admin allowed)', () => {
    expect(authz.canOpenDirect(parent(), admin()).allowed).toBe(true);
  });

  it('a cross-organization pair is refused as an UNKNOWN actor, for every kind of pair', () => {
    const pairs: [Actor, Actor][] = [
      [admin(), inOrg(parent(), 'org-2')],
      [inOrg(parent(), 'org-2'), admin()],
      [manager(), inOrg(teacher(), 'org-2')],
    ];
    for (const [a, b] of pairs) {
      const d = authz.canOpenDirect(a, b);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect([d.code, d.reason]).toEqual([CommErrorCode.UNKNOWN_ACTOR, 'unknown actor']);
    }
  });

  it('the tenant is checked before activity, so an inactive foreign actor is not distinguishable', () => {
    const d = authz.canOpenDirect(admin(), { ...inOrg(parent(), 'org-2'), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.UNKNOWN_ACTOR);
  });

  it('SYSTEM can never be a direct participant (it belongs to no organization)', () => {
    for (const [a, b] of [[admin(), SYSTEM_ACTOR], [SYSTEM_ACTOR, admin()]] as [Actor, Actor][]) {
      const d = authz.canOpenDirect(a, b);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.UNKNOWN_ACTOR);
    }
  });

  it('an actor with no organization fails closed even against another such actor', () => {
    const d = authz.canOpenDirect(inOrg(admin(), undefined), inOrg(parent(), undefined));
    expect(d.allowed).toBe(false);
  });
});

describe('canActInOrganization -- a write into a conversation needs its organization', () => {
  it('a member of the organization may act in it', () => {
    for (const a of [parent(), teacher(), admin(), manager()]) {
      expect(authz.canActInOrganization(a, 'org-1').allowed).toBe(true);
    }
  });

  it("another organization's conversation reads as NOT FOUND, even to a manager", () => {
    for (const a of [parent(), teacher(), admin(), manager()]) {
      const d = authz.canActInOrganization(a, 'org-2');
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect([d.code, d.reason]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found']);
    }
  });

  it('an actor with no organization is refused', () => {
    expect(authz.canActInOrganization(inOrg(manager(), undefined), 'org-1').allowed).toBe(false);
  });

  it('SYSTEM acts for every organization (automation; unreachable over HTTP)', () => {
    expect(authz.canActInOrganization(SYSTEM_ACTOR, 'org-2').allowed).toBe(true);
  });
});
