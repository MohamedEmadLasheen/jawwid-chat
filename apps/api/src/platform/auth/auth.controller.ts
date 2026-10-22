import { Body, Controller, Get, Headers, HttpCode, Inject, Ip, Optional, Param, Post, Req, UseFilters } from '@nestjs/common';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';
import { CommError, CommErrorCode } from '../errors';
import { AuthService, DeviceInput } from './auth.service';
import { LoginRateLimiter } from './login-rate-limit';
import { Public, type AuthenticatedRequest } from './auth.guard';
import { AuthError, AuthErrorCode } from './auth.errors';
import { toActorDto, toSessionListDto, toTokenPairDto, type ActorDto, type SessionDto, type TokenPairDto } from './auth.dto';
import {
  CLIENT_ADDRESS_POLICY,
  readClientAddressPolicy,
  sourceAddress,
  type ClientAddressPolicy,
} from './client-address';

interface LoginBody {
  username?: unknown;
  password?: unknown;
  device?: { platform?: unknown; name?: unknown; appVersion?: unknown };
  /** PD-23: Admin Web "keep me signed in on this device". Only `true` asks. */
  remember?: unknown;
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
  /**
   * Resolved once, at construction. A per-request read would let the source
   * dimension be switched on or off by mutating the environment of a running
   * process, which is not a thing a security control should permit.
   */
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    // The fallback is for direct construction in unit tests. Under Nest the
    // provider in auth.module.ts always supplies it, and @Optional() exists so
    // that a missing provider degrades to reading the environment rather than
    // failing the boot -- both paths call the same parser.
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

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
    await this.rateLimit.reserve(username, sourceAddress(ip, this.addressPolicy));

    const pair = await this.auth.login(username, password, {
      userAgent,
      ip,
      device: asDevice(body?.device),
      remember: body?.remember === true,
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
 * PD-23: Devices & sessions -- the signed-in person's own live sessions.
 *
 * Everything is keyed by the VERIFIED request: the account and the current
 * session come from the guard, never from a parameter. A session id in the
 * path only selects among the caller's own; another account's id is answered
 * exactly like a made-up one (SESSION_NOT_FOUND).
 *
 * A support session (PD-21) can list but not revoke: these are writes, and the
 * support-session allowlist does not name them.
 */
@Controller('me/sessions')
@UseFilters(CommErrorFilter)
export class MeSessionsController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest): Promise<{ sessions: SessionDto[] }> {
    const { accountId, sessionId } = verified(request);
    return toSessionListDto(await this.auth.listLiveSessions(accountId), sessionId);
  }

  /** Revoking the CURRENT session is signing out; the client then clears itself. */
  @Post(':sessionId/revoke')
  @HttpCode(200)
  async revoke(@Req() request: AuthenticatedRequest, @Param('sessionId') target: string): Promise<{ ok: true }> {
    const { accountId, sessionId, actorId } = verified(request);
    const reason = target === sessionId ? 'logout' : SIGNED_OUT_BY_HOLDER;
    const ended = await this.auth.revokeSessionOf(accountId, target, reason, { revokedBy: accountId, actorId });
    if (!ended) throw new CommError(CommErrorCode.SESSION_NOT_FOUND, 'no such session');
    return { ok: true };
  }

  @Post('revoke-others')
  @HttpCode(200)
  async revokeOthers(@Req() request: AuthenticatedRequest): Promise<{ revoked: number }> {
    const { accountId, sessionId, actorId } = verified(request);
    const revoked = await this.auth.revokeOtherSessions(accountId, sessionId, SIGNED_OUT_BY_HOLDER, {
      revokedBy: accountId,
      actorId,
    });
    return { revoked };
  }
}

/** PD-23: the revocation reason when the holder ends a session from another device. */
export const SIGNED_OUT_BY_HOLDER = 'signed out from another device';

function verified(request: AuthenticatedRequest): { accountId: string; sessionId: string; actorId: string } {
  if (!request.accountId || !request.sessionId || !request.actor) {
    throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
  }
  return { accountId: request.accountId, sessionId: request.sessionId, actorId: request.actor.actorId };
}

/**
 * WHY THE SOURCE DIMENSION MAY BE OFF, AND WHY THAT IS DELIBERATE
 * ---------------------------------------------------------------
 * `sourceAddress()` returns undefined unless `TRUSTED_PROXY_HOPS` states this
 * deployment's topology, and the limiter then charges NO source budget.
 *
 * That means ANTI-SPRAYING IS NOT ACTIVE BY DEFAULT. It is not an oversight and
 * it is not hidden: the alternative is worse. `req.ip` with no `trust proxy` is
 * the socket peer, which behind a reverse proxy is the proxy -- one budget
 * shared by every client on the internet. Charging that budget atomically (as
 * this code now does) would refuse login to every user after ~30 failures from
 * a single attacker. A control that becomes a product-wide outage is not a
 * control.
 *
 * The per-account (identifier) budget above is unaffected and is always
 * enforced. What is absent while this is off is only the cross-account
 * dimension.
 *
 * Turning it on is one explicit decision -- see client-address.ts -- and it is
 * a DEPLOYMENT TOPOLOGY DEPENDENCY, not an assumption this code is making on
 * anyone's behalf.
 */

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
