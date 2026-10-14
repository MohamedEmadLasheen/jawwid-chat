/**
 * Staff scope (2026-10-14).
 *
 * Family-facing staff used to read EVERY conversation in the database. They
 * now read only what the academy's own records put in their charge:
 *
 *   manager           every conversation of their organization;
 *   admin / coverage  conversations they are a live member of, plus those of
 *                     families they own, are on duty for, or are the live
 *                     sticky handler of (`staffInScope`, a resolved fact).
 *
 * Another organization's conversation reads as not found, for every role.
 */
import { CommErrorCode } from '@platform/errors';
import {
  academicStaff,
  admin,
  authzWithOnDuty,
  conversation,
  manager,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const NOW = new Date('2026-10-14T10:00:00Z');

const code = (d: { allowed: boolean; code?: string }) => (d.allowed ? 'ALLOW' : d.code);

describe('canRead — staff scope', () => {
  const authz = authzWithOnDuty();

  it('an admin with no tie to the family is refused, by name', () => {
    expect(code(authz.canRead(admin('outsider'), studentGroup(), null))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });

  it('an admin is admitted by live membership', () => {
    const a = admin('member-admin');
    expect(code(authz.canRead(a, studentGroup(), member(a)))).toBe('ALLOW');
  });

  it('a DEPARTED admin member is refused unless the scope fact says otherwise', () => {
    const a = admin('gone');
    const gone = member(a, { leftAt: new Date('2026-10-01T00:00:00Z') });
    expect(code(authz.canRead(a, studentGroup(), gone))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect(code(authz.canRead(a, studentGroup(), gone, true))).toBe('ALLOW');
  });

  it('an admin is admitted by the resolved scope fact', () => {
    expect(code(authz.canRead(admin('owner'), studentGroup(), null, true))).toBe('ALLOW');
  });

  it('coverage admins follow the same rule as admins', () => {
    const c = admin('cov', 'coverage');
    expect(code(authz.canRead(c, studentGroup(), null))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect(code(authz.canRead(c, studentGroup(), null, true))).toBe('ALLOW');
  });

  it('a manager reads every conversation of their organization without membership or fact', () => {
    expect(code(authz.canRead(manager(), studentGroup(), null))).toBe('ALLOW');
    expect(code(authz.canRead(manager(), conversation({ familyId: null }), null))).toBe('ALLOW');
  });

  it('another organization reads as NOT FOUND, for a manager, a member and an in-scope admin alike', () => {
    const foreign = studentGroup({ organizationId: 'org-2' });
    expect(code(authz.canRead(manager(), foreign, null))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    const a = admin('a');
    expect(code(authz.canRead(a, foreign, member(a), true))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('department staff are refused whatever the fact says', () => {
    expect(code(authz.canRead(academicStaff(), studentGroup(), null, true))).toBe(
      CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
    );
  });

  it('the fact means nothing for a parent or a teacher: membership alone decides', () => {
    expect(code(authz.canRead(parent(), studentGroup(), null, true))).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    expect(code(authz.canRead(teacher(), studentGroup(), null, true))).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('the fact defaults to FALSE: a call site that forgets it narrows, never widens', () => {
    expect(authz.canRead(admin('x'), studentGroup(), null).allowed).toBe(false);
  });
});

describe('staffInScope — the fact, from server-owned data', () => {
  const conv = studentGroup({ familyId: 'family-1' });

  it('the family OWNER is in scope', async () => {
    expect(await authzWithOnDuty(null).staffInScope(admin('own'), conv, 'own', NOW)).toBe(true);
  });

  it('whoever is ON DUTY for the family is in scope', async () => {
    expect(await authzWithOnDuty('cover').staffInScope(admin('cover', 'coverage'), conv, 'own', NOW)).toBe(true);
  });

  it('the LIVE sticky handler is in scope; an expired one is not', async () => {
    const live = studentGroup({ stickyHandlerId: 'sticky', stickyUntil: new Date('2026-10-14T10:05:00Z') });
    const stale = studentGroup({ stickyHandlerId: 'sticky', stickyUntil: new Date('2026-10-14T09:55:00Z') });
    expect(await authzWithOnDuty(null).staffInScope(admin('sticky'), live, 'own', NOW)).toBe(true);
    expect(await authzWithOnDuty(null).staffInScope(admin('sticky'), stale, 'own', NOW)).toBe(false);
  });

  it('an unrelated admin is not', async () => {
    expect(await authzWithOnDuty('cover').staffInScope(admin('other'), conv, 'own', NOW)).toBe(false);
  });

  it('with no family there is nothing to own or cover', async () => {
    expect(
      await authzWithOnDuty('x').staffInScope(admin('x'), conversation({ familyId: null }), 'x', NOW),
    ).toBe(false);
  });

  it('never true for anybody but active staff', async () => {
    expect(await authzWithOnDuty('parent-1').staffInScope(parent(), conv, 'parent-1', NOW)).toBe(false);
    expect(await authzWithOnDuty(null).staffInScope({ ...admin('own'), isActive: false }, conv, 'own', NOW)).toBe(false);
  });
});

describe('canSend resolves the fact itself (no caller can forget it)', () => {
  it('the on-duty admin may reply without being a member', async () => {
    const a = admin('duty');
    const d = await authzWithOnDuty('duty').canSend(a, conversation(), null, { visibility: 'customer' }, NOW, 'owner');
    expect(d.allowed).toBe(true);
  });

  it('an unrelated admin is refused before any duty rule runs', async () => {
    const d = await authzWithOnDuty('someone').canSend(
      admin('stranger'), conversation(), null, { visibility: 'customer' }, NOW, 'owner',
    );
    expect(code(d)).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });
});
