import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { LabelService } from './label.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../types';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';

@Controller('labels')
@UseFilters(CommErrorFilter)
export class LabelController {
  constructor(private readonly labels: LabelService) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    return { labels: await this.labels.list(actor) };
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: { name?: string; color?: string | null; description?: string | null },
  ) {
    return this.labels.create(actor, {
      name: String(body?.name ?? ''),
      color: body?.color ?? null,
      description: body?.description ?? null,
    });
  }

  /** Editing keeps the label's identity: every family stays filed under it. */
  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { name?: string; color?: string | null; description?: string | null },
  ) {
    return this.labels.update(actor, id, body ?? {});
  }

  /** Soft. Never reaches a family, a student, a conversation or any history. */
  @Delete(':id')
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('reason') reason = '') {
    return this.labels.remove(actor, id, reason);
  }

  /**
   * Bulk filing. Returns an outcome for EVERY id supplied, so a partially
   * valid input reports exactly what happened instead of failing whole.
   */
  @Post(':id/families')
  async addFamilies(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { familyIds?: string[] },
  ) {
    return { outcomes: await this.labels.addFamilies(actor, id, body?.familyIds ?? []) };
  }

  /**
   * POST rather than DELETE-with-body: a request body on DELETE is poorly
   * supported by intermediaries and is not part of this repository's client
   * contract (`admin-web/src/core/api/client.ts` sends none). The operation is
   * still idempotent -- removing an absent association reports `already`.
   */
  @Post(':id/families/remove')
  async removeFamilies(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { familyIds?: string[] },
  ) {
    return { outcomes: await this.labels.removeFamilies(actor, id, body?.familyIds ?? []) };
  }
}
