import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ApprovalService } from '../approvals/approval.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('approvals')
@UseFilters(CommErrorFilter)
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  /** The approval queue. Staff only. */
  @Get('pending')
  async pending(@ActorId() actorId: string, @Query('conversationId') conversationId?: string) {
    return { approvals: await this.approvals.listPending(actorId, conversationId) };
  }

  /** What the sender sees about their own held messages. */
  @Get('mine')
  async mine(@ActorId() actorId: string) {
    return { approvals: await this.approvals.listMine(actorId) };
  }

  @Post(':id/approve')
  async approve(@ActorId() actorId: string, @Param('id') id: string) {
    await this.approvals.approve(id, actorId);
    return { ok: true };
  }

  /** A rejection must state a reason; the approver never edits the message. */
  @Post(':id/reject')
  async reject(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.approvals.reject(id, actorId, body.reason);
    return { ok: true };
  }

  @Get('history/:conversationId')
  async history(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return { history: await this.approvals.history(conversationId, actorId) };
  }
}
