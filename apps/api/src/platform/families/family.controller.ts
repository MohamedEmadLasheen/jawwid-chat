import { Body, Controller, Delete, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { FamilyService } from './family.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../types';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';

/**
 * Families and supervisor assignment.
 *
 * Every route derives its subject set from the authenticated actor. There is no
 * `organizationId`, `ownerId` or `staffId` filter a client can supply to widen
 * what it sees -- the only client-supplied narrowing is `q`, and narrowing a
 * scoped set cannot escape it.
 */
@Controller('families')
@UseFilters(CommErrorFilter)
export class FamilyController {
  constructor(private readonly families: FamilyService) {}

  /** The family list and the family search. One scoped query serves both. */
  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return { families: await this.families.list(actor, q, limit ? Number(limit) : undefined) };
  }

  /** Out of scope reads as NOT FOUND, so probing ids reveals nothing. */
  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.families.get(actor, id);
  }

  @Get(':id/assignments')
  async assignments(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { assignments: await this.families.assignments(actor, id) };
  }

  /**
   * Reassign the supervisor. Requires `families.assign`; the reason is
   * mandatory and is written to the audit log in the same transaction as the
   * change.
   */
  @Post(':id/assignment')
  async assign(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { staffId?: string; reason?: string },
  ) {
    return this.families.assignSupervisor(
      actor,
      id,
      String(body?.staffId ?? ''),
      String(body?.reason ?? ''),
    );
  }

  /** Temporary cover, with an explicit end. PD-3: a schedule is not a grant. */
  @Post(':id/cover')
  async cover(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { staffId?: string; endsAt?: string; reason?: string },
  ) {
    return this.families.startCover(
      actor,
      id,
      String(body?.staffId ?? ''),
      new Date(String(body?.endsAt ?? '')),
      String(body?.reason ?? ''),
    );
  }

  @Delete('assignments/:assignmentId')
  async endCover(
    @CurrentActor() actor: Actor,
    @Param('assignmentId') assignmentId: string,
    @Query('reason') reason = 'cover ended',
  ) {
    await this.families.endCover(actor, assignmentId, reason);
    return { ok: true };
  }
}
