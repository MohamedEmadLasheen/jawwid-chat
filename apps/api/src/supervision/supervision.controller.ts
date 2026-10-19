import { Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SupervisionConversationService } from './supervision-conversation.service';

/** PD-11 / PD-12: opening a teacher supervision conversation, and its "+" menu. */
@Controller()
@UseFilters(CommErrorFilter)
export class SupervisionController {
  constructor(private readonly supervision: SupervisionConversationService) {}

  /** The calling teacher's own; created on first use. */
  @Post('me/supervision-conversation')
  ensureOwn(@ActorId() actorId: string) {
    return this.supervision.ensureOwn(actorId);
  }

  /** The Teachers department opens one teacher's. */
  @Post('teachers/:teacherId/supervision-conversation')
  ensureForTeacher(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.supervision.ensureForTeacher(actorId, teacherId);
  }

  /** ...or every active teacher's at once. */
  @Post('supervision-conversations/ensure-all')
  ensureAll(@ActorId() actorId: string) {
    return this.supervision.ensureAll(actorId);
  }

  /** What the caller may file under "+" here. Advisory. */
  @Get('conversations/:id/supervision-tickets')
  tickets(@ActorId() actorId: string, @Param('id') id: string) {
    return this.supervision.ticketsFor(actorId, id);
  }
}
