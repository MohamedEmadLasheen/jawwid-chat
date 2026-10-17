/**
 * Staff scope -- PD-8 (2026-10-15), superseding the 2026-10-14 rule.
 *
 * A staff member reads a conversation only on a BASIS returned by
 * chat.staff_conversation_access() (proven against a real database in
 * test/integration/org-scope-pd8.spec.ts and db/tests). Here the basis is
 * stubbed per staff id and what is asserted is the POLICY:
 *
 *   - canRead admits staff on the resolved fact ALONE: neither a manager role
 *     nor a membership row grants access on its own any more;
 *   - the fact defaults to false, so a forgotten resolution narrows;
 *   - another organization reads as not found, for every role;
 *   - the super admin takes part in conversations (owner decision 2026-10-15);
 *   - canSend resolves the basis itself and derives the attribution from it.
 */
import { CommErrorCode } from '@platform/errors';
import { StaffAccessBasis } from '@platform/staff-scope';
import {
  academicStaff,
  admin,
  authzWithScope,
  conversation,
  manager,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const NOW = new Date('2026-10-15T10:00:00Z');

const code = (d: { allowed: boolean; code?: string }) => (d.allowed ? 'ALLOW' : d.code);
const superAdmin = (id = 'super-1') => admin(id, 'super_admin');

describe('canRead — staff scope (PD-8)', () => {
  const authz = authzWithScope();

  it('an admin with no basis is refused, by name', () => {
    expect(code(authz.canRead(admin('outsider'), studentGroup(), null))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });

  it('a live membership row alone does NOT admit staff: a supervisor whose children moved away loses the room', () => {
    const a = admin('former-supervisor');
    expect(code(authz.canRead(a, studentGroup(), member(a)))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect(code(authz.canRead(a, studentGroup(), member(a), true))).toBe('ALLOW');
  });

  it('a manager role alone does NOT admit: a manager reads their department, through the resolved basis', () => {
    expect(code(authz.canRead(manager(), studentGroup(), null))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect(code(authz.canRead(manager(), studentGroup(), null, true))).toBe('ALLOW');
  });

  it('coverage admins follow the same rule as admins', () => {
    const c = admin('cov', 'coverage');
    expect(code(authz.canRead(c, studentGroup(), null))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect(code(authz.canRead(c, studentGroup(), null, true))).toBe('ALLOW');
  });

  it('the super admin takes part in conversations; access still arrives as the resolved basis', () => {
    expect(code(authz.canRead(superAdmin(), studentGroup(), null, true))).toBe('ALLOW');
    expect(code(authz.canRead(superAdmin(), studentGroup(), null))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });

  it('another organization reads as NOT FOUND, for a manager, a member, the super admin and an in-scope admin alike', () => {
    const foreign = studentGroup({ organizationId: 'org-2' });
    expect(code(authz.canRead(manager(), foreign, null, true))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    expect(code(authz.canRead(superAdmin(), foreign, null, true))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
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

describe('staffAccess / staffInScope — the basis, from the scope resolver', () => {
  const conv = studentGroup({ familyId: 'family-1' });
  const authz = authzWithScope({
    sup: StaffAccessBasis.RESPONSIBLE,
    bak: StaffAccessBasis.BACKUP,
    'manager-1': StaffAccessBasis.MANAGER,
  });

  it('returns the resolver basis for active staff of the conversation organization', async () => {
    expect(await authz.staffAccess(admin('sup'), conv, NOW)).toBe(StaffAccessBasis.RESPONSIBLE);
    expect(await authz.staffAccess(admin('bak', 'coverage'), conv, NOW)).toBe(StaffAccessBasis.BACKUP);
    expect(await authz.staffAccess(manager(), conv, NOW)).toBe(StaffAccessBasis.MANAGER);
    expect(await authz.staffInScope(admin('sup'), conv, null, NOW)).toBe(true);
  });

  it('an unrelated admin has no basis', async () => {
    expect(await authz.staffAccess(admin('other'), conv, NOW)).toBeNull();
    expect(await authz.staffInScope(admin('other'), conv, null, NOW)).toBe(false);
  });

  it('never a basis for a non-staff, an inactive or a foreign-organization actor -- the resolver is not even asked', async () => {
    expect(await authz.staffAccess(parent(), conv, NOW)).toBeNull();
    expect(await authz.staffAccess({ ...admin('sup'), isActive: false }, conv, NOW)).toBeNull();
    expect(await authz.staffAccess(admin('sup'), { ...conv, organizationId: 'org-2' }, NOW)).toBeNull();
    expect(await authz.staffAccess(academicStaff('sup'), conv, NOW)).toBeNull();
  });

  it('with no scope wired, nobody is in scope (fail closed)', async () => {
    expect(await authzWithScope().staffAccess(admin('sup'), conv, NOW)).toBeNull();
  });
});

describe('canSend resolves the basis itself (no caller can forget it)', () => {
  const authz = authzWithScope({
    sup: StaffAccessBasis.RESPONSIBLE,
    bak: StaffAccessBasis.BACKUP,
    'manager-1': StaffAccessBasis.MANAGER,
    'super-1': StaffAccessBasis.SUPER_ADMIN,
  });
  const send = (actor: ReturnType<typeof admin>, requestedMode?: string) =>
    authz.canSend(actor, conversation(), null, { visibility: 'customer', requestedMode }, NOW);

  it('the responsible supervisor replies as OWNER without being a member', async () => {
    const d = await send(admin('sup'));
    expect(d.allowed && d.onBehalfMode).toBe('owner');
  });

  it('an ACTIVE backup replies as COVERAGE', async () => {
    const d = await send(admin('bak', 'coverage'));
    expect(d.allowed && d.onBehalfMode).toBe('coverage');
  });

  it('a department manager and the super admin step in as ASSIST, or ESCALATION when they ask for it', async () => {
    expect(((await send(manager())) as { onBehalfMode: string }).onBehalfMode).toBe('assist');
    expect(((await send(manager(), 'escalation')) as { onBehalfMode: string }).onBehalfMode).toBe('escalation');
    expect(((await send(superAdmin())) as { onBehalfMode: string }).onBehalfMode).toBe('assist');
  });

  it('an unrelated admin is refused before anything else runs', async () => {
    expect(code(await send(admin('stranger')))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });

  it('a supervisor may not record their own reply as an assist or an escalation (JC-005)', async () => {
    expect(code(await send(admin('sup'), 'assist'))).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);
    expect(code(await send(admin('sup'), 'escalation'))).toBe(CommErrorCode.ESCALATION_NOT_PERMITTED);
  });
});
