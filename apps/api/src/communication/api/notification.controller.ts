import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { NotificationService } from '../notifications/notification.service';
import { NotificationCenterService } from '../notifications/notification-center.service';
import { PreferenceService } from '../notifications/preference.service';
import { DeliveryService } from '../notifications/delivery.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * The notification centre, over HTTP.
 *
 * EVERY handler takes the recipient from `@ActorId()` -- the authenticated
 * actor -- and never from a parameter or a body. There is no route here through
 * which a caller can name whose notifications they want, which is why none of
 * these methods needs its own authorization check: the query is already scoped
 * to the only person it may be scoped to, and chat.notification's RLS policy
 * enforces the same rule again at the database.
 */
@Controller('notifications')
@UseFilters(CommErrorFilter)
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly centre: NotificationCenterService,
    private readonly preferences: PreferenceService,
    private readonly deliveries: DeliveryService,
  ) {}

  /**
   * History, newest first. Keyset-paginated: pass the previous page's
   * `nextCursor` back as `cursor`.
   */
  @Get()
  async list(
    @ActorId() actorId: string,
    @Query('category') category?: string,
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.centre.list(actorId, {
      category,
      unreadOnly: unread === 'true' || unread === '1',
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * The badge. Total plus a per-category breakdown in one round trip, so the
   * bell and the category tabs never disagree with each other.
   */
  @Get('unread-count')
  async unreadCount(@ActorId() actorId: string) {
    return this.centre.unreadCounts(actorId);
  }

  /** The settings screen. Categories that cannot be muted are marked, not hidden. */
  @Get('preferences')
  async preferencesList(@ActorId() actorId: string) {
    return { categories: await this.preferences.list(actorId) };
  }

  @Post('preferences')
  async setPreference(
    @ActorId() actorId: string,
    @Body() body: { category: string; pushEnabled: boolean },
  ) {
    await this.preferences.set(actorId, body.category, body.pushEnabled);
    return { ok: true };
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

  /**
   * Sign-out on one device. Scoped to the caller, so knowing somebody else's
   * token is not enough to silence their phone.
   */
  @Delete('devices/:token')
  async unregister(@ActorId() actorId: string, @Param('token') token: string) {
    await this.notifications.unregisterDevice(token, actorId);
    return { ok: true };
  }

  /**
   * Mark everything read, optionally within one category.
   *
   * Declared BEFORE the `:id` routes: `read-all` would otherwise match `:id`
   * and be looked up as a notification id.
   */
  @Post('read-all')
  async readAll(@ActorId() actorId: string, @Body() body?: { category?: string }) {
    const count = await this.centre.markAllRead(actorId, body?.category);
    return { ok: true, count };
  }

  /** Opening a thread reads its notifications. One act, not two. */
  @Post('read-conversation/:conversationId')
  async readConversation(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const count = await this.centre.markConversationRead(actorId, conversationId);
    return { ok: true, count };
  }

  /** The deep-link landing. Re-authorized here; the link itself proves nothing. */
  @Get(':id')
  async byId(@ActorId() actorId: string, @Param('id') id: string) {
    return this.centre.byId(actorId, id);
  }

  /** What support reads. Delivery diagnosis only -- no title, no body. */
  @Get(':id/deliveries')
  async deliveries_(@ActorId() actorId: string, @Param('id') id: string) {
    // byId enforces ownership; without it, any id would expose a delivery trace.
    await this.centre.byId(actorId, id);
    return { deliveries: await this.deliveries.trace(id) };
  }

  /** Idempotent: a retry preserves the first read time rather than moving it. */
  @Post(':id/read')
  async read(@ActorId() actorId: string, @Param('id') id: string) {
    const changed = await this.centre.markRead(actorId, id);
    return { ok: true, changed };
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
