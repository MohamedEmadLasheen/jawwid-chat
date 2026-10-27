import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TeacherFileService } from './teacher-file.service';

/**
 * PD-26 amendment (owner 2026-10-27): the Teacher Supervision page's own reads,
 * for every basis -- the Teachers department, the super admin, and an Operations
 * supervisor for the teachers of their families. Nothing of the Teacher File:
 * `/teacher-files` stays the Teachers department's. Decided in
 * TeacherFileService.pageGate, never here.
 */
@Controller('teacher-supervision')
@UseFilters(CommErrorFilter)
export class TeacherSupervisionController {
  constructor(private readonly files: TeacherFileService) {}

  /** The teachers the caller works on (and who is away today), and who may handle a complaint. */
  @Get('directory')
  directory(@ActorId() actorId: string) {
    return this.files.directory(actorId);
  }

  /** One teacher's held lessons of the last two weeks, `kind=regular|trial`, for recording lateness. */
  @Get('teachers/:teacherId/held-lessons')
  heldLessons(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Query('kind') kind?: string) {
    return this.files.heldLessons(actorId, teacherId, kind);
  }
}
