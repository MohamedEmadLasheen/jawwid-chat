import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Req } from '@nestjs/common';
import { AuthService, DeviceInput } from './auth.service';
import { Public, type AuthenticatedRequest } from './auth.guard';
import { AuthError, AuthErrorCode } from './auth.errors';
import { toActorDto, toTokenPairDto, type ActorDto, type TokenPairDto } from './auth.dto';

interface LoginBody {
  username?: unknown;
  password?: unknown;
  device?: { platform?: unknown; name?: unknown; appVersion?: unknown };
}

interface RefreshBody {
  refreshToken?: unknown;
}

/**
 * Authentication endpoints (API-CONTRACT §3.1).
 *
 * Only what the MVP calls for: username + password, refresh, logout. No public
 * registration and no OTP reset, by design (PRD §7.1).
 *
 * Login and refresh are the only `@Public()` routes in the application. Every
 * other route in every other controller is protected by the global guard
 * without having been touched.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginBody,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ): Promise<TokenPairDto> {
    // Validated here rather than by a pipe so a malformed body is an
    // INVALID_CREDENTIALS 401 like any other failed login, not a 400 that
    // tells a prober their request shape was interesting.
    const username = asString(body?.username);
    const password = asString(body?.password);
    if (!username || !password) throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);

    const pair = await this.auth.login(username, password, {
      userAgent,
      ip,
      device: asDevice(body?.device),
    });
    return toTokenPairDto(pair);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshBody,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ): Promise<TokenPairDto> {
    const token = asString(body?.refreshToken);
    if (!token) throw new AuthError(AuthErrorCode.SESSION_REVOKED);

    const pair = await this.auth.refresh(token, { userAgent, ip });
    return toTokenPairDto(pair);
  }

  /**
   * Not public: logging out requires proving which session to end. Reading the
   * session id from the verified token rather than the body is what stops one
   * client revoking another's session.
   */
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: AuthenticatedRequest): Promise<{ ok: true }> {
    if (request.sessionId) await this.auth.logout(request.sessionId);
    return { ok: true };
  }
}

/**
 * The authenticated principal (API-CONTRACT §3.2).
 *
 * The other half of logging in: a client that cannot ask "who am I" has to
 * trust its own cached copy of the role, and the role must be server-asserted.
 *
 * The actor comes from `request.actor`, which only the guard writes, which
 * only a verified token produces. There is no parameter, header or body field
 * that can change whose identity is returned.
 */
@Controller('me')
export class MeController {
  @Get()
  me(@Req() request: AuthenticatedRequest): ActorDto {
    if (!request.actor) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    return toActorDto(request.actor);
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asDevice(value: LoginBody['device']): DeviceInput | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const platform = asString(value.platform);
  if (!platform) return undefined;
  return {
    platform,
    name: asString(value.name) || undefined,
    appVersion: asString(value.appVersion) || undefined,
  };
}
