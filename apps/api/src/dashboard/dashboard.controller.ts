import { Controller, Get, Req, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ConversationService } from '../communication/conversations/conversation.service';
import { SupervisionCaseService } from '../cases/supervision-case.service';
import { TaskService } from '../tasks/task.service';
import { CalendarService } from '../calendar/calendar.service';
import { TrialService } from '../lessons/trial.service';
import { NewStudentEnrolmentService } from '../new-students/enrolment.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../billing/payments.service';
import { ParentRecordService } from '../parent-profile/parent-record.service';
import { LeaveService } from '../leave/leave.service';
import { DisciplineService } from '../discipline/discipline.service';
import { ParentFeedbackService } from '../teacher-file/parent-feedback.service';
import { CertificateService } from '../certificates/certificate.service';
import { TeacherProfileService } from '../communication/teacher-profile/teacher-profile.service';
import { OrgStructureService } from '../org/org-structure.service';
import { SupervisorCoverService } from '../org/supervisor-cover.service';
import { TeacherSupervisorService } from '../teacher-supervisors/teacher-supervisor.service';
import { Requires, SelfService } from '../platform/permissions/route-access';
import { dashboardSection, type DashboardSection, type DashboardTile } from './dashboard-tile';

/**
 * PD-44: the manager Dashboard, one read-only section per page it summarises
 * (docs/product/pd044-manager-dashboard-plan.md §3).
 *
 * Each route requires the PD-40 key of the page its tiles link to, and asks
 * that page's own service for the counts -- the same scope helper, the same
 * predicate -- so no scope rule is copied here. There is no dashboard key of
 * its own: it would be a second gate to the same data (plan §2.1).
 */
