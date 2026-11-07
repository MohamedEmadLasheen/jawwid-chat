import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SelfService } from '../platform/permissions/route-access';
import { RequiresLegal } from '../legal/requires-legal.decorator';
import { BlocksService } from './blocks.service';

/**
 * PD-57 WP-2 (closure plan 2026-11-06 §5, roadmap §6.2): the blocker's routes.
 * Self-service for any signed-in principal so that the service answers staff
 * with 403 COMM.BLOCK_NOT_ALLOWED (`reason: staff_caller`); only a parent or a
 * teacher ever blocks. Not on the support-session allowlist (§6), so a support
 * session is refused before the handler runs (and by the service without it).
 */
@Controller('me/blocks')
@UseFilters(CommErrorFilter)
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  /**
   * `{subject: {kind, id}}` -> 201 `{id, subject: {kind, id, name}, createdAt}`; 200 when already blocked.
   * PD-58 (MG-1): 403 COMM.TERMS_NOT_ACCEPTED until the blocker accepted the current terms.
   */
  @SelfService()
  @RequiresLegal()
  @Post()
  async block(@ActorId() actorId: string, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const made = await this.blocks.block(actorId, body ?? {});
    res.status(made.status);
    return made.body;
  }

  /** `[{id, subject: {kind, id, name, avatar?}, createdAt}]`, newest first. */
  @SelfService()
  @Get()
  mine(@ActorId() actorId: string) {
    return this.blocks.mine(actorId);
  }

  /** 204; 404 when it is not the caller's block. */
  @SelfService()
  @Delete(':id')
  @HttpCode(204)
  async unblock(@ActorId() actorId: string, @Param('id') id: string): Promise<void> {
    await this.blocks.unblock(actorId, id);
  }
}
