import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { EnrollmentService } from './enrollment.service';
import { LessonRecordService } from './lesson-record.service';
import { LessonService } from './lesson.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-15: the student's journey after enrolment. Behind the global bearer
 * guard; who may do what is decided in the services through
 * AuthorizationService, never here. POST for every change (the admin-web
 * client has no PUT/PATCH).
 */
@Controller()
@UseFilters(CommErrorFilter)
export class JourneyController {
  constructor(
    private readonly lessons: LessonService,
    private readonly records: LessonRecordService,
    private readonly enrollment: EnrollmentService,
  ) {}

  /** A supervisor excuses the learner after the start: excused at once. */
  @Requires('lessons.manage')
  @Post('lessons/:id/late-excuse')
  lateExcuse(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.lateExcuse(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/correction')
  correct(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.records.correct(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/report/edit')
  editReport(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.records.editReport(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/report/delete')
  deleteReport(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.records.deleteReport(actorId, id, body ?? {});
  }

  /** Staff: the lesson's corrections and every previous report version. */
  @Requires('lessons.view')
  @Get('lessons/:id/history')
  history(@ActorId() actorId: string, @Param('id') id: string) {
    return this.records.history(actorId, id);
  }

  /** Each child a group is about: age, course, weekly times, package. */
  @Requires('chat.use')
  @Get('conversations/:id/learners')
  groupLearners(@ActorId() actorId: string, @Param('id') id: string) {
    return this.enrollment.groupLearners(actorId, id);
  }

  /** PD-17: the Student Profile -- the administration and the child's own teacher. */
  @Requires('students.view')
  @Get('learners/:id/profile')
  studentProfile(@ActorId() actorId: string, @Param('id') id: string) {
    return this.enrollment.profile(actorId, id);
  }

  @Requires('students.manage')
  @Post('learners/:id/enrollment')
  setEnrollment(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.enrollment.setEnrollment(actorId, id, body ?? {});
  }

  @Requires('lessons.view')
  @Get('courses')
  courses(@ActorId() actorId: string) {
    return this.enrollment.courses(actorId);
  }

  @Requires('lessons.courses')
  @Post('courses')
  createCourse(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.enrollment.createCourse(actorId, body ?? {});
  }

  @Requires('lessons.courses')
  @Post('courses/:id')
  updateCourse(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.enrollment.updateCourse(actorId, id, body ?? {});
  }
}
