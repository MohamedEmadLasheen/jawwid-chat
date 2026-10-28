import { Controller, Get, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ConversationService } from '../communication/conversations/conversation.service';
import { SupervisionCaseService } from '../cases/supervision-case.service';
import { TaskService } from '../tasks/task.service';
import { Requires, SelfService } from '../platform/permissions/route-access';
import { dashboardSection, type DashboardSection } from './dashboard-tile';

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
}
