import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './auth.guard';
import type { Actor } from '../types';

interface LoginBody {
  subject?: string;
  password?: string;
}

/**
 * Authentication endpoints (D-6).
 *
 * Only what the PRD's MVP calls for: username + password, refresh, logout, and
 * "who am I". No public registration and no OTP reset, by design.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginBody, @Headers('user-agent') userAgent?: string) {
    const result = await this.auth.login(body?.subject ?? '', body?.password ?? '', userAgent);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresInSeconds,
      actor: publicActor(result.actor),
    };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() body: { refreshToken?: string },
    @Headers('user-agent') userAgent?: string,
  ) {
    const result = await this.auth.refresh(body?.refreshToken ?? '', userAgent);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresInSeconds,
      actor: publicActor(result.actor),
    };
  }

  @Post('logout')
  async logout(@Req() req: { sessionId?: string }) {
    if (req.sessionId) await this.auth.logout(req.sessionId);
    return { ok: true };
  }
}

/**
 * The authenticated principal.
 *
 * Lives here rather than in a separate controller because it is the other half
 * of logging in: a client that cannot ask "who am I" has to trust its own
 * cached copy of the role, and the role must be server-asserted.
 */
@Controller('me')
export class MeController {
  @Get()
  me(@Req() req: { actor: Actor }) {
    return publicActor(req.actor);
  }
}

/**
 * What a client is allowed to see about an actor.
 *
 * Explicitly constructed, never spread from the Actor, so a field added to the
 * internal type is not published by accident. Actor carries no phone number,
 * email or address by design -- and this keeps it that way.
 */
function publicActor(actor: Actor) {
  return {
    actorId: actor.actorId,
    kind: actor.kind,
    displayName: actor.displayName,
    locale: actor.locale,
    staffRole: actor.staffRole ?? null,
    familyId: actor.familyId ?? null,
    canMessage: actor.canMessage ?? null,
  };
}
