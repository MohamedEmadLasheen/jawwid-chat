import { Body, Controller, Get, Header, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires, SelfService } from '../platform/permissions/route-access';
import { TeacherRecordsService } from './teacher-records.service';

/**
 * PD-52 (docs/product/pd052-teacher-records-pages-plan.md §5.6): the
 * teacher-records pages. Who may do what is decided in TeacherRecordsService,
 * never here; the old teacher_supervision.* keys count for one release.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TeacherRecordsController {
  constructor(private readonly records: TeacherRecordsService) {}

  /** Which of the two pages, and which actions, the Admin Web may offer the caller. */
  @SelfService()
  @Get('teacher-records/access')
  @Header('Cache-Control', 'no-store')
  access(@ActorId() actorId: string) {
    return this.records.access(actorId);
  }

  /** The parents' praise and the staff's testimonials, `teacher=` and `month=YYYY-MM`. */
  @Requires('teacher_supervision.view', 'teacher_grants.view')
  @Get('teacher-records/testimonials')
  testimonials(@ActorId() actorId: string, @Query('teacher') teacher?: string, @Query('month') month?: string, @Query('voided') voided?: string) {
    return this.records.testimonials(actorId, { teacher, month, voided });
  }

  @Requires('teacher_supervision.record', 'teacher_grants.record')
  @Post('teachers/:id/testimonials')
  recordTestimonial(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.records.recordTestimonial(actorId, id, body ?? {});
  }

  /** A complaint (decide, page A) or testimonial (record, page B) entered by mistake, once. */
  @Requires('teacher_supervision.record', 'teacher_attendance.decide', 'teacher_grants.record')
  @Post('teacher-records/entries/:id/void')
  voidEntry(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.records.voidEntry(actorId, id, body ?? {});
  }

  /** One teacher's strip: away, this month's ladder, open complaints, this year's grants and testimonials. */
  @Requires('teacher_supervision.view', 'teacher_attendance.view', 'teacher_grants.view')
  @Get('teacher-records/teachers/:id/summary')
  @Header('Cache-Control', 'no-store')
  summary(@ActorId() actorId: string, @Param('id') id: string) {
    return this.records.summary(actorId, id);
  }
}
