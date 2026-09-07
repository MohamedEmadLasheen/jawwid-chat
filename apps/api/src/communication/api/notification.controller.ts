import { Body, Controller, Delete, Param, Post, UseFilters } from '@nestjs/common';
import { NotificationService } from '../notifications/notification.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('notifications')
@UseFilters(CommErrorFilter)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

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
