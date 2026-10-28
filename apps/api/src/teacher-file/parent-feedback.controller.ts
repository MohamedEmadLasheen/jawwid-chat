import { Body, Controller, Get, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ParentFeedbackService } from './parent-feedback.service';
import { NotForStaff, Requires } from '../platform/permissions/route-access';

/**
 * PD-32 parent feedback about a teacher. Behind the global bearer guard; who
 * may do what is decided in ParentFeedbackService, never here. There is no
 * teacher route. POST for every change: the shared admin-web client has no PUT.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class ParentFeedbackController {
  constructor(private readonly feedback: ParentFeedbackService) {}

  // --- the parent ---

  /** The family's children (with their teacher) and its feedback, with status and reply. */
  @NotForStaff()
  @Get('me/feedback')
  mine(@ActorId() actorId: string) {
    return this.feedback.mine(actorId);
  }

  /** { learnerId, category: praise | suggestion | complaint, body } */
  @NotForStaff()
  @Post('me/feedback')
  @HttpCode(201)
  file(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.feedback.file(actorId, body ?? {});
  }

  // --- the Teachers department and the super admin ---

  @Requires('teacher_supervision.view')
  @Get('parent-feedback')
  list(@ActorId() actorId: string, @Query('status') status?: string, @Query('category') category?: string) {
    return this.feedback.list(actorId, { status, category });
  }

  @Requires('teacher_supervision.record')
  @Post('parent-feedback/:id/take')
  take(@ActorId() actorId: string, @Param('id') id: string) {
    return this.feedback.take(actorId, id);
  }

  /** { response, resolve? } */
  @Requires('teacher_supervision.record')
  @Post('parent-feedback/:id/reply')
  reply(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.feedback.reply(actorId, id, body ?? {});
  }

  // --- a family's Parent File: also the children's supervisor ---

  @Requires('feedback.view')
  @Get('families/:familyId/parent-feedback')
  forFamily(@ActorId() actorId: string, @Param('familyId') familyId: string) {
    return this.feedback.forFamily(actorId, familyId);
  }
}
