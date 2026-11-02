import { Controller, Get, Header, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SelfService } from '../platform/permissions/route-access';
import { TeacherRecordsService } from './teacher-records.service';

/**
 * PD-52 (docs/product/pd052-teacher-records-pages-plan.md §5.6): the
 * teacher-records pages. Who may do what is decided in the services, never here.
 */
@Controller('teacher-records')
@UseFilters(CommErrorFilter)
export class TeacherRecordsController {
  constructor(private readonly records: TeacherRecordsService) {}

  /** Which of the two pages, and which actions, the Admin Web may offer the caller. */
  @SelfService()
  @Get('access')
  @Header('Cache-Control', 'no-store')
  access(@ActorId() actorId: string) {
    return this.records.access(actorId);
  }
}
