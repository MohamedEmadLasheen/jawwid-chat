import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ReportCorrectionService } from './report-correction.service';
import { Requires, SelfService } from '../platform/permissions/route-access';

/**
 * PD-35: report correction requests. Behind the global bearer guard; who may
 * ask, withdraw and read is decided in ReportCorrectionService. The teacher
 * answers through PD-15's report routes, never here.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class ReportCorrectionController {
  constructor(private readonly corrections: ReportCorrectionService) {}

  /** { reason, kind?: 'missing' | 'correction', fields? } */
  @Requires('lessons.manage')
  @Post('lessons/:id/correction-requests')
  request(@ActorId() actorId: string, @Param('id') lessonId: string, @Body() body: Record<string, unknown>) {
    return this.corrections.request(actorId, lessonId, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('correction-requests/:id/withdraw')
  withdraw(@ActorId() actorId: string, @Param('id') id: string) {
    return this.corrections.withdraw(actorId, id);
  }

  /** ?status=open|resolved|all &teacherId= */
  @Requires('lessons.view')
  @Get('correction-requests')
  list(@ActorId() actorId: string, @Query('status') status?: string, @Query('teacherId') teacherId?: string) {
    return this.corrections.list(actorId, { status, teacherId });
  }

  @SelfService()
  @Get('me/correction-requests')
  mine(@ActorId() actorId: string) {
    return this.corrections.mine(actorId);
  }
}
