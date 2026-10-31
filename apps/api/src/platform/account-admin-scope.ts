import type { Prisma } from '@prisma/client';
import type { PrismaService } from './prisma.service';
import { TeacherScopeService, scopeCovers } from './teacher-scope';
import type { Actor } from './types';

/**
 * TEACHER-011: account administration narrowed by the ACCOUNT -- after
 * canAdministerAccount, which decides only by department and role.
 *
 *   teacher  the caller's PD-35 teacher scope (TeacherScopeService.scopeOf),
 *            exactly as every other teacher route: the strict switch off,
 *            every teacher; on, the Teachers Manager and the super admin
 *            every teacher, a supervisor their own (and, while a backup link
 *            is active, the primary's).
 *   family   nothing here yet: the parent-side scope (ADMIN-002, the owner's
 *            decision) plugs in as its own case. Sales' 'own' switch stays
 *            where it is (AccountAdminService.requireOwnedFamily).
 *   staff    nothing: the super admin and a department manager's own rules.
 *
 * One rule for the Accounts list and its allowed{} flags, every act,
 * impersonation's start and its per-request re-decision.
 */
export class AccountAdminScope {
  private readonly teachers: TeacherScopeService;

  constructor(prisma: PrismaService) {
    this.teachers = new TeacherScopeService(prisma);
  }

  /** May `actor` administer this account at all, given its kind? */
  async covers(actor: Actor, target: { kind: string; teacherId?: string | null }): Promise<boolean> {
    if (target.kind !== 'teacher') return true;
    return scopeCovers(await this.teachers.scopeOf(actor), target.teacherId ?? null);
  }

  /** The same rule as a filter on chat.account, for the Accounts list. */
  async listFilter(actor: Actor): Promise<Prisma.AccountWhereInput> {
    const scope = await this.teachers.scopeOf(actor);
    if (scope.all) return {};
    return { OR: [{ kind: { not: 'teacher' } }, { teacher: { id: { in: [...scope.teacherIds] } } }] };
  }
}
