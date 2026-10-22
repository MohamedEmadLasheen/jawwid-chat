import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { OrgStructureService } from './org-structure.service';

/**
 * PD-8 organization structure. Every route is behind the global bearer guard;
 * who may do what is decided in OrgStructureService -> AuthorizationService,
 * never here. POST (not PUT) for updates: the shared admin-web client has no PUT.
 */
@Controller('org')
@UseFilters(CommErrorFilter)
export class OrgStructureController {
  constructor(private readonly org: OrgStructureService) {}

  @Get('structure')
  structure(@ActorId() actorId: string) {
    return this.org.structure(actorId);
  }

  /** The families, parents, children and teachers this staff member may put in a family group. */
  @Get('group-candidates')
  groupCandidates(@ActorId() actorId: string) {
    return this.org.groupCandidates(actorId);
  }

  @Get('learners')
  learners(
    @ActorId() actorId: string,
    @Query('supervisorId') supervisorId?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    return this.org.learners(actorId, { supervisorId, unassigned: unassigned === 'true' });
  }

  @Post('learners/:learnerId/supervisor')
  assignSupervisor(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: Record<string, unknown>) {
    return this.org.assignSupervisor(actorId, learnerId, body ?? {});
  }

  /** PD-24: move a student group or family group, with all its children, to another supervisor. */
  @Post('conversations/:conversationId/supervisor')
  transferGroup(@ActorId() actorId: string, @Param('conversationId') conversationId: string, @Body() body: Record<string, unknown>) {
    return this.org.transferGroup(actorId, conversationId, body ?? {});
  }

  @Post('departments')
  upsertDepartment(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.org.upsertDepartment(actorId, body ?? {});
  }

  @Post('departments/:departmentId/members')
  setDepartmentMember(
    @ActorId() actorId: string,
    @Param('departmentId') departmentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.org.setDepartmentMember(actorId, departmentId, body ?? {});
  }

  @Post('department-members/:staffId/remove')
  removeDepartmentMember(@ActorId() actorId: string, @Param('staffId') staffId: string, @Body() body: Record<string, unknown>) {
    return this.org.removeDepartmentMember(actorId, staffId, body ?? {});
  }

  @Post('backups')
  createBackup(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.org.createBackup(actorId, body ?? {});
  }

  @Post('backups/:id/activate')
  activateBackup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.org.activateBackup(actorId, id, body ?? {});
  }

  @Post('backups/:id/deactivate')
  deactivateBackup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.org.deactivateBackup(actorId, id, body ?? {});
  }

  @Post('backups/:id/end')
  endBackup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.org.endBackup(actorId, id, body ?? {});
  }
}
