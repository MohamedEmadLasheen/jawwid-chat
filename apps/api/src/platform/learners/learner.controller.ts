import { Body, Controller, Get, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { LearnerService } from './learner.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../types';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';

/**
 * Students, and who teaches them.
 *
 * Every route derives its subject set from the authenticated actor. A student
 * outside the actor's scope answers NOT FOUND, identically to one that does not
 * exist, so ids cannot be probed.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class LearnerController {
  constructor(private readonly learners: LearnerService) {}

  @Get('families/:familyId/learners')
  async list(
    @CurrentActor() actor: Actor,
    @Param('familyId') familyId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return {
      learners: await this.learners.listForFamily(actor, familyId, includeInactive !== 'false'),
    };
  }

  @Post('families/:familyId/learners')
  async create(
    @CurrentActor() actor: Actor,
    @Param('familyId') familyId: string,
    @Body() body: { name?: string; level?: string | null },
  ) {
    return this.learners.create(actor, familyId, {
      name: String(body?.name ?? ''),
      level: body?.level ?? null,
    });
  }

  @Get('learners/:id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.learners.get(actor, id);
  }

  @Patch('learners/:id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { name?: string; level?: string | null },
  ) {
    return this.learners.update(actor, id, body ?? {});
  }

  /** Lifecycle. Never a delete: history and relationships are preserved. */
  @Post('learners/:id/deactivate')
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.learners.deactivate(actor, id, String(body?.reason ?? ''));
  }

  @Post('learners/:id/activate')
  async activate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.learners.activate(actor, id, String(body?.reason ?? ''));
  }

  /**
   * Assign or transfer the teacher. ONE route, because it is one act -- an
   * assignment is simply the case with no previous teacher. Returns the full
   * history so a client renders current and past from a single response and
   * cannot show a stale "current".
   */
  @Post('learners/:id/teacher')
  async assignTeacher(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { teacherId?: string; reason?: string },
  ) {
    return {
      assignments: await this.learners.assignTeacher(
        actor,
        id,
        String(body?.teacherId ?? ''),
        String(body?.reason ?? ''),
      ),
    };
  }

  @Get('learners/:id/teacher-history')
  async teacherHistory(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { assignments: await this.learners.teacherHistory(actor, id) };
  }
}
