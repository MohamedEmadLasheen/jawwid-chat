import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires, SelfService } from '../platform/permissions/route-access';
import { SalesPipelineService } from './sales-pipeline.service';

/**
 * PD-59: the Sales pipeline. Behind the global bearer guard; who may use it is
 * decided in SalesPipelineService on every call (Sales and the super admin),
 * never here: the permission keys only keep unrelated roles out early. POST for
 * every change.
 */
@Controller('sales-pipeline')
@UseFilters(CommErrorFilter)
export class SalesPipelineController {
  constructor(private readonly pipeline: SalesPipelineService) {}

  /** What the Admin Web may offer: { allowed, standing }. Advisory. */
  @SelfService()
  @Get('access')
  access(@ActorId() actorId: string) {
    return this.pipeline.access(actorId);
  }

  /** ?stage&q&followUp=due&limit&offset -- leads with their derived stage; no contact value. */
  @Requires('new_students.view')
  @Get('leads')
  list(
    @ActorId() actorId: string,
    @Query('stage') stage?: string,
    @Query('q') q?: string,
    @Query('followUp') followUp?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.pipeline.list(actorId, { stage, q, followUp, limit, offset });
  }

  /** One lead with its contact details; the read of the contact is audited. */
  @Requires('new_students.view')
  @Get('leads/:leadId')
  get(@ActorId() actorId: string, @Param('leadId') leadId: string) {
    return this.pipeline.get(actorId, leadId);
  }

  /** { displayName, level?, note?, contact?, nextFollowUpOn?, followUpNote? } */
  @Requires('new_students.manage')
  @Post('leads')
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.pipeline.create(actorId, body ?? {});
  }

  /** { stage?, lostReason?, contact?, nextFollowUpOn?, followUpNote? } */
  @Requires('new_students.manage')
  @Post('leads/:leadId')
  update(@ActorId() actorId: string, @Param('leadId') leadId: string, @Body() body: Record<string, unknown>) {
    return this.pipeline.update(actorId, leadId, body ?? {});
  }

  /** { nextFollowUpOn?, followUpNote? } -- the lead was contacted now. */
  @Requires('new_students.manage')
  @Post('leads/:leadId/contacted')
  contacted(@ActorId() actorId: string, @Param('leadId') leadId: string, @Body() body: Record<string, unknown>) {
    return this.pipeline.markContacted(actorId, leadId, body ?? {});
  }

  /** Hand the lead over: links it to the family that already holds the parent, or says the family intake is next. */
  @Requires('new_students.manage')
  @Post('leads/:leadId/convert')
  convert(@ActorId() actorId: string, @Param('leadId') leadId: string) {
    return this.pipeline.convert(actorId, leadId);
  }
}
