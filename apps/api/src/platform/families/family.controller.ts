import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { FamilyService } from './family.service';
import { LabelService } from '../labels/label.service';
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
  constructor(
    private readonly families: FamilyService,
    private readonly labels: LabelService,
  ) {}

  /** The family list and the family search. One scoped query serves both. */
  /**
   * The family list, the family search AND the label filter. One scoped query
   * serves all three: `label` narrows a set that is already scoped and can
   * never widen it. Repeating the parameter INTERSECTS -- `?label=a&label=b` is
   * "carries both", which is the "VIP + Renewal" case.
   */
  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('label') label?: string | string[],
    @Query('activeOnly') activeOnly?: string,
  ) {
    const labelIds = label === undefined ? [] : Array.isArray(label) ? label : [label];
    return {
      families: await this.families.list(
        actor,
        q,
        limit ? Number(limit) : undefined,
        labelIds,
        activeOnly === 'true',
      ),
    };
  }

  /** Requires `families.assign`: creating a family names its supervisor. */
  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: { displayName?: string; supervisorId?: string; language?: string; tier?: string },
  ) {
    return this.families.createFamily(actor, {
      displayName: String(body?.displayName ?? ''),
      supervisorId: String(body?.supervisorId ?? ''),
      language: body?.language,
      tier: body?.tier,
    });
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { displayName?: string; language?: string; tier?: string },
  ) {
    return this.families.updateFamily(actor, id, body ?? {});
  }

  /**
   * Lifecycle. Two NAMED operations, never a generic state setter: `at_risk`
   * and `renewal_due` belong to the frozen renewal machinery and no Phase 3
   * route can target them.
   */
  @Post(':id/deactivate')
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string; state?: 'paused' | 'churned' },
  ) {
    return this.families.deactivateFamily(
      actor,
      id,
      String(body?.reason ?? ''),
      body?.state === 'churned' ? 'churned' : 'paused',
    );
  }

  @Post(':id/activate')
  async activate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.families.activateFamily(actor, id, String(body?.reason ?? ''));
  }

  @Get(':id/history')
  async history(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { history: await this.families.lifecycleHistory(actor, id) };
  }

  @Get(':id/labels')
  async familyLabels(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { labels: await this.labels.forFamily(actor, id) };
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
