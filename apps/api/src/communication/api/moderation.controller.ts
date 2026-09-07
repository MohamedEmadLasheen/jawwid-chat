import { Body, Controller, Get, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { ApprovalService } from '../approvals/approval.service';
import {
  ModerationRuleService,
  type CreateRuleInput,
  type UpdateRuleInput,
} from '../moderation/moderation-rule.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * The moderation surface: the queue's Phase 6 actions, and the rule catalogue.
 *
 * ## Why the queue's LIST is not here
 *
 * `GET /approvals/pending` already exists on ApprovalController, already
 * scopes correctly (red-team A-2), and the mobile client already calls it. A
 * second listing endpoint would be a second set of scope rules to keep in step
 * with the first, which is how the queue became globally visible the first
 * time. The queue is enriched in place; only the ACTIONS Phase 6 added are new
 * routes, and they live here beside rule management because they are the same
 * operator's work.
 *
 * ## Every route is authorized in the service
 *
 * Nothing below decides anything. The controller's whole job is to name the
 * operation and hand it the actor id the interceptor resolved from the signed
 * token -- never from a header, a body or a query parameter.
 */
@Controller('moderation')
@UseFilters(CommErrorFilter)
export class ModerationController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly rules: ModerationRuleService,
  ) {}

  // -------------------------------------------------------------------
  // The queue
  // -------------------------------------------------------------------

  /**
   * The queue, with the Phase 6 filters.
   *
   * `escalated=true` is the manager's view of what the ordinary queue failed
   * to clear -- a filter on the same scoped query, not a separate endpoint.
   */
  @Get('queue')
  async queue(
    @ActorId() actorId: string,
    @Query('conversationId') conversationId?: string,
    @Query('escalated') escalated?: string,
    @Query('severity') severity?: string,
    @Query('trigger') trigger?: string,
  ) {
    const items = await this.approvals.listPending(actorId, conversationId, {
      escalatedOnly: escalated === 'true',
      severity,
      trigger,
    });
    return { items };
  }

  /**
   * EDIT THEN SEND.
   *
   * The original is written to chat.message_revision revision 1 before the body
   * is replaced, so what the sender actually wrote survives this call
   * permanently. The edited body is re-scanned first: an approver who removed
   * one of two phone numbers has not fixed the message, and this must not
   * become the one path by which unscanned content reaches a family.
   */
  @Post('queue/:id/edit-and-send')
  async editAndSend(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { body: string; reason?: string },
  ) {
    await this.approvals.editThenSend(id, actorId, body?.body ?? '', body?.reason);
    return { ok: true };
  }

  /**
   * DELETE a held message: reject it, and soft-delete it through the existing
   * deletion architecture. Requires `messages.delete` (manager and above),
   * checked in the service.
   */
  @Post('queue/:id/delete')
  async remove(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.approvals.deleteHeld(id, actorId, body?.reason ?? '');
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // The rules
  // -------------------------------------------------------------------

  /** Readable by anyone who may decide an approval; writable by managers. */
  @Get('rules')
  async listRules(@ActorId() actorId: string, @Query('enabled') enabled?: string) {
    return { rules: await this.rules.list(actorId, enabled !== 'true') };
  }

  @Post('rules')
  async createRule(@ActorId() actorId: string, @Body() body: CreateRuleInput) {
    // The fields are enumerated rather than spread, so a client cannot set
    // `isBuiltin`, `createdBy` or an organization it does not belong to by
    // adding them to the request body.
    return {
      rule: await this.rules.create(actorId, {
        name: body?.name,
        category: body?.category,
        severity: body?.severity,
        matchType: body?.matchType,
        pattern: body?.pattern,
        isEnabled: body?.isEnabled,
        notes: body?.notes,
      }),
    };
  }

  @Patch('rules/:id')
  async updateRule(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: UpdateRuleInput,
  ) {
    return {
      rule: await this.rules.update(actorId, id, {
        name: body?.name,
        category: body?.category,
        severity: body?.severity,
        matchType: body?.matchType,
        pattern: body?.pattern,
        isEnabled: body?.isEnabled,
        notes: body?.notes,
      }),
    };
  }

  /**
   * Enable or disable, as its own route.
   *
   * The operation an operator actually performs when a rule is producing noise:
   * one call, no edit form. There is deliberately no DELETE route anywhere on
   * this controller -- a rule is disabled, never removed, so that the flags
   * referencing it keep pointing at something. chat_app holds no DELETE
   * privilege on the table either, so the absence of this route is not the only
   * thing enforcing it.
   */
  @Post('rules/:id/enabled')
  async setEnabled(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return { rule: await this.rules.setEnabled(actorId, id, body?.enabled === true) };
  }
}
