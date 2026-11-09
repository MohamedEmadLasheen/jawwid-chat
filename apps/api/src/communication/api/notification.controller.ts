import { Body, Controller, Delete, Param, Post, Req, UseFilters } from '@nestjs/common';
import { CommError, CommErrorCode } from '../../platform/errors';
import { NotificationService } from '../notifications/notification.service';
import type { AuthenticatedRequest } from '../../platform/auth/auth.guard';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { SelfService } from '../../platform/permissions/route-access';

/** The values `chat.device_token` accepts (its CHECK constraints). */
const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;
const DEVICE_LOCALES = ['ar', 'en'] as const;
/** APNs tokens are 64 hex characters and FCM tokens a few hundred; this is a generous ceiling. */
const MAX_DEVICE_TOKEN_LENGTH = 4096;

type DeviceRegistration = {
  token: string;
  platform: (typeof DEVICE_PLATFORMS)[number];
  isVoip?: boolean;
  locale?: (typeof DEVICE_LOCALES)[number];
};

function invalid(message: string): CommError {
  return new CommError(CommErrorCode.VALIDATION, message, 400);
}

/**
 * The body of `POST /notifications/devices`, whitelisted and type-checked.
 * Only these four fields are read; anything else in the body is ignored.
 * An optional field sent as `null` is treated as omitted.
 */
export function parseDeviceRegistration(body: unknown): DeviceRegistration {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('body must be an object');
  }
  const b = body as Record<string, unknown>;

  const { token, platform, isVoip, locale } = b;
  if (typeof token !== 'string' || token.trim() === '') {
    throw invalid('token must be a non-empty string');
  }
  if (token.length > MAX_DEVICE_TOKEN_LENGTH) {
    throw invalid(`token must be at most ${MAX_DEVICE_TOKEN_LENGTH} characters`);
  }
  if (typeof platform !== 'string' || !(DEVICE_PLATFORMS as readonly string[]).includes(platform)) {
    throw invalid(`platform must be one of: ${DEVICE_PLATFORMS.join(', ')}`);
  }

  const out: DeviceRegistration = { token, platform: platform as DeviceRegistration['platform'] };
  if (isVoip !== undefined && isVoip !== null) {
    if (typeof isVoip !== 'boolean') throw invalid('isVoip must be true or false');
    out.isVoip = isVoip;
  }
  if (locale !== undefined && locale !== null) {
    if (typeof locale !== 'string' || !(DEVICE_LOCALES as readonly string[]).includes(locale)) {
      throw invalid(`locale must be one of: ${DEVICE_LOCALES.join(', ')}`);
    }
    out.locale = locale as DeviceRegistration['locale'];
  }
  return out;
}

@Controller('notifications')
@UseFilters(CommErrorFilter)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * Register a push token. One actor may hold many.
   *
   * The device is ALWAYS registered to the authenticated caller: the service
   * input is built field by field from a whitelisted, type-checked body, and
   * `actorId` comes from the principal only. Nothing in the body is spread
   * (there is no global ValidationPipe, so this is the only shape check).
   *
   * LR-46: it is bound to the caller's CURRENT session, taken from the verified
   * request as the actor is (never from the body), so signing that session out
   * stops its pushes.
   */
  @SelfService()
  @Post('devices')
  async register(
    @ActorId() actorId: string,
    @Body() body: unknown,
    @Req() request: Pick<AuthenticatedRequest, 'sessionId'>,
  ) {
    const device = parseDeviceRegistration(body);
    await this.notifications.registerDevice({ ...device, actorId, sessionId: request.sessionId ?? null });
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
