import { Controller, Get, Req, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ConversationService } from '../communication/conversations/conversation.service';
import { SupervisionCaseService } from '../cases/supervision-case.service';
import { TaskService } from '../tasks/task.service';
import { CalendarService } from '../calendar/calendar.service';
import { TrialService } from '../lessons/trial.service';
import { NewStudentEnrolmentService } from '../new-students/enrolment.service';
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
}
