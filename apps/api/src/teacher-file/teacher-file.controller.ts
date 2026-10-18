import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TeacherFileService } from './teacher-file.service';

/**
 * PD-10 Teacher File, administration only. Every route is behind the global
 * bearer guard; who may do what is decided in TeacherFileService ->
 * AuthorizationService.teacherFileAccess, never here. POST for updates: the
 * shared admin-web client has no PUT.
 */
@Controller('teacher-files')
@UseFilters(CommErrorFilter)
export class TeacherFileController {
  constructor(private readonly files: TeacherFileService) {}

  @Get()
  list(@ActorId() actorId: string) {
    return this.files.list(actorId);
  }

  @Get(':teacherId')
  detail(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.files.detail(actorId, teacherId);
  }

  @Post(':teacherId/personal')
  updatePersonal(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.files.updatePersonal(actorId, teacherId, body ?? {});
  }

  @Post(':teacherId/entries')
  addEntry(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.files.addEntry(actorId, teacherId, body ?? {});
  }
}
