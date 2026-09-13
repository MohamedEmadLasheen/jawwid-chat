import { randomUUID } from 'node:crypto';
import type { PrismaService } from '@platform/prisma.service';
import type { IdentityService, ResolvableAccount } from '@platform/identity.service';
import type { AuditService, AuditWriteInput, EventWriteInput, Tx } from '@platform/audit.service';
import type { RateLimitStore, ReserveResult } from '@platform/auth/login-rate-limit';
import type { Actor } from '@platform/types';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';

/**
 * An in-memory stand-in for the four tables AuthService touches.
 *
 * NOT a Prisma emulator. It implements exactly the calls the service makes and
 * throws on anything else, so a test cannot pass because the double quietly
 * invented behaviour the real client does not have. Where the database has a
 * constraint that matters to a security property -- session.refresh_token_hash
 * UNIQUE, the revoked_at/revoked_reason pairing -- the constraint is enforced
 * here too.
 */

export interface AccountRow {
  id: string;
  subject: string;
  kind: string;
  status: string;
  isActive: boolean;
  organizationId: string;
  lastLoginAt: Date | null;
}

export interface CredentialRow {
  accountId: string;
  passwordHash: string;
  passwordChangedAt: Date;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface SessionRow {
  id: string;
  accountId: string;
  deviceId: string | null;
  refreshTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export interface DeviceRow {
  id: string;
  accountId: string;
  platform: string;
  name: string | null;
  appVersion: string | null;
  lastSeenAt: Date;
}

export class FakeDb {
  readonly accounts: AccountRow[] = [];
  readonly credentials: CredentialRow[] = [];
  readonly sessions: SessionRow[] = [];
  readonly devices: DeviceRow[] = [];

  // -- account ------------------------------------------------------------
  readonly account = {
    findUnique: async (args: {
      where: { subject?: string; id?: string };
      include?: { credential?: boolean };
    }) => {
      const row = this.accounts.find((a) =>
        args.where.subject !== undefined ? a.subject === args.where.subject : a.id === args.where.id,
      );
      if (!row) return null;
      if (args.include?.credential) {
        return { ...row, credential: this.credentials.find((c) => c.accountId === row.id) ?? null };
      }
      return { ...row };
    },
    update: async (args: { where: { id: string }; data: Partial<AccountRow> }) => {
      const row = this.accounts.find((a) => a.id === args.where.id);
      if (!row) throw new Error('account not found');
      Object.assign(row, args.data);
      return { ...row };
    },
  };

  // -- accountCredential --------------------------------------------------
  readonly accountCredential = {
    update: async (args: { where: { accountId: string }; data: Partial<CredentialRow> }) => {
      const row = this.credentials.find((c) => c.accountId === args.where.accountId);
      if (!row) throw new Error('credential not found');
      Object.assign(row, args.data);
      return { ...row };
    },
    upsert: async (args: {
      where: { accountId: string };
      create: Partial<CredentialRow> & { accountId: string; passwordHash: string };
      update: Partial<CredentialRow>;
    }) => {
      const existing = this.credentials.find((c) => c.accountId === args.where.accountId);
      if (existing) {
        Object.assign(existing, args.update);
        return { ...existing };
      }
      const row: CredentialRow = {
        accountId: args.create.accountId,
        passwordHash: args.create.passwordHash,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      };
      this.credentials.push(row);
      return { ...row };
    },
  };

  // -- session ------------------------------------------------------------
  readonly session = {
    create: async (args: { data: Record<string, unknown> }) => {
      const hash = String(args.data.refreshTokenHash);
      // chat.session.refresh_token_hash is UNIQUE; reuse detection depends on it.
      if (this.sessions.some((s) => s.refreshTokenHash === hash)) {
        throw new Error('unique constraint violated: session.refresh_token_hash');
      }
      const row: SessionRow = {
        id: randomUUID(),
        accountId: String(args.data.accountId),
        deviceId: (args.data.deviceId as string | null) ?? null,
        refreshTokenHash: hash,
        createdAt: new Date(),
        expiresAt: args.data.expiresAt as Date,
        lastSeenAt: (args.data.lastSeenAt as Date | null) ?? null,
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
        ipHash: (args.data.ipHash as string | null) ?? null,
        userAgent: (args.data.userAgent as string | null) ?? null,
      };
      this.sessions.push(row);
      return { id: row.id, createdAt: row.createdAt };
    },

    findUnique: async (args: {
      where: { id?: string; refreshTokenHash?: string };
      select?: Record<string, unknown>;
      include?: { account?: boolean };
    }) => {
      const row = this.sessions.find((s) =>
        args.where.id !== undefined
          ? s.id === args.where.id
          : s.refreshTokenHash === args.where.refreshTokenHash,
      );
      if (!row) return null;
      const account = this.accounts.find((a) => a.id === row.accountId) ?? null;
      if (args.select) return { ...row, account: account ? { ...account } : null };
      if (args.include?.account) return { ...row, account: account ? { ...account } : null };
      return { ...row };
    },

    update: async (args: { where: { id: string }; data: Partial<SessionRow> }) => {
      const row = this.sessions.find((s) => s.id === args.where.id);
      if (!row) throw new Error('session not found');
      Object.assign(row, args.data);
      return { ...row };
    },

    updateMany: async (args: {
      where: { id?: string; accountId?: string; revokedAt?: null };
      data: Partial<SessionRow>;
    }) => {
      const matched = this.sessions.filter((s) => {
        if (args.where.id !== undefined && s.id !== args.where.id) return false;
        if (args.where.accountId !== undefined && s.accountId !== args.where.accountId) return false;
        if (args.where.revokedAt === null && s.revokedAt !== null) return false;
        return true;
      });
      for (const row of matched) {
        Object.assign(row, args.data);
        // check ((revoked_at is null) = (revoked_reason is null))
        if ((row.revokedAt === null) !== (row.revokedReason === null)) {
          throw new Error('check constraint violated: session_revocation_is_complete');
        }
      }
      return { count: matched.length };
    },
  };

  // -- device -------------------------------------------------------------
  readonly device = {
    findFirst: async (args: {
      where: { accountId: string; platform: string; name: string | null };
    }) => {
      const row = this.devices.find(
        (d) =>
          d.accountId === args.where.accountId &&
          d.platform === args.where.platform &&
          d.name === args.where.name,
      );
      return row ? { id: row.id } : null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const row: DeviceRow = {
        id: randomUUID(),
        accountId: String(args.data.accountId),
        platform: String(args.data.platform),
        name: (args.data.name as string | null) ?? null,
        appVersion: (args.data.appVersion as string | null) ?? null,
        lastSeenAt: new Date(),
      };
      this.devices.push(row);
      return { id: row.id };
    },
    update: async (args: { where: { id: string }; data: Partial<DeviceRow> }) => {
      const row = this.devices.find((d) => d.id === args.where.id);
      if (!row) throw new Error('device not found');
      Object.assign(row, args.data);
      return { ...row };
    },
  };

  /**
   * Interactive transactions, with REAL rollback semantics.
   *
   * Every mutation the callback performs is journalled; if the callback throws,
   * the journal is replayed backwards and the arrays are restored. That is what
   * lets the audit tests assert the property that matters -- "the session is
   * not created when the audit write fails" -- instead of assuming it.
   */
  async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const snapshot = {
      accounts: this.accounts.map((r) => ({ ...r })),
      credentials: this.credentials.map((r) => ({ ...r })),
      sessions: this.sessions.map((r) => ({ ...r })),
      devices: this.devices.map((r) => ({ ...r })),
      auditLogs: this.auditLogs.slice(),
      eventLogs: this.eventLogs.slice(),
    };
    try {
      return await fn(this);
    } catch (error) {
      replace(this.accounts, snapshot.accounts);
      replace(this.credentials, snapshot.credentials);
      replace(this.sessions, snapshot.sessions);
      replace(this.devices, snapshot.devices);
      replace(this.auditLogs, snapshot.auditLogs);
      replace(this.eventLogs, snapshot.eventLogs);
      throw error;
    }
  }

  readonly auditLogs: AuditWriteInput[] = [];
  readonly eventLogs: EventWriteInput[] = [];

  // -- helpers ------------------------------------------------------------

  async addAccount(
    partial: Partial<AccountRow> & { subject: string },
    password?: string,
  ): Promise<AccountRow> {
    const row: AccountRow = {
      id: randomUUID(),
      subject: partial.subject,
      kind: partial.kind ?? 'family',
      status: partial.status ?? 'active',
      isActive: partial.isActive ?? (partial.status ?? 'active') === 'active',
      organizationId: partial.organizationId ?? ORG_A,
      lastLoginAt: null,
    };
    this.accounts.push(row);
    if (password !== undefined) {
      this.credentials.push({
        accountId: row.id,
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      });
    }
    return row;
  }

  credentialFor(accountId: string): CredentialRow {
    const row = this.credentials.find((c) => c.accountId === accountId);
    if (!row) throw new Error('no credential');
    return row;
  }

  asPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }
}

