import { Body, Controller, Delete, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { StoryService } from '../stories/story.service';
import type { AudienceClause } from '../stories/story-audience.resolver';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * Stories.
 *
 * ## What no route accepts
 *
 * A RECIPIENT LIST. A client states an AUDIENCE ("all families", "this class
 * group") and the server resolves it. There is no field on any of these routes
 * through which a caller could name an actor id, so "may this publisher push a
 * story at an arbitrary person?" is not a check that can be forgotten -- it is
 * unrepresentable.
 *
 * AN ACTOR ID. Every handler takes the authenticated actor from `@ActorId()`,
 * which reads `request.actor` -- written only by AuthenticatedGuard from a
 * verified bearer token. `/stories/feed` therefore cannot be asked for somebody
 * else's feed.
 *
 * A `state` OR `expired` FILTER on the reader path. The feed decides what is
 * live; a client cannot ask to see expired stories, because the query that
 * answers it requires `expires_at > now()`.
 */
@Controller('stories')
@UseFilters(CommErrorFilter)
export class StoryController {
  constructor(private readonly stories: StoryService) {}

  /** The reader's own feed: the live stories published to THEM. */
  @Get('feed')
  async feed(@ActorId() actorId: string) {
    return { stories: await this.stories.feed(actorId) };
  }

  /** The publisher's list, with delivery and view counts. Publisher-only. */
  @Get()
  async list(@ActorId() actorId: string, @Query('drafts') drafts?: string) {
    return { stories: await this.stories.list(actorId, drafts !== 'false') };
  }

  /**
   * Authorize a media upload and return a signed, size- and type-bound PUT URL.
   * The bytes never pass through this API when storage is S3.
   */
  @Post('media')
  async media(
    @ActorId() actorId: string,
    @Body() body: { mimeType: string; byteSize: number },
  ) {
    return this.stories.authorizeMediaUpload(actorId, {
      mimeType: body?.mimeType,
      byteSize: Number(body?.byteSize),
    });
  }

  /** Create a draft. The audience is validated now and resolved at publish. */
  @Post()
  async create(
    @ActorId() actorId: string,
    @Body()
    body: {
      title?: string;
      body?: string;
      mediaObjectKey?: string;
      mediaKind?: string;
      mediaMime?: string;
      audiences?: AudienceClause[];
    },
  ) {
    return this.stories.create(actorId, {
      title: body?.title,
      body: body?.body,
      mediaObjectKey: body?.mediaObjectKey,
      mediaKind: body?.mediaKind,
      mediaMime: body?.mediaMime,
      audiences: body?.audiences ?? [],
    });
  }

  /** Resolve the audience and go live. Publisher-only, checked server-side. */
  @Post(':id/publish')
  async publish(@ActorId() actorId: string, @Param('id') id: string) {
    return this.stories.publish(id, actorId);
  }

  /** Record that the caller watched this story. Idempotent. */
  @Post(':id/view')
  async view(@ActorId() actorId: string, @Param('id') id: string) {
    return this.stories.markViewed(id, actorId);
  }

  /**
   * Who viewed this story. Publisher-only.
   *
   * Deliberately not available to recipients: a viewer list says which named
   * parent opened which publication and when, and a parent is not the owner of an
   * academy publication.
   */
  @Get(':id/viewers')
  async viewers(@ActorId() actorId: string, @Param('id') id: string) {
    return { viewers: await this.stories.viewers(id, actorId) };
  }

  /**
   * Remove a story. Soft: access ends immediately, the row survives as the audit
   * trail, and the media is purged by the retention sweep.
   *
   * The reason is required and is recorded in chat.audit_log, which is this
   * schema's rule for every sensitive action. It travels as a query parameter,
   * matching `MessageController.deleteForEveryone` -- a DELETE body is legal but
   * is stripped by enough proxies that the repo does not rely on one. Unlike
   * message deletion there is no default: an academy publication being removed
   * without a stated reason is a gap in the audit trail, not a convenience.
   */
  @Delete(':id')
  async remove(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Query('reason') reason = '',
  ) {
    return this.stories.remove(id, actorId, reason);
  }
}
