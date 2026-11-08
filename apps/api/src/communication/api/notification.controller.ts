import { Body, Controller, Delete, Param, Post, Req, UseFilters } from '@nestjs/common';
import { NotificationService } from '../notifications/notification.service';
import type { AuthenticatedRequest } from '../../platform/auth/auth.guard';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { SelfService } from '../../platform/permissions/route-access';

@Controller('notifications')
@UseFilters(CommErrorFilter)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * Register a push token. One actor may hold many.
   *
   * LR-46: bound to the caller's CURRENT session (from the verified token, as
   * the actor is), so signing that session out stops its pushes. The fields
   * are picked one by one: a body is never spread into the call, so it cannot
   * name an actor or a session.
   */
  @SelfService()
  @Post('devices')
  async register(
    @ActorId() actorId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { token: string; platform: string; isVoip?: boolean; locale?: string },
  ) {
    await this.notifications.registerDevice({
      actorId,
      sessionId: request.sessionId ?? null,
      token: body?.token,
      platform: body?.platform,
      isVoip: body?.isVoip,
      locale: body?.locale,
    });
    return { ok: true };
  }

  /**
   * Retire one of your OWN device tokens. Scoped to the authenticated actor:
   * a token belonging to anyone else matches nothing and nothing happens.
   */
  @SelfService()
  @Delete('devices/:token')
  async unregister(@ActorId() actorId: string, @Param('token') token: string) {
    await this.notifications.unregisterDevice(token, actorId);
    return { ok: true };
  }

  /** Delivery and open are reported by the client; they are never inferred. */
  @SelfService()
  @Post(':id/delivered')
  async delivered(@ActorId() actorId: string, @Param('id') id: string) {
    await this.notifications.markDelivered(id, actorId);
    return { ok: true };
  }

  @SelfService()
  @Post(':id/opened')
  async opened(@ActorId() actorId: string, @Param('id') id: string) {
    await this.notifications.markOpened(id, actorId);
    return { ok: true };
  }
}
