import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';

/**
 * Workload counts for staff profiles, derived ONLY from authoritative rows.
 *
 * ## The one definition everything hangs off
 *
 *   ASSIGNED FAMILY of staff S  =  chat.family where owner_id = S
 *                                  and state <> 'churned'
 *                                  and organization_id = the caller's tenant
 *
 * `family.owner_id` is the current supervisor assignment (SUPERVISOR-OWNERSHIP
 * §2: NOT NULL, exactly one per family, changed only by transfer_ownership()).
 * A churned family is no longer a customer. Every other count is restricted to
 * the assigned families of the staff member it is reported for:
 *
 *   studentsInAssignedFamilies   chat.learner in those families
 *   parentContacts               chat.contact in those families, is_active
 *   teachersOfAssignedStudents   DISTINCT chat.teacher teaching those learners,
 *                                is_active and left_at is null. This is "who
 *                                teaches my families' students", NOT a
 *                                supervision relationship -- none exists.
 *   openConversations            chat.conversation of those families, not
 *                                archived and not resolved
 *   awaitingReply                the subset whose last customer message is newer
 *                                than the last staff message -- the exact rule of
 *                                contracts/dto.ts needsReply()
 *   pendingApprovals             chat.message_approval still 'pending' in those
 *                                conversations
 *   directReports                active staff whose reporting line names S
 *
 * ## Why per-staff sums are exact, and where they are not
 *
 * A family has exactly one owner, a learner/contact/conversation exactly one
 * family, an approval exactly one conversation. So summing those counts over a
 * set of staff never double-counts. TEACHERS are the exception: one teacher can
 * teach learners of several supervisors, so a team's or an organization's
 * teacher count is computed as its own DISTINCT query (`distinctTeachers`), never
 * as a sum.
 *
 * ## What is NOT here, on purpose
 *
 * Tasks, cases, complaints, escalations, follow-ups, attendance, scores. Tasks
 * are frozen (PD-4), cases were removed (C-3), workload scoring is deprecated
 * (BOUNDARY §3), and attendance lives in Jawwid Core. There is no row to count,
 * so there is no number -- the profile says "not tracked" instead.
 *
 * Every query takes the organization explicitly and filters on it, because RLS
 * is not the live control yet (RLS-STRATEGY §7). Callers must pass only staff
 * ids they were authorized to see; this service adds no authorization.
 */

export interface StaffWorkload {
  assignedFamilies: number;
  studentsInAssignedFamilies: number;
  parentContacts: number;
  teachersOfAssignedStudents: number;
  openConversations: number;
  awaitingReply: number;
  pendingApprovals: number;
  directReports: number;
}

export const EMPTY_WORKLOAD: StaffWorkload = Object.freeze({
  assignedFamilies: 0,
  studentsInAssignedFamilies: 0,
  parentContacts: 0,
  teachersOfAssignedStudents: 0,
  openConversations: 0,
  awaitingReply: 0,
  pendingApprovals: 0,
  directReports: 0,
});

/** Organization-wide unique totals, computed directly -- never by summing staff. */
export interface OrganizationTotals {
  /** Non-churned families in the organization (each has exactly one owner). */
  families: number;
  studentsInFamilies: number;
  activeParentContacts: number;
  /** Every active teacher record in the organization. */
  activeTeachers: number;
  /** Distinct active teachers teaching at least one learner of a non-churned family. */
  teachersWithStudents: number;
  openConversations: number;
  awaitingReply: number;
  pendingApprovals: number;
  /** Non-churned families whose owner is inactive -- an offboarding gap. */
  familiesOwnedByInactiveStaff: number;
}

/** Any Prisma client or transaction: the owner client, or a scoped chat_app transaction. */
type Db = Pick<PrismaService, '$queryRaw'>;

/**
 * The counts are computed by SQL functions (20261014110100) so that ONE
 * implementation serves both connection modes:
 *   - server side (owner): the ids are those the API already authorized;
 *   - restricted (chat_app, withActor): the functions keep only the ids the
 *     trusted session identity may view, so a request role cannot count another
 *     team's families by naming their staff ids.
 * The definitions are exactly the ones documented above.
 */
@Injectable()
export class StaffWorkloadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Workload for each requested staff id. Ids with nothing assigned map to zeros. */
  async forStaff(
    _organizationId: string,
    staffIds: readonly string[],
    db: Db = this.prisma,
  ): Promise<Map<string, StaffWorkload>> {
    const result = new Map<string, StaffWorkload>();
    const ids = [...new Set(staffIds)];
    for (const id of ids) result.set(id, { ...EMPTY_WORKLOAD });
    if (ids.length === 0) return result;

    const rows = await db.$queryRaw<Array<{
      staff_id: string; assigned_families: number; students: number; contacts: number; teachers: number;
      open_conversations: number; awaiting_reply: number; pending_approvals: number; direct_reports: number;
    }>>`select staff_id::text, assigned_families, students, contacts, teachers, open_conversations,
               awaiting_reply, pending_approvals, direct_reports
          from chat.staff_workload(${ids}::uuid[])`;
    for (const r of rows) {
      result.set(r.staff_id, {
        assignedFamilies: r.assigned_families,
        studentsInAssignedFamilies: r.students,
        parentContacts: r.contacts,
        teachersOfAssignedStudents: r.teachers,
        openConversations: r.open_conversations,
        awaitingReply: r.awaiting_reply,
        pendingApprovals: r.pending_approvals,
        directReports: r.direct_reports,
      });
    }
    return result;
  }

  /**
   * Distinct active teachers teaching the assigned families of ANY of these
   * staff. The only correct team/organization teacher count: a sum of the
   * per-staff numbers would count a shared teacher once per supervisor.
   */
  async distinctTeachers(_organizationId: string, staffIds: readonly string[], db: Db = this.prisma): Promise<number> {
    const ids = [...new Set(staffIds)];
    if (ids.length === 0) return 0;
    const [row] = await db.$queryRaw<Array<{ n: number }>>`select chat.staff_distinct_teachers(${ids}::uuid[]) as n`;
    return row?.n ?? 0;
  }

  async organizationTotals(organizationId: string, db: Db = this.prisma): Promise<OrganizationTotals> {
    const [r] = await db.$queryRaw<Array<{
      families: number; students_in_families: number; active_parent_contacts: number; active_teachers: number;
      teachers_with_students: number; open_conversations: number; awaiting_reply: number; pending_approvals: number;
      families_owned_by_inactive_staff: number;
    }>>`select * from chat.organization_workload_totals(${organizationId}::uuid)`;
    return {
      families: r.families,
      studentsInFamilies: r.students_in_families,
      activeParentContacts: r.active_parent_contacts,
      activeTeachers: r.active_teachers,
      teachersWithStudents: r.teachers_with_students,
      openConversations: r.open_conversations,
      awaitingReply: r.awaiting_reply,
      pendingApprovals: r.pending_approvals,
      familiesOwnedByInactiveStaff: r.families_owned_by_inactive_staff,
    };
  }
}
