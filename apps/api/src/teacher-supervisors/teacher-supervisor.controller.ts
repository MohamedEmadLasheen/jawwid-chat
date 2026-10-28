import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TeacherSupervisorService } from './teacher-supervisor.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-35: teacher supervisors -- assigning teachers to them, and the groups they
 * may join. Behind the global bearer guard; who may do what is decided in
 * TeacherSupervisorService. POST for every change. Joining and leaving
 * themselves are the seat routes (conversations/:id/join, /leave).
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TeacherSupervisorController {
  constructor(private readonly supervisors: TeacherSupervisorService) {}

  /** Every teacher with their supervisor, the supervisors, and how many teachers are unassigned. */
  @Requires('org.view')
  @Get('org/teacher-assignments')
  assignments(@ActorId() actorId: string) {
    return this.supervisors.assignments(actorId);
  }

  /** { supervisorId: uuid | null, reason? } */
  @Requires('org.manage')
  @Post('org/teachers/:teacherId/supervisor')
  assign(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.supervisors.assign(actorId, teacherId, body ?? {});
  }

  /** The groups of the caller's teachers they may join. ?teacherId= &q= */
  @Requires('chat.use')
  @Get('seats/candidates')
  candidates(@ActorId() actorId: string, @Query('teacherId') teacherId?: string, @Query('q') q?: string) {
    return this.supervisors.joinCandidates(actorId, { teacherId, q });
  }
}
