import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { OrgStructureService } from './org-structure.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-8 organization structure. Every route is behind the global bearer guard;
 * who may do what is decided in OrgStructureService -> AuthorizationService,
 * never here. POST (not PUT) for updates: the shared admin-web client has no PUT.
 */
@Controller('org')
@UseFilters(CommErrorFilter)
export class OrgStructureController {
  constructor(private readonly org: OrgStructureService) {}

  @Requires('org.view')
  @Get('structure')
  structure(@ActorId() actorId: string) {
    return this.org.structure(actorId);
  }

  /** The families, parents, children and teachers this staff member may put in a family group. */
  // PD-40: the families the caller may open a family group for -- the
  // family-group helper, so the same key as POST /conversations/family-group.
  @Requires('chat.manage')
  @Get('group-candidates')
  groupCandidates(@ActorId() actorId: string) {
    return this.org.groupCandidates(actorId);
  }

  @Requires('org.view')
  @Get('learners')
  learners(
    @ActorId() actorId: string,
    @Query('supervisorId') supervisorId?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    return this.org.learners(actorId, { supervisorId, unassigned: unassigned === 'true' });
  }

  @Requires('org.manage')
  @Post('learners/:learnerId/supervisor')
  assignSupervisor(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: Record<string, unknown>) {
    return this.org.assignSupervisor(actorId, learnerId, body ?? {});
  }

  /** PD-24: move a student group or family group, with all its children, to another supervisor. */
  @Requires('org.manage')
  @Post('conversations/:conversationId/supervisor')
  transferGroup(@ActorId() actorId: string, @Param('conversationId') conversationId: string, @Body() body: Record<string, unknown>) {
    return this.org.transferGroup(actorId, conversationId, body ?? {});
  }

  @Requires('org.departments')
  @Post('departments')
  upsertDepartment(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.org.upsertDepartment(actorId, body ?? {});
  }

  @Requires('org.departments')
  @Post('departments/:departmentId/members')
  setDepartmentMember(
    @ActorId() actorId: string,
    @Param('departmentId') departmentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.org.setDepartmentMember(actorId, departmentId, body ?? {});
  }

  @Requires('org.departments')
  @Post('department-members/:staffId/remove')
  removeDepartmentMember(@ActorId() actorId: string, @Param('staffId') staffId: string, @Body() body: Record<string, unknown>) {
    return this.org.removeDepartmentMember(actorId, staffId, body ?? {});
  }

  @Requires('org.manage')
  @Post('backups')
  createBackup(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.org.createBackup(actorId, body ?? {});
  }

  @Requires('org.manage')
  @Post('backups/:id/activate')
  activateBackup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.org.activateBackup(actorId, id, body ?? {});
  }

  @Requires('org.manage')
  @Post('backups/:id/deactivate')
  deactivateBackup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.org.deactivateBackup(actorId, id, body ?? {});
  }

  @Requires('org.manage')
  @Post('backups/:id/end')
  endBackup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.org.endBackup(actorId, id, body ?? {});
  }
}
