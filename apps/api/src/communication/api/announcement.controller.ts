import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { AnnouncementService, CreateAnnouncementInput } from '../announcements/announcement.service';
import { ActorId, CurrentActor } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import type { Actor } from '../../platform/types';

/**
 * Academy announcements.
 *
 * The write routes are staff-only, checked in AnnouncementService against the
 * resolved actor's role and again by a trigger on chat.announcement for the
 * urgent priority. The read route is the parent's deep-link landing and is
 * authorized by the existence of a notification addressed to them -- never by
 * the announcement's own targeting, which would tell one family who else was
 * written to.
 */
@Controller('announcements')
@UseFilters(CommErrorFilter)
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateAnnouncementInput & { publishAt?: string; expiresAt?: string },
  ) {
    return this.announcements.create(actor, {
      ...body,
      publishAt: body.publishAt ? new Date(body.publishAt) : undefined,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
  }

  /**
   * Publish. Returns immediately: the fan-out runs on the worker sweep, so an
   * announcement to every parent in the academy is not something an admin waits
   * on an HTTP request for.
   */
  @Post(':id/publish')
  async publish(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.announcements.publish(actor, id);
  }

  @Post(':id/cancel')
  async cancel(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.announcements.cancel(actor, id);
  }

  /** The parent's view. Explicit field mapping; targeting never leaves the server. */
  @Get(':id')
  async read(@ActorId() actorId: string, @Param('id') id: string) {
    return this.announcements.readForActor(actorId, id);
  }
}
