/**
 * RBAC: role defaults, per-account overrides, and the precedence between them.
 *
 * The permission table lives in the database (chat.role_permission); this suite
 * exercises the TypeScript mirror and the ONE function that resolves an
 * effective permission set. test/integration/rbac-mirror.spec.ts proves the
 * mirror equals the table, so a rule proved here is a rule the database agrees
 * with.
 */
import {
  ALL_PERMISSIONS,
  AuthzRole,
  OverrideEffect,
  Permission,
  resolveEffectivePermissions,
  ROLE_PERMISSIONS,
} from '@platform/rbac/permissions';
import { AuthorizationService } from '@platform/authorization.service';
import { actorHasPermission } from '@platform/types';
import { admin, authzWithOnDuty, coverageAdmin, manager, parent, superAdmin, teacher } from '../../support/fixtures';

const NEVER_EXPIRES = null;

describe('role defaults', () => {
  it('every role maps only to permissions that exist in the vocabulary', () => {
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      for (const key of keys) {
        expect({ role, key, known: ALL_PERMISSIONS.includes(key) }).toEqual({
          role,
          key,
          known: true,
        });
      }
    }
  });

  it('grants a parent the keys the model says, and refuses the rest', () => {
    const held = resolveEffectivePermissions(AuthzRole.PARENT);
    expect(held.has(Permission.MESSAGES_SEND)).toBe(true);
    expect(held.has(Permission.CONVERSATIONS_READ)).toBe(true);
    expect(held.has(Permission.MESSAGES_INTERNAL)).toBe(false);
    expect(held.has(Permission.MESSAGES_MODERATE)).toBe(false);
    expect(held.has(Permission.USERS_MANAGE)).toBe(false);
  });

  it('a teacher never holds internal notes or moderation', () => {
    const held = resolveEffectivePermissions(AuthzRole.TEACHER);
    expect(held.has(Permission.MESSAGES_INTERNAL)).toBe(false);
    expect(held.has(Permission.MESSAGES_MODERATE)).toBe(false);
  });

  it('admin and coverage_admin hold exactly the same keys -- they differ only in scope', () => {
    expect([...resolveEffectivePermissions(AuthzRole.ADMIN)].sort()).toEqual(
      [...resolveEffectivePermissions(AuthzRole.COVERAGE_ADMIN)].sort(),
    );
  });

  it('a manager may assign supervisors and read audit; an admin may not', () => {
    const mgr = resolveEffectivePermissions(AuthzRole.MANAGER);
    const adm = resolveEffectivePermissions(AuthzRole.ADMIN);
    expect(mgr.has(Permission.FAMILIES_ASSIGN)).toBe(true);
    expect(mgr.has(Permission.AUDIT_READ)).toBe(true);
    expect(adm.has(Permission.FAMILIES_ASSIGN)).toBe(false);
    expect(adm.has(Permission.AUDIT_READ)).toBe(false);
  });

  it('only super_admin manages users, and it holds everything a manager holds', () => {
    const sup = resolveEffectivePermissions(AuthzRole.SUPER_ADMIN);
    const mgr = resolveEffectivePermissions(AuthzRole.MANAGER);
    expect(sup.has(Permission.USERS_MANAGE)).toBe(true);
    expect(mgr.has(Permission.USERS_MANAGE)).toBe(false);
    for (const key of mgr) expect(sup.has(key)).toBe(true);
  });

  it('an unknown role holds nothing at all, rather than defaulting to something', () => {
    expect(resolveEffectivePermissions('director-of-vibes').size).toBe(0);
    expect(resolveEffectivePermissions(null).size).toBe(0);
  });
});

