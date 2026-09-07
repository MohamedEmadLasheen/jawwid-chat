import { Body, Controller, Delete, Get, Param, Post, Put, UseFilters } from '@nestjs/common';
import { NotificationService } from '../notifications/notification.service';
import {
  NotificationCategory,
  NotificationPreferenceService,
} from '../notifications/preference.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('notifications')
@UseFilters(CommErrorFilter)
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  /**
   * What this person has chosen, with the defaults filled in.
   *
   * Always the full list, so a settings screen renders the same categories
   * whether or not anything has been chosen -- and so the client never has to
   * know what the default is. Scoped to the caller: there is no route that
   * reads somebody else's preferences, and the row-level policy on the table
   * refuses one anyway.
   */
  @Get('preferences')
  async readPreferences(@ActorId() actorId: string) {
    return { preferences: await this.preferences.forActor(actorId) };
  }

  /** Record a choice. The caller's own, and only the caller's own. */
  @Put('preferences/:category')
  async writePreference(
    @ActorId() actorId: string,
    @Param('category') category: string,
    @Body() body: { enabled?: boolean },
  ) {
    if (!Object.values(NotificationCategory).includes(category as NotificationCategory)) {
      throw new CommError(
        CommErrorCode.NOTIFICATION_PREFERENCE_INVALID,
        `unknown notification category ${category}`,
        400,
      );
    }
    if (typeof body?.enabled !== 'boolean') {
      throw new CommError(CommErrorCode.NOTIFICATION_PREFERENCE_INVALID, 'enabled must be a boolean', 400);
    }

    await this.preferences.set(actorId, category as NotificationCategory, body.enabled);
    return { preferences: await this.preferences.forActor(actorId) };
  }

  /** Register a push token. One actor may hold many. */
  @Post('devices')
  async register(
    @ActorId() actorId: string,
    @Body() body: { token: string; platform: string; isVoip?: boolean; locale?: string },
  ) {
    await this.notifications.registerDevice({ actorId, ...body });
    return { ok: true };
  }

  @Delete('devices/:token')
  async unregister(@ActorId() actorId: string, @Param('token') token: string) {
    await this.notifications.unregisterDevice(token, actorId);
    return { ok: true };
  }

  /** Delivery and open are reported by the client; they are never inferred. */
  @Post(':id/delivered')
  async delivered(@ActorId() actorId: string, @Param('id') id: string) {
    await this.notifications.markDelivered(id, actorId);
    return { ok: true };
  }

  @Post(':id/opened')
  async opened(@ActorId() actorId: string, @Param('id') id: string) {
    await this.notifications.markOpened(id, actorId);
    return { ok: true };
  }
}