function replace<T>(target: T[], next: T[]): void {
  target.length = 0;
  target.push(...next);
}

/**
 * Writes into the same FakeDb arrays the transaction journal restores, so an
 * audit row written inside a rolled-back transaction disappears with it.
 */
export class FakeAudit implements AuditService {
  constructor(private readonly db: FakeDb) {}

  async audit(_tx: Tx, input: AuditWriteInput): Promise<void> {
    if (!input.reason || input.reason.trim().length === 0) {
      // chat.audit_log has `check (length(btrim(reason)) > 0)`.
      throw new Error('check constraint violated: audit_log_reason_check');
    }
    this.db.auditLogs.push(input);
  }

  async event(_tx: Tx, input: EventWriteInput): Promise<void> {
    if (!EVENT_TYPES.has(input.type)) {
      // chat.event_log has a closed `type` CHECK. The double enforces it so a
      // unit test cannot pass with a name the database would reject.
      throw new Error(`check constraint violated: event_log_type_check (${input.type})`);
    }
    if (!['contact', 'staff', 'teacher', 'system'].includes(input.actorKind)) {
      throw new Error('check constraint violated: event_log_actor_type_check');
    }
    this.db.eventLogs.push(input);
  }
}

/** The two auth values 20260912090000 adds. */
const EVENT_TYPES = new Set(['auth.login_failed', 'auth.refresh_reuse_detected']);

