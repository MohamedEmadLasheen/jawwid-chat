import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentActor } from './actor.decorator';
import type { Actor } from '../../platform/types';
import { NotificationInboxService } from '../notifications/notification-inbox.service';
import { SelfService } from '../../platform/permissions/route-access';

/**
 * PD-34: the caller's own Notification Center and notification settings.
 * Nobody reads or changes another person's here; see NotificationInboxService.
 */
@Controller('me')
export class NotificationInboxController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @SelfService()
  @Get('notifications')
  list(@CurrentActor() actor: Actor, @Query() query: { tab?: string; before?: string; limit?: string }) {
    return this.inbox.list(actor, query ?? {});
  }

  @SelfService()
  @Get('notifications/counts')
  counts(@CurrentActor() actor: Actor) {
    return this.inbox.counts(actor);
  }

  @SelfService()
  @Post('notifications/read')
  read(@CurrentActor() actor: Actor, @Body() body: { ids?: unknown; all?: unknown; tab?: unknown }) {
    return this.inbox.markRead(actor, body ?? {});
  }

  @SelfService()
  @Post('notifications/:id/acted')
  acted(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.inbox.acted(actor, id);
  }

  @SelfService()
  @Get('notification-settings')
  settings(@CurrentActor() actor: Actor) {
    return this.inbox.settings(actor);
  }

  @SelfService()
  @Put('notification-settings')
  setSettings(@CurrentActor() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.inbox.setSettings(actor, body ?? {});
  }
}
