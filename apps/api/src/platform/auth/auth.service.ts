import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { IDENTITY_SERVICE } from '../tokens';
import type { IdentityService } from '../identity.service';
import type { Actor } from '../types';
import { hashPassword, verifyPassword } from './password';
import {
  AccessClaims,
  hashRefreshToken,
  newRefreshToken,
  parseTtlSeconds,
  signAccessToken,
  verifyAccessToken,
} from './jwt';

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly actor: Actor;
}

/**
 * Authentication (D-6). Owner: AI #1's domain, implemented by AI #7 at the
 * runtime owner's direction. Reviewed by AI #1 before staging.
 *
 * Deliberately NOT a second identity system. chat.account was already the
 * account record; this adds credentials and sessions beside it and resolves the
 * actor through the existing IdentityService, so every authorization decision
 * downstream is unchanged.
 *
 * Access tokens are short-lived HS256 JWTs carrying the session id. Refresh
 * tokens are opaque, stored hashed, and revocable. The session is checked on
 * every request, so revocation takes effect immediately rather than at token
 * expiry -- one indexed lookup, which is the right trade at this scale.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  private accessSecret(): string {
    const s = process.env.JWT_ACCESS_SECRET;
    if (!s || s.length < 32) {
      // Fail closed. A short or missing signing secret means forgeable tokens.
      throw new Error('JWT_ACCESS_SECRET must be set to at least 32 characters');
    }
    return s;
  }

  private refreshSecret(): string {
    const s = process.env.JWT_REFRESH_SECRET;
    if (!s || s.length < 32) {
      throw new Error('JWT_REFRESH_SECRET must be set to at least 32 characters');
    }
    return s;
  }

  private accessTtl(): number {
    return parseTtlSeconds(process.env.JWT_ACCESS_TTL, 900);
  }

  private refreshTtl(): number {
    return parseTtlSeconds(process.env.JWT_REFRESH_TTL, 2592000);
  }

  /**
   * The actor id an account acts as. The account is the login; the actor is who
   * they are in the product.
   */
  private async actorIdFor(account: {
    id: string;
    kind: string;
    teacherId: string | null;
  }): Promise<string | null> {
    if (account.kind === 'teacher') return account.teacherId;
    const staff = await this.prisma.staff.findFirst({
      where: { accountId: account.id },
      select: { id: true },
    });
    if (staff) return staff.id;
    const contact = await this.prisma.contact.findFirst({
      where: { accountId: account.id },
      select: { id: true },
    });
    return contact?.id ?? null;
  }

  async login(subject: string, password: string, userAgent?: string): Promise<LoginResult> {
    // One error for every failure mode below. Distinguishing "no such account"
    // from "wrong password" tells an attacker which subjects exist.
    const deny = (): never => {
      throw new UnauthorizedException({
        error: { code: 'AUTH.INVALID_CREDENTIALS', message: 'invalid credentials' },
      });
    };

    const account = await this.prisma.account.findUnique({
      where: { subject },
      include: { credential: true },
    });

    if (!account || !account.credential) {
      // Spend comparable time on an unknown subject so response timing does not
      // reveal whether the account exists.
      await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      return deny();
    }
    if (!account.isActive) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.ACCOUNT_DISABLED', message: 'account is disabled' },
      });
    }
    if (account.credential.lockedUntil && account.credential.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.ACCOUNT_LOCKED', message: 'too many attempts; try again later' },
      });
    }

    if (!(await verifyPassword(password, account.credential.passwordHash))) {
      const attempts = account.credential.failedAttempts + 1;
      await this.prisma.accountCredential.update({
        where: { accountId: account.id },
        data: {
          failedAttempts: attempts,
          lockedUntil: attempts >= 10 ? new Date(Date.now() + 15 * 60_000) : null,
        },
      });
      return deny();
    }

    const actorId = await this.actorIdFor(account);
    if (!actorId) {
      this.log.error(`account ${account.id} authenticated but resolves to no actor`);
      return deny();
    }
    const actor = await this.identity.resolveActor(actorId);
    if (!actor || !actor.isActive) return deny();

    await this.prisma.accountCredential.update({
      where: { accountId: account.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    return this.issue(account.id, actor, userAgent);
  }

  private async issue(accountId: string, actor: Actor, userAgent?: string): Promise<LoginResult> {
    const refreshToken = newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        accountId,
        refreshTokenHash: hashRefreshToken(refreshToken, this.refreshSecret()),
        expiresAt: new Date(Date.now() + this.refreshTtl() * 1000),
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
      select: { id: true },
    });

    const accessToken = signAccessToken(
      { sub: accountId, sid: session.id, act: actor.actorId, knd: actor.kind },
      this.accessSecret(),
      this.accessTtl(),
    );

    return { accessToken, refreshToken, expiresInSeconds: this.accessTtl(), actor };
  }

  /**
   * Verifies a bearer token and returns the actor.
   *
   * Three gates, all required: the signature must verify, the session must
   * still be live, and the actor must still be active. The session check is
   * what makes logout immediate.
   */
  async authenticate(token: string): Promise<{ actor: Actor; claims: AccessClaims } | null> {
    const claims = verifyAccessToken(token, this.accessSecret());
    if (!claims) return null;

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, expiresAt: true, accountId: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.accountId !== claims.sub) return null;

    const actor = await this.identity.resolveActor(claims.act);
    if (!actor || !actor.isActive) return null;

    // The token says who it is; the database says whether that is still true.
    // Anything the token asserts beyond identity is ignored on purpose.
    return { actor, claims };
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<LoginResult> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken, this.refreshSecret()) },
      include: { account: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.SESSION_INVALID', message: 'session is not valid' },
      });
    }

    const actorId = await this.actorIdFor(session.account);
    const actor = actorId ? await this.identity.resolveActor(actorId) : null;
    if (!actor || !actor.isActive || !session.account.isActive) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.SESSION_INVALID', message: 'session is not valid' },
      });
    }

    // Rotate: the presented refresh token is retired as it is used, so a stolen
    // one is useful at most once and its use invalidates the legitimate holder's
    // token -- which is how the theft becomes visible.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'rotated', lastUsedAt: new Date() },
    });

    return this.issue(session.accountId, actor, userAgent);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  /** Administrative helper for seeding and password rotation. Not an endpoint. */
  async setPassword(accountId: string, plain: string): Promise<void> {
    const passwordHash = await hashPassword(plain);
    await this.prisma.accountCredential.upsert({
      where: { accountId },
      create: { accountId, passwordHash },
      update: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
    });
  }
}
