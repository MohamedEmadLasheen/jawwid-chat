import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires, SelfService } from '../platform/permissions/route-access';
import { TaskService } from './task.service';

/**
 * PD-47: tasks. Behind the global bearer guard. A person's own tasks are
 * self-service, for staff and teachers alike; watching a team, creating and
 * deciding need a key. Who may see and do what, for each task, is decided in
 * TaskService, live.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  /** ?state=open|closed &level &category &overdue &cursor: the caller's own tasks, most urgent first. */
  @SelfService()
  @Get('me/tasks')
  mine(@ActorId() actorId: string, @Query() q: Record<string, string | undefined>) {
    return this.tasks.list(actorId, { view: 'mine', state: q.state, cursor: q.cursor, level: q.level, category: q.category, overdue: q.overdue, limit: q.limit, gone: q.gone });
  }

  /**
   * ?view=team|decisions|all &state=open|closed &cursor (all: the super admin).
   * The view is required: the legacy Admin Web page still calls GET /tasks
   * with ?scope= and a different shape, and must keep failing until PR-3
   * replaces it.
   */
  @Requires('tasks.team', 'tasks.manage')
  @Get('tasks')
  list(@ActorId() actorId: string, @Query() q: Record<string, string | undefined>) {
    return this.tasks.list(actorId, {
      view: q.view ?? '', state: q.state, cursor: q.cursor, level: q.level, category: q.category, overdue: q.overdue, limit: q.limit,
      gone: q.gone, unmanaged: q.unmanaged,
    });
  }

  /** { assignee: { kind, id }, title, body?, dueAt?, priority?, category? } */
  @Requires('tasks.create')
  @Post('tasks')
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.tasks.create(actorId, body ?? {});
  }

  /**
   * ?task=<id>: who the caller may hand that task on to; without it, who they
   * may give a new task to. { people: [{ kind, id, name }], departments: [{ kind, managerName }] }
   */
  @Requires('tasks.create', 'tasks.manage')
  @Get('tasks/assignees')
  assignees(@ActorId() actorId: string, @Query() q: Record<string, string | undefined>) {
    return this.tasks.assignees(actorId, { task: q.task });
  }

  @SelfService()
  @Get('tasks/:id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.tasks.get(actorId, id);
  }

  /** { note? }: the assignee, a manual task. */
  @SelfService()
  @Post('tasks/:id/complete')
  complete(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.complete(actorId, id, body ?? {});
  }

  /** The assignee, for a system task whose work no longer exists (PD-47 PR-2). */
  @SelfService()
  @Post('tasks/:id/acknowledge')
  acknowledge(@ActorId() actorId: string, @Param('id') id: string) {
    return this.tasks.acknowledge(actorId, id);
  }

  /** { comment }: the assignee. */
  @SelfService()
  @Post('tasks/:id/out-of-scope')
  outOfScope(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.outOfScope(actorId, id, body ?? {});
  }

  /** { body }: anyone who sees the task. */
  @SelfService()
  @Post('tasks/:id/comments')
  comment(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.comment(actorId, id, body ?? {});
  }

  /** { instructions } */
  @Requires('tasks.manage')
  @Post('tasks/:id/return')
  returnTask(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.returnTask(actorId, id, body ?? {});
  }

  /** { reason } */
  @Requires('tasks.manage')
  @Post('tasks/:id/remove')
  remove(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.remove(actorId, id, body ?? {});
  }

  /** { to: { kind, id } | { department }, instructions? } */
  @Requires('tasks.manage')
  @Post('tasks/:id/reassign')
  reassign(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.reassign(actorId, id, body ?? {});
  }

  /** { priority: high | medium | low }: the manual level (PD-47 priority amendment). */
  @Requires('tasks.manage')
  @Post('tasks/:id/priority')
  priority(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.setPriority(actorId, id, body ?? {});
  }

  /** { dueAt: ISO timestamp | null } */
  @Requires('tasks.manage')
  @Post('tasks/:id/due')
  due(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.setDue(actorId, id, body ?? {});
  }
}