@Controller('dashboard')
@UseFilters(CommErrorFilter)
export class DashboardController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly cases: SupervisionCaseService,
    private readonly tasks: TaskService,
    private readonly calendar: CalendarService,
    private readonly trials: TrialService,
    private readonly enrolment: NewStudentEnrolmentService,
    private readonly billing: BillingService,
    private readonly payments: PaymentsService,
    private readonly parents: ParentRecordService,
    private readonly leave: LeaveService,
    private readonly discipline: DisciplineService,
    private readonly feedback: ParentFeedbackService,
    private readonly certificates: CertificateService,
    private readonly profiles: TeacherProfileService,
    private readonly org: OrgStructureService,
    private readonly supervisors: TeacherSupervisorService,
    private readonly covers: SupervisorCoverService,
  ) {}

  /** Chats waiting for a staff reply, in the caller's PD-8 scope. Links to /chat. */
  @Requires('chat.use')
  @Get('chats')
  async chats(@ActorId() actorId: string): Promise<DashboardSection> {
    const now = new Date();
    return dashboardSection(await this.conversations.dashboardWaiting(actorId, now), now);
  }

  /** Open escalation cases: the caller's own, their department's, and the overdue ones. Links to /cases. */
  @Requires('cases.view')
  @Get('cases')
  async casesSection(@ActorId() actorId: string): Promise<DashboardSection> {
    const now = new Date();
    return dashboardSection(await this.cases.dashboardCounts(actorId), now);
  }

  /**
   * PD-47: tasks -- the caller's own, and for whoever manages a department their
   * team's, the decisions waiting and the tasks whose assignee is gone; the super
   * admin's unmanaged ones. Links to /tasks. Self-service, like the Tasks page:
   * everyone has their own tasks, and TaskService decides the rest.
   */
  @SelfService()
  @Get('tasks')
  async tasksSection(@ActorId() actorId: string): Promise<DashboardSection> {
    const now = new Date();
    return dashboardSection(await this.tasks.dashboardCounts(actorId), now);
  }

  /**
   * Today's lessons by outcome, as the Schedule shows them to the caller; and,
   * for the Teachers department and the super admin, lessons still waiting for
   * an outcome and late apologies to rule on. Links to /schedule and
   * /teachers/needs-action.
   */
  @Requires('lessons.view', 'schedule.view')
  @Get('lessons')
  async lessons(@ActorId() actorId: string): Promise<DashboardSection> {
    const now = new Date();
    return dashboardSection(await this.calendar.dashboardCounts(actorId, now), now);
  }

  /**
   * Two pages' tiles in one section: the Trials page's tabs (trials.view) and
   * the New Students page's filters (new_students.view). A staff caller gets
   * each page's tiles only with that page's own key (resolved by
   * PermissionGuard), and each service decides department and scope. Links to
   * /trials and /trials/new-students.
   */
  @Requires('trials.view', 'new_students.view')
  @Get('enrolment')
  async enrolmentSection(
    @ActorId() actorId: string,
    @Req() request?: { permissions?: ReadonlySet<string> },
  ): Promise<DashboardSection> {
    const now = new Date();
    const keys = request?.permissions;
    const holds = (key: string) => !keys || keys.has(key);
    const tiles: DashboardTile[] = [
      ...(holds('trials.view') ? await this.trials.dashboardCounts(actorId, now) : []),
      ...(holds('new_students.view') ? await this.enrolment.dashboardCounts(actorId) : []),
    ];
    return dashboardSection(tiles, now);
  }

  /**
   * Payments: the Instalment Payments page's lines (billing.view) -- overdue,
   * due today, no billing supervisor -- the receipts waiting for review on
   * Payments (billing.view), and the Parents list's subscription filters
   * (parents.view): locked, grace period. Each page's service applies its
   * own scope (billingAccessOf). Links to /instalments, /payments, /parents.
   */
  @Requires('billing.view', 'parents.view')
  @Get('billing')
  async billingSection(
    @ActorId() actorId: string,
    @Req() request?: { permissions?: ReadonlySet<string> },
  ): Promise<DashboardSection> {
    const now = new Date();
    const keys = request?.permissions;
    const holds = (key: string) => !keys || keys.has(key);
    const tiles: DashboardTile[] = [
      ...(holds('billing.view') ? await this.billing.dashboardCounts(actorId) : []),
      ...(holds('billing.view') ? await this.payments.dashboardCounts(actorId) : []),
      ...(holds('parents.view') ? await this.parents.dashboardCounts(actorId) : []),
    ];
    return dashboardSection(tiles, now);
  }

  /**
   * Teachers: the Teacher Supervision page's queues (teacher_supervision.view)
   * -- leave waiting for a decision, open absences and lateness, new and
   * in-review parent feedback -- each in the page's own scope (PD-35, and for
   * Operations the PD-26 basis: teacher-level rows whole, rows about one child
   * only for their own families); the Certificates page's pending requests
   * per category (certificates.view, with one of the two keys below); the
   * Teacher Profiles credentials queue (teacher_profiles.review). Links to
   * /teachers/supervision?section=, /certificates?category= and
   * /teacher-profiles.
   *
   * certificates.view alone does not open this route: the certificate keys
   * open exactly the certificate routes (PD-41's Designer reaches nothing
   * else, pd040-route-permissions.spec.ts), so the certificate tiles come to
   * the Teachers department and the super admin, who hold a key below too.
   */
  @Requires('teacher_supervision.view', 'teacher_profiles.review')
  @Get('teachers')
  async teachersSection(
    @ActorId() actorId: string,
    @Req() request?: { permissions?: ReadonlySet<string> },
  ): Promise<DashboardSection> {
    const now = new Date();
    const keys = request?.permissions;
    const holds = (key: string) => !keys || keys.has(key);
    const supervision = holds('teacher_supervision.view');
    const tiles: DashboardTile[] = [
      ...(supervision ? await this.leave.dashboardCounts(actorId) : []),
      ...(supervision ? await this.discipline.dashboardCounts(actorId) : []),
      ...(supervision ? await this.feedback.dashboardCounts(actorId) : []),
      ...(holds('certificates.view') ? await this.certificates.dashboardCounts(actorId) : []),
      ...(holds('teacher_profiles.review') ? await this.profiles.dashboardCounts(actorId) : []),
    ];
    return dashboardSection(tiles, now);
  }

  /**
   * Organization: the Organization page's Children tab ("Without a
   * supervisor"), its Teachers tab (the unassigned banner) and the Structure
   * tab's covers under way. Each service decides who sees its tab: Children
   * and covers the super admin and the Operations Manager, Teachers the super
   * admin and the Teachers Manager. The page's own key, org.view (org.manage
   * is asked only by its writes); covers also need org.covers, the key of
   * GET /org/covers. Links to /organization?tab=children|teachers|structure.
   */
  @Requires('org.view')
  @Get('structure')
  async structureSection(
    @ActorId() actorId: string,
    @Req() request?: { permissions?: ReadonlySet<string> },
  ): Promise<DashboardSection> {
    const now = new Date();
    const keys = request?.permissions;
    const holds = (key: string) => !keys || keys.has(key);
    const tiles: DashboardTile[] = [
      ...(await this.org.dashboardCounts(actorId)),
      ...(await this.supervisors.dashboardCounts(actorId)),
      ...(holds('org.covers') ? await this.covers.dashboardCounts(actorId) : []),
    ];
    return dashboardSection(tiles, now);
  }
}
