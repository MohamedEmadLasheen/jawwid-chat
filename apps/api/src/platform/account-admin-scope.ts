import type { FamilyAccessGrant, Prisma } from '@prisma/client';
import { activeGrant } from '../account-admin/family-access.service';
import { StaffRole } from '../communication/contracts/vocab';
import { accountAdminStandingOf } from './account-admin-standing';
import type { PrismaService } from './prisma.service';
import { TeacherScopeService, scopeCovers } from './teacher-scope';
import type { Actor } from './types';

/** What a decision rested on: plain scope, or (ADMIN-002) a grant -- whose every use is logged. */
export interface AccountScopeDecision {
  allowed: boolean;
  grant?: FamilyAccessGrant;
}

/**
 * Account administration narrowed by the ACCOUNT -- after
 * canAdministerAccount, which decides only by department and role.
 *
 *   teacher  TEACHER-011: the caller's PD-35 teacher scope
 *            (TeacherScopeService.scopeOf), exactly as every other teacher
 *            route: the strict switch off, every teacher; on, the Teachers
 *            Manager and the super admin every teacher, a supervisor their
 *            own (and, while a backup link is active, the primary's).
 *   family   ADMIN-002 (owner decision 2026-10-31): an Operations member
 *            (supervisor, backup, cover staff) administers the parent
 *            accounts of the families they reach (chat.staff_reaches_family:
 *            their own, an active backup's, a cover's) -- or of ONE family an
 *            active grant opens to them (FamilyAccessService), whose use is
 *            then logged. The Operations Manager and the super admin stay
 *            organization-wide; Sales keeps its own rule
 *            (AccountAdminService.requireOwnedFamily).
 *   staff    nothing: the super admin and a department manager's own rules.
 *
 * One rule for the Accounts list and its allowed{} flags, every act,
 * impersonation's start and its per-request re-decision.
 */
export class AccountAdminScope {
  private readonly teachers: TeacherScopeService;

  constructor(private readonly prisma: PrismaService) {
    this.teachers = new TeacherScopeService(prisma);
  }

  /** May `actor` administer this account at all, given its kind? */
  async covers(actor: Actor, target: { kind: string; teacherId?: string | null; familyId?: string | null }): Promise<boolean> {
    return (await this.decide(actor, target)).allowed;
  }

  async decide(
    actor: Actor,
    target: { kind: string; teacherId?: string | null; familyId?: string | null },
  ): Promise<AccountScopeDecision> {
    if (target.kind === 'teacher') {
      return { allowed: scopeCovers(await this.teachers.scopeOf(actor), target.teacherId ?? null) };
    }
    if (target.kind === 'family') {
      if (!(await this.familyNarrowed(actor))) return { allowed: true };
      if (!target.familyId) return { allowed: false };
      const [{ reach }] = await this.prisma.$queryRaw<Array<{ reach: string | null }>>`
        SELECT chat.staff_reaches_family(${actor.actorId}::uuid, ${target.familyId}::uuid) AS reach`;
      if (reach !== null) return { allowed: true };
      const grant = await activeGrant(this.prisma, actor.actorId, target.familyId);
      return grant ? { allowed: true, grant } : { allowed: false };
    }
    return { allowed: true };
  }

  /**
   * The same rule as a filter on chat.account, for the Accounts list -- and
   * the families only a grant let in (family id -> grant id), so the list can
   * log each grant whose family it shows: viewing is a use too.
   */
  async listFilter(actor: Actor): Promise<{ where: Prisma.AccountWhereInput; grantedFamilies: Map<string, string> }> {
    const and: Prisma.AccountWhereInput[] = [];
    const grantedFamilies = new Map<string, string>();
    const scope = await this.teachers.scopeOf(actor);
    if (!scope.all) and.push({ OR: [{ kind: { not: 'teacher' } }, { teacher: { id: { in: [...scope.teacherIds] } } }] });
    if (await this.familyNarrowed(actor)) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; reached: boolean; grant_id: string | null }>>`
        SELECT x.id, x.reached, x.grant_id FROM (
          SELECT f.id::text AS id,
                 chat.staff_reaches_family(${actor.actorId}::uuid, f.id) IS NOT NULL AS reached,
                 chat.family_access_grant_active(${actor.actorId}::uuid, f.id)::text AS grant_id
            FROM chat.family f
           WHERE f.organization_id = ${actor.organizationId as string}::uuid) x
         WHERE x.reached OR x.grant_id IS NOT NULL`;
      for (const r of rows) if (!r.reached && r.grant_id) grantedFamilies.set(r.id, r.grant_id);
      and.push({ OR: [{ kind: { not: 'family' } }, { contacts: { some: { familyId: { in: rows.map((r) => r.id) } } } }] });
    }
    return { where: and.length ? { AND: and } : {}, grantedFamilies };
  }

  /**
   * Is this caller's parent-account administration narrowed to their families?
   * Only when an Operations role is what lets them administer parents: an
   * Operations member in an Operations role (supervisor, backup: admin;
   * cover staff: coverage). The Operations Manager and the super admin are
   * not; nor is a manager who is also an Operations member (a Sales manager
   * keeps the Sales manager's reach) -- Sales is decided elsewhere.
   */
  private async familyNarrowed(actor: Actor): Promise<boolean> {
    if (actor.staffRole !== StaffRole.ADMIN && actor.staffRole !== StaffRole.COVERAGE) return false;
    const standing = await accountAdminStandingOf(this.prisma, actor);
    return standing.operations === 'member';
  }
}
