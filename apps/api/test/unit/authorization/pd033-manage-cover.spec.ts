/**
 * PD-33: who may start, extend and end a supervisor's cover
 * (AuthorizationService.canManageCover). The supervisor themself, the manager
 * of their department and the super admin start and extend; the covering
 * backup may only END; a backup's 'backup' basis never counts as authority over
 * the arrangement. The SQL facts (actsFor) are resolved by the caller; the
 * end-to-end rules are in test/integration/supervisor-cover-pd033*.spec.ts.
 */
import { CommErrorCode } from '@platform/errors';
import type { ActsFor } from '@platform/staff-scope';
import { admin, authzWithScope, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithScope();
const target = (actsForPrimary: ActsFor, isCoveringBackup = false) => ({ organizationId: 'org-1', actsForPrimary, isCoveringBackup });

describe('PD-33 canManageCover', () => {
  it.each(['start', 'extend', 'end'] as const)('%s: the supervisor themself, their manager, the super admin', (action) => {
    expect(authz.canManageCover(admin('sup-1'), target('self'), action).allowed).toBe(true);
    expect(authz.canManageCover(manager(), target('manager'), action).allowed).toBe(true);
    expect(authz.canManageCover(admin('owner', 'super_admin'), target(null), action).allowed).toBe(true);
  });

  it('the covering backup may end it, and only end it', () => {
    const backup = admin('bk-1', 'coverage');
    expect(authz.canManageCover(backup, target('backup', true), 'end').allowed).toBe(true);
    for (const action of ['start', 'extend'] as const) {
      expect(authz.canManageCover(backup, target('backup', true), action)).toMatchObject({
        allowed: false,
        code: CommErrorCode.ORG_STRUCTURE_DENIED,
      });
    }
  });

  it('nobody else: a colleague, another department\'s manager, a backup who is not covering, families and teachers', () => {
    for (const [actor, acts] of [
      [admin('sup-2'), null],
      [manager('mgr-teachers'), null],
      [admin('bk-2', 'coverage'), 'backup'],
      [admin('fin-1', 'finance'), null],
    ] as const) {
      for (const action of ['start', 'extend', 'end'] as const) {
        expect(authz.canManageCover(actor, target(acts), action).allowed).toBe(false);
      }
    }
    expect(authz.canManageCover(parent(), target(null), 'end').allowed).toBe(false);
    expect(authz.canManageCover(teacher(), target(null), 'end').allowed).toBe(false);
  });

  it('a manager acting for themself is not a supervisor handing over', () => {
    expect(authz.canManageCover(manager(), target('self'), 'start').allowed).toBe(false);
  });

  it('another organization and an inactive actor are refused', () => {
    expect(authz.canManageCover(admin('owner', 'super_admin'), { ...target(null), organizationId: 'org-2' }, 'start').allowed).toBe(false);
    expect(authz.canManageCover({ ...admin('sup-1'), isActive: false }, target('self'), 'start')).toMatchObject({
      allowed: false,
      code: CommErrorCode.ACTOR_INACTIVE,
    });
  });
});
