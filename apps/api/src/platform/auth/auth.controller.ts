import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Req } from '@nestjs/common';
import { AuthService, DeviceInput } from './auth.service';
import { LoginRateLimiter } from './login-rate-limit';
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
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: LoginRateLimiter,
  ) {}

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

    // RESERVE FIRST, and therefore before Argon2id. The slot is consumed and
    // checked in one atomic step, so a concurrent burst cannot all pass the
    // check before any of them is counted -- the defect that let 120 requests
    // through a limit of 10. A refused caller never reaches the password check,
    // so this bounds CPU and memory as well as guessing.
    //
    // EVERY attempt spends a unit, not just a wrong password: counting only
    // INVALID_CREDENTIALS would leave a disabled or locked account as an
    // unmetered oracle for probing which of those an account is, and would let
    // credential stuffing with valid passwords run unbounded.
    await this.rateLimit.reserve(username, sourceOf(ip));

    const pair = await this.auth.login(username, password, {
      userAgent,
      ip,
      device: asDevice(body?.device),
    });

    // Only the identifier budget is released. The source budget survives a
    // success on purpose: otherwise an attacker holding one valid account could
    // reset their spray counter between bursts.
    await this.rateLimit.clearIdentifier(username);
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
    // The actor is passed so the audit row names who ended the session, which
    // chat.audit_log.actor_id exists to record.
    if (request.sessionId) await this.auth.logout(request.sessionId, request.actor?.actorId);
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

/**
 * The address the SOURCE budget is charged against.
 *
 * !! KNOWN LIMITATION, DELIBERATELY NOT PAPERED OVER !!
 *
 * This is Express's `req.ip`. Express `trust proxy` is not configured, so it is
 * the SOCKET PEER -- which behind a reverse proxy is the proxy, identically for
 * every client. The source budget therefore collapses into ONE GLOBAL BUDGET in
 * any deployment that terminates TLS ahead of the API, which turns this control
 * into a denial of service: ~30 failures from one attacker would refuse login
 * to every user.
 *
 * It is not fixed here because it CANNOT be fixed correctly from what the
 * repository documents:
 *
 *   - `docs/infrastructure/architecture.md` marks the reverse proxy PLANNED and
 *     says "TLS terminates at the proxy **or platform edge**" -- two different
 *     topologies with different hop counts;
 *   - `decisions.md` leaves the host an open recommendation ("Fly.io or
 *     Render") and states "the pipeline cannot deploy today";
 *   - no document specifies a hop count, a trusted proxy range, or which header
 *     the edge sets, and `infra/env/manifest.tsv` declares no variable for one.
 *
 * Guessing would be WORSE than the current state. `trust proxy: true` would let
 * any caller forge X-Forwarded-For and choose their own source identity --
 * evading the budget entirely, or poisoning another client's to lock them out.
 * A guessed hop count is wrong on at least one candidate platform.
 *
 * So the address stays unspoofable (nothing anywhere in this codebase reads a
 * forwarded header) and the limitation is reported rather than hidden. The
 * IDENTIFIER budget is unaffected and remains fully effective.
 */
function sourceOf(ip: string | undefined): string | undefined {
  return ip;
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