/**
 * An in-memory RateLimitStore.
 *
 * Single-threaded JavaScript makes `reserve` here atomic for free -- nothing
 * can interleave inside a synchronous body. That is NOT what proves the real
 * implementation is atomic: the Redis Lua script is exercised under genuine
 * concurrency by test/integration/auth-rate-limit.spec.ts. This double exists
 * so the POLICY (limits, which budget trips, fail-closed, release-on-success)
 * can be tested without a server.
 */
export class FakeRateLimitStore implements RateLimitStore {
  private readonly counts = new Map<string, number>();
  private readonly expiries = new Map<string, number>();
  /** Set to make every command throw, to exercise the fail-closed path. */
  broken = false;
  /** Every reserve() call, so a test can prove the budgets actually charged. */
  readonly reservations: Array<readonly string[]> = [];

  async reserve(
    keys: readonly string[],
    limits: readonly number[],
    windowSeconds: number,
  ): Promise<ReserveResult> {
    if (this.broken) throw new Error('ECONNREFUSED');
    this.reservations.push(keys);

    for (let i = 0; i < keys.length; i++) {
      const count = (this.counts.get(keys[i]) ?? 0) + 1;
      this.counts.set(keys[i], count);
      if (count === 1) this.expiries.set(keys[i], windowSeconds);

      if (count > limits[i]) {
        return { exceeded: i + 1, retryAfterSeconds: this.expiries.get(keys[i]) ?? windowSeconds };
      }
    }
    return { exceeded: 0, retryAfterSeconds: 0 };
  }

  async drop(key: string): Promise<void> {
    if (this.broken) throw new Error('ECONNREFUSED');
    this.counts.delete(key);
    this.expiries.delete(key);
  }

  /** Test introspection only. */
  countOf(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  /** Models the window lapsing in Redis. */
  lapse(key: string): void {
    this.counts.delete(key);
    this.expiries.delete(key);
  }
}

export const ORG_A = '11111111-1111-1111-1111-111111111111';
export const ORG_B = '22222222-2222-2222-2222-222222222222';

/**
 * A directory of principals keyed by account id. Standing in for the three
 * principal tables lets these tests exercise the AUTHENTICATION rules without
 * re-testing Prisma's `findFirst`.
 */
export class FakeIdentity implements IdentityService {
  private readonly byAccount = new Map<string, Actor>();
  private readonly byActorId = new Map<string, Actor>();

  give(accountId: string, actor: Actor): Actor {
    this.byAccount.set(accountId, actor);
    this.byActorId.set(actor.actorId, actor);
    return actor;
  }

  mutate(actorId: string, patch: Partial<Actor>): void {
    const actor = this.byActorId.get(actorId);
    if (!actor) throw new Error('unknown actor');
    Object.assign(actor, patch);
  }

  async resolveActor(actorId: string): Promise<Actor | null> {
    return this.byActorId.get(actorId) ?? null;
  }

  async resolveForAccount(account: ResolvableAccount): Promise<Actor | null> {
    const actor = this.byAccount.get(account.id);
    // The real resolver consults the table named by account.kind, so an account
    // whose kind does not match its principal resolves to nothing.
    if (!actor) return null;
    const expected = account.kind === 'family' ? 'contact' : account.kind;
    return actor.kind === expected ? actor : null;
  }
}

/** Test secrets. 32+ chars, and distinct, because loadAuthConfig requires both. */
export const TEST_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-32';
export const TEST_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-32';

export function withAuthEnv(extra: NodeJS.ProcessEnv = {}): void {
  process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL = '30d';
  Object.assign(process.env, extra);
}

export function buildAuth(db: FakeDb, identity: FakeIdentity): AuthService {
  return new AuthService(db.asPrisma(), identity, new FakeAudit(db));
}

export function contactActor(overrides: Partial<Actor> = {}): Actor {
  return {
    actorId: randomUUID(),
    kind: 'contact',
    displayName: 'ولي أمر',
    locale: 'ar',
    isActive: true,
    familyId: randomUUID(),
    canMessage: true,
    organizationId: ORG_A,
    ...overrides,
  };
}

export function teacherActor(overrides: Partial<Actor> = {}): Actor {
  return {
    actorId: randomUUID(),
    kind: 'teacher',
    displayName: 'أستاذ',
    locale: 'ar',
    isActive: true,
    organizationId: ORG_A,
    ...overrides,
  };
}

export function staffActor(overrides: Partial<Actor> = {}): Actor {
  return {
    actorId: randomUUID(),
    kind: 'staff',
    displayName: 'Jawwid staff',
    locale: 'ar',
    isActive: true,
    staffRole: 'manager',
    organizationId: ORG_A,
    ...overrides,
  };
}