describe('per-account overrides and their precedence', () => {
  it('an ALLOW grants a permission the role does not', () => {
    const held = resolveEffectivePermissions(AuthzRole.ADMIN, [
      { permission: Permission.AUDIT_READ, effect: OverrideEffect.ALLOW, expiresAt: NEVER_EXPIRES },
    ]);
    expect(held.has(Permission.AUDIT_READ)).toBe(true);
  });

  it('a DENY removes a permission the role DOES grant -- the whole point', () => {
    const held = resolveEffectivePermissions(AuthzRole.ADMIN, [
      { permission: Permission.MESSAGES_SEND, effect: OverrideEffect.DENY, expiresAt: NEVER_EXPIRES },
    ]);
    expect(held.has(Permission.MESSAGES_SEND)).toBe(false);
    // and nothing else moved
    expect(held.has(Permission.MESSAGES_READ)).toBe(true);
  });

  it('DENY beats ALLOW for the same key, in either order', () => {
    const forward = resolveEffectivePermissions(AuthzRole.ADMIN, [
      { permission: Permission.AUDIT_READ, effect: OverrideEffect.ALLOW },
      { permission: Permission.AUDIT_READ, effect: OverrideEffect.DENY },
    ]);
    const reverse = resolveEffectivePermissions(AuthzRole.ADMIN, [
      { permission: Permission.AUDIT_READ, effect: OverrideEffect.DENY },
      { permission: Permission.AUDIT_READ, effect: OverrideEffect.ALLOW },
    ]);
    expect(forward.has(Permission.AUDIT_READ)).toBe(false);
    expect(reverse.has(Permission.AUDIT_READ)).toBe(false);
  });

  it('a DENY applies to a super_admin too: no role is above the override', () => {
    const held = resolveEffectivePermissions(AuthzRole.SUPER_ADMIN, [
      { permission: Permission.USERS_MANAGE, effect: OverrideEffect.DENY },
    ]);
    expect(held.has(Permission.USERS_MANAGE)).toBe(false);
  });

  it('an expired override is not an override -- the role default returns', () => {
    const past = new Date(Date.now() - 60_000);
    const denied = resolveEffectivePermissions(
      AuthzRole.ADMIN,
      [{ permission: Permission.MESSAGES_SEND, effect: OverrideEffect.DENY, expiresAt: past }],
      new Date(),
    );
    const allowed = resolveEffectivePermissions(
      AuthzRole.ADMIN,
      [{ permission: Permission.AUDIT_READ, effect: OverrideEffect.ALLOW, expiresAt: past }],
      new Date(),
    );
    expect(denied.has(Permission.MESSAGES_SEND)).toBe(true);
    expect(allowed.has(Permission.AUDIT_READ)).toBe(false);
  });

  it('an override that has not yet expired still applies', () => {
    const future = new Date(Date.now() + 60_000);
    const held = resolveEffectivePermissions(AuthzRole.ADMIN, [
      { permission: Permission.MESSAGES_SEND, effect: OverrideEffect.DENY, expiresAt: future },
    ]);
    expect(held.has(Permission.MESSAGES_SEND)).toBe(false);
  });
});

describe('AuthorizationService.can()', () => {
  const authz: AuthorizationService = authzWithOnDuty(null);

  it('answers from the actor\'s effective set, not from the role name', () => {
    const a = admin('a1');
    expect(authz.can(a, Permission.MESSAGES_INTERNAL).allowed).toBe(true);
    expect(authz.can(a, Permission.USERS_MANAGE).allowed).toBe(false);
    expect(authz.can(superAdmin(), Permission.USERS_MANAGE).allowed).toBe(true);
  });

  it('refuses an inactive actor every permission it would otherwise hold', () => {
    const gone = { ...superAdmin(), isActive: false };
    for (const key of ALL_PERMISSIONS) {
      expect({ key, allowed: authz.can(gone, key).allowed }).toEqual({ key, allowed: false });
    }
  });

  it('an actor whose permissions were never resolved holds nothing', () => {
    const unresolved = { ...manager(), permissions: undefined };
    expect(actorHasPermission(unresolved, Permission.MESSAGES_SEND)).toBe(false);
    expect(authz.can(unresolved, Permission.MESSAGES_SEND).allowed).toBe(false);
  });

  it('reports a refusal as PERMISSION_DENIED and names the key', () => {
    const d = authz.can(parent(), Permission.USERS_MANAGE);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('COMM.PERMISSION_DENIED');
      expect(d.reason).toContain(Permission.USERS_MANAGE);
    }
  });

  it('covers every role in the model', () => {
    const roles = [parent(), teacher(), admin(), coverageAdmin(), manager(), superAdmin()];
    for (const actor of roles) {
      expect(authz.can(actor, Permission.SESSIONS_MANAGE).allowed).toBe(true);
    }
    expect(authz.can(parent(), Permission.MESSAGES_MODERATE).allowed).toBe(false);
    expect(authz.can(teacher(), Permission.MESSAGES_MODERATE).allowed).toBe(false);
    expect(authz.can(admin(), Permission.MESSAGES_MODERATE).allowed).toBe(true);
    expect(authz.can(coverageAdmin(), Permission.MESSAGES_MODERATE).allowed).toBe(true);
    expect(authz.can(manager(), Permission.MESSAGES_MODERATE).allowed).toBe(true);
    expect(authz.can(superAdmin(), Permission.MESSAGES_MODERATE).allowed).toBe(true);
  });
});
