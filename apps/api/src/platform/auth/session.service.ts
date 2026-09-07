import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AppConfigService } from '../app-config.service';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { hashIp, hashToken, newOpaqueToken } from './tokens';
import { AuthError, AuthErrorCode } from './auth.errors';

export interface DeviceDescriptor {
  /** Stable per-installation identifier supplied by the client. */
  clientKey?: string;
  platform?: string;
  appVersion?: string;
  displayName?: string;
}

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface IssuedSession {
  readonly sessionId: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly deviceId: string | null;
}

export interface SessionView {
  id: string;
  deviceId: string | null;
  platform: string | null;
  displayName: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
}

const PLATFORMS = new Set(['ios', 'android', 'web', 'unknown']);

/**
 * Sessions and devices.
 *
 * A session is one login bound to one device. The access token names it (`sid`)
 * and the row is checked on every request, so revocation is immediate rather
 * than at token expiry -- one indexed lookup, the right trade at this scale.
 *
 * Refresh tokens are opaque and stored HASHED: a database read yields nothing
 * that can be replayed. They rotate on every use, so a stolen refresh token is
 * useful at most once, and its use invalidates the legitimate holder's token --
 * which is how the theft becomes visible instead of silent.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private secret(): string {
    const s = process.env.JWT_REFRESH_SECRET;
    if (!s || s.length < 32) {
      // Fail closed. A short or missing secret means forgeable stored tokens.
      throw new Error('JWT_REFRESH_SECRET must be set to at least 32 characters');
    }
    return s;
  }

  // ------------------------------------------------------------------
  // Devices
  // ------------------------------------------------------------------

  /**
   * Register or refresh the device this login is happening on.
   *
   * `clientKey` is scoped to the account, so naming another account's device
   * key reaches nothing: the unique index is (account_id, client_key).
   */
  async upsertDevice(
    accountId: string,
    device: DeviceDescriptor | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | null> {
    const clientKey = device?.clientKey?.trim();
    if (!clientKey) return null;

    const platform = PLATFORMS.has(device?.platform ?? '') ? device!.platform! : 'unknown';
    const row = await tx.device.upsert({
      where: { accountId_clientKey: { accountId, clientKey } },
      create: {
        accountId,
        clientKey,
        platform,
        appVersion: device?.appVersion ?? null,
        displayName: device?.displayName?.slice(0, 120) ?? null,
      },
      update: {
        platform,
        appVersion: device?.appVersion ?? undefined,
        displayName: device?.displayName?.slice(0, 120) ?? undefined,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });
    return row.id;
  }

  // ------------------------------------------------------------------
  // Issuing
  // ------------------------------------------------------------------

  /**
   * Open a session, enforcing the device limit first.
   *
   * THE POLICY, in one place (chat.config `auth.device_limit_policy`):
   *
   *   revoke_oldest  the least recently seen session is revoked so the new
   *                  device gets in. Chosen as the default because the failure
   *                  mode of the alternative is a person locked out of the
   *                  device in their hand by a session they cannot see.
   *   reject_new     the login is refused with AUTH.DEVICE_LIMIT_REACHED.
   *
   * Re-authenticating on a device that already has a session replaces that
   * session rather than consuming a second slot, so the limit counts devices
   * and not logins.
   */
  async issue(
    accountId: string,
    device: DeviceDescriptor | undefined,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    const [maxDevices, policy, ttl] = await Promise.all([
      this.config.get('auth.max_active_devices'),
      this.config.get('auth.device_limit_policy'),
      this.config.get('auth.refresh_token_ttl_seconds'),
    ]);

    const deviceId = await this.upsertDevice(accountId, device);

    if (deviceId) {
      // One live session per device: logging in again on the same installation
      // is a replacement, not a second seat.
      await this.prisma.session.updateMany({
        where: { accountId, deviceId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'replaced by a new login on this device' },
      });
    }

    const live = await this.prisma.session.findMany({
      where: { accountId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ lastSeenAt: 'asc' }, { issuedAt: 'asc' }],
      select: { id: true },
    });

    if (live.length >= Number(maxDevices)) {
      if (policy === 'reject_new') {
        throw new AuthError(
          AuthErrorCode.DEVICE_LIMIT_REACHED,
          'this account already has the maximum number of active devices',
          403,
        );
      }
      const surplus = live.slice(0, live.length - Number(maxDevices) + 1).map((s) => s.id);
      await this.prisma.session.updateMany({
        where: { id: { in: surplus } },
        data: { revokedAt: new Date(), revokedReason: 'device limit reached' },
      });
    }

    const refreshToken = newOpaqueToken();
    const expiresAt = new Date(Date.now() + Number(ttl) * 1000);
    const session = await this.prisma.session.create({
      data: {
        accountId,
        deviceId,
        refreshTokenHash: hashToken(refreshToken, this.secret()),
        expiresAt,
        lastSeenAt: new Date(),
        userAgent: context.userAgent?.slice(0, 200) ?? null,
        ipHash: hashIp(context.ip, this.secret()),
      },
      select: { id: true },
    });

    return { sessionId: session.id, refreshToken, expiresAt, deviceId };
  }

  /** The live session named by a refresh token, or null. */
  async findByRefreshToken(refreshToken: string) {
    if (!refreshToken) return null;
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken, this.secret()) },
      include: { account: true, device: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    return session;
  }

  /** Retire a session as its refresh token is spent. */
  async rotate(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'rotated', lastSeenAt: new Date() },
    });
  }

  /** Cheap liveness touch; never blocks the request path on a write failure. */
  async touch(sessionId: string): Promise<void> {
    await this.prisma.session
      .updateMany({ where: { id: sessionId, revokedAt: null }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------------
  // Revocation
  // ------------------------------------------------------------------

  async revoke(sessionId: string, reason: string, revokedBy?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedBy: revokedBy ?? null },
    });
    return result.count;
  }

  /**
   * Revoke ONE session belonging to this account.
   *
   * The account id is part of the WHERE clause, not checked afterwards: that is
   * what makes "log out my other phone" incapable of logging out somebody
   * else's. A session id belonging to another account matches zero rows and the
   * caller is told the session does not exist.
   */
  async revokeOwn(accountId: string, sessionId: string, reason: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, accountId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedBy: accountId },
    });
    if (result.count === 0) {
      throw new AuthError(AuthErrorCode.NOT_FOUND, 'no such active session', 404);
    }
  }

  /** Every session for an account. `except` keeps the caller signed in. */
  async revokeAll(
    accountId: string,
    reason: string,
    options: { except?: string; revokedBy?: string } = {},
  ): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        accountId,
        revokedAt: null,
        ...(options.except ? { id: { not: options.except } } : {}),
      },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
        revokedBy: options.revokedBy ?? null,
      },
    });
    return result.count;
  }

  async list(accountId: string, currentSessionId?: string): Promise<SessionView[]> {
    const rows = await this.prisma.session.findMany({
      where: { accountId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { device: true },
      orderBy: { issuedAt: 'desc' },
    });
    // Deliberately no token material, not even hashed: a session list is shown
    // to a person on a device, and nothing on it needs to be a secret.
    return rows.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      platform: s.device?.platform ?? null,
      displayName: s.device?.displayName ?? null,
      appVersion: s.device?.appVersion ?? null,
      createdAt: s.issuedAt.toISOString(),
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }
}
