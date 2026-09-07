import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { SessionService } from './session.service';
import { Public } from './auth.guard';
import { ActorId, CurrentActor, CurrentSessionId } from './current-actor.decorator';
import { AuthError, AuthErrorCode } from './auth.errors';
import type { Actor } from '../types';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';

interface DeviceBody {
  clientKey?: string;
  platform?: string;
  appVersion?: string;
  displayName?: string;
}

/**
 * Authentication endpoints.
 *
 * Only what the PRD's MVP calls for: subject + password, refresh, logout, "who
 * am I", session management and the password lifecycle. No public
 * registration -- accounts are provisioned by a super_admin or synced from
 * Jawwid Core.
 */
@Controller('auth')
@UseFilters(CommErrorFilter)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: { subject?: string; password?: string; device?: DeviceBody },
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    const result = await this.auth.login(
      String(body?.subject ?? ''),
      String(body?.password ?? ''),
      body?.device,
      { userAgent, ip },
    );
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
    @Body() body: { refreshToken?: string; device?: DeviceBody },
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    const result = await this.auth.refresh(String(body?.refreshToken ?? ''), body?.device, {
      userAgent,
      ip,
    });
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresInSeconds,
      actor: publicActor(result.actor),
    };
  }

  /** Log out THIS device. Only the current session is invalidated. */
  @Post('logout')
  async logout(@CurrentSessionId() sessionId: string, @ActorId() actorId: string) {
    if (sessionId) await this.auth.logout(sessionId, actorId);
    return { ok: true };
  }

  /**
   * Begin a password reset.
   *
   * ALWAYS returns the same body. Answering differently for a subject that
   * exists turns this endpoint into an account enumeration oracle, which is a
   * far more valuable thing to an attacker than the reset itself.
   *
   * The token is included in the response only outside production, where there
   * is no delivery channel to receive it and an operator has to be able to test
   * the flow. `resetToken` is absent in every deployed environment.
   */
  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() body: { subject?: string }) {
    const issued = await this.auth.beginPasswordReset(String(body?.subject ?? ''));
    const developmentOnly =
      issued && !['production', 'staging'].includes((process.env.APP_ENV ?? 'local').toLowerCase());
    return {
      ok: true,
      message: 'if that account exists, a reset has been started',
      ...(developmentOnly ? { resetToken: issued!.token } : {}),
    };
  }

  /** Complete a reset. Every session for the account is invalidated. */
  @Public()
  @Post('reset-password')
  async resetPassword(@Body() body: { token?: string; password?: string }) {
    await this.auth.completePasswordReset(String(body?.token ?? ''), String(body?.password ?? ''));
    return { ok: true };
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body() body: { token?: string }) {
    await this.accounts.verifyEmail(String(body?.token ?? ''));
    return { ok: true };
  }

  /** Change one's own password. Requires the current one; other sessions end. */
  @Post('change-password')
  async changePassword(
    @CurrentActor() actor: Actor,
    @CurrentSessionId() sessionId: string,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    if (!actor.accountId) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'this actor has no login', 403);
    }
    await this.auth.changePassword(
      actor.accountId,
      actor.actorId,
      String(body?.currentPassword ?? ''),
      String(body?.newPassword ?? ''),
      sessionId,
    );
    return { ok: true };
  }
}

/**
 * The authenticated principal, and the sessions behind it.
 *
 * `/me` lives beside login because it is the other half of it: a client that
 * cannot ask "who am I" has to trust its own cached copy of the role, and the
 * role must be server-asserted.
 */
@Controller('me')
@UseFilters(CommErrorFilter)
export class MeController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  me(@CurrentActor() actor: Actor) {
    return publicActor(actor);
  }

  @Get('sessions')
  async list(@CurrentActor() actor: Actor, @CurrentSessionId() sessionId: string) {
    if (!actor.accountId) return { sessions: [] };
    return { sessions: await this.sessions.list(actor.accountId, sessionId) };
  }

  /**
   * Revoke one of MY sessions.
   *
   * The account id is part of the query, not a check after the fact, so naming
   * another person's session id matches no row and is reported as "no such
   * session" -- a user can never revoke another user's session.
   */
  @Delete('sessions/:id')
  async revokeOne(@CurrentActor() actor: Actor, @Param('id') id: string) {
    if (!actor.accountId) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'this actor has no login', 403);
    }
    await this.sessions.revokeOwn(actor.accountId, id, 'revoked by the account holder');
    return { ok: true };
  }

  /** Log out everywhere, including this device. */
  @Delete('sessions')
  async revokeAll(@CurrentActor() actor: Actor) {
    if (!actor.accountId) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'this actor has no login', 403);
    }
    const count = await this.sessions.revokeAll(actor.accountId, 'logout all devices', {
      revokedBy: actor.actorId,
    });
    return { ok: true, revoked: count };
  }
}

/**
 * What a client is allowed to see about an actor.
 *
 * Explicitly constructed, never spread from the Actor, so a field added to the
 * internal type is not published by accident. Actor carries no phone number,
 * e-mail or address by design -- and this keeps it that way. `accountId` is
 * deliberately absent: it is a login identifier, and nothing a client does
 * needs it.
 */
export function publicActor(actor: Actor) {
  return {
    actorId: actor.actorId,
    kind: actor.kind,
    displayName: actor.displayName,
    locale: actor.locale,
    organizationId: actor.organizationId ?? null,
    staffRole: actor.staffRole ?? null,
    department: actor.department ?? null,
    familyId: actor.familyId ?? null,
    canMessage: actor.canMessage ?? null,
    permissions: [...(actor.permissions ?? [])].sort(),
  };
}
