import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { StoryService } from '../stories/story.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import type { AudienceClause } from '../audience/audience-resolver.service';

/**
 * Stories.
 *
 * Note what no route accepts: a recipient list. A client states an AUDIENCE
 * ("the Installments label, plus this group") and the server resolves it. A
 * client that sent actor ids would be sending a field no code path reads.
 */
@Controller('stories')
@UseFilters(CommErrorFilter)
export class StoryController {
  constructor(private readonly stories: StoryService) {}

  /** The reader's feed: the live stories published to THEM. */
  @Get('feed')
  async feed(@ActorId() actorId: string) {
    return { stories: await this.stories.feed(actorId) };
  }

  /** The publisher's list, with delivery and view counts. */
  @Get()
  async list(@ActorId() actorId: string, @Query('drafts') drafts?: string) {
    return { stories: await this.stories.list(actorId, drafts !== 'false') };
  }

  @Post('media')
  async media(
    @ActorId() actorId: string,
    @Body() body: { mimeType: string; byteSize: number },
  ) {
    return this.stories.authorizeMediaUpload(actorId, body);
  }

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
      audiences: AudienceClause[];
    },
  ) {
    return this.stories.create(actorId, {
      title: body.title,
      body: body.body,
      mediaObjectKey: body.mediaObjectKey,
      mediaKind: body.mediaKind,
      mediaMime: body.mediaMime,
      audiences: body.audiences ?? [],
    });
  }

  /** Resolve the audience and go live. Manager/Admin only, checked server-side. */
  @Post(':id/publish')
  async publish(@ActorId() actorId: string, @Param('id') id: string) {
    return this.stories.publish(id, actorId);
  }

  @Post(':id/view')
  async view(@ActorId() actorId: string, @Param('id') id: string) {
    return this.stories.markViewed(id, actorId);
  }
}
