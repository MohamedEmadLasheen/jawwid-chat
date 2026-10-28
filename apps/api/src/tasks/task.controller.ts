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

  /** ?state=open|closed &cursor: the caller's own tasks. */
  @SelfService()
  @Get('me/tasks')
  mine(@ActorId() actorId: string, @Query('state') state?: string, @Query('cursor') cursor?: string) {
    return this.tasks.list(actorId, { view: 'mine', state, cursor });
  }

  /** ?view=team|decisions|all &state=open|closed &cursor (all: the super admin). */
  @Requires('tasks.team', 'tasks.manage')
  @Get('tasks')
  list(@ActorId() actorId: string, @Query('view') view?: string, @Query('state') state?: string, @Query('cursor') cursor?: string) {
    return this.tasks.list(actorId, { view: view ?? 'team', state, cursor });
  }

  /** { assignee: { kind, id }, title, body?, dueAt? } */
  @Requires('tasks.create')
  @Post('tasks')
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.tasks.create(actorId, body ?? {});
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

  /** { dueAt: ISO timestamp | null } */
  @Requires('tasks.manage')
  @Post('tasks/:id/due')
  due(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.tasks.setDue(actorId, id, body ?? {});
  }
}
