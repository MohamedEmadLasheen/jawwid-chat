import type { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../platform/auth/password';
import { StaffRole } from '../communication/contracts/vocab';

/**
 * Establishes the organization's designated super admin (PD-5).
 *
 * ## Why a procedure and not an endpoint
 *
 * There is no public registration (PRD §7.1) and no user-management API yet,
 * and the first super admin is exactly the account that would be needed to use
 * one. So the grant happens here, out of band, by someone holding the database
 * credentials -- and `chat.guard_super_admin_grant` (20261013120000) makes this
 * the ONLY path that can write the role: it opens
 * `chat.provisioning_super_admin` for its own transaction and nothing else does.
 *
 * ## What it reuses, and what it does not invent
 *
 * The login is an ordinary `chat.account` (kind `staff`) whose `subject` is the
 * login identifier, an ordinary `chat.staff` principal, and an ordinary
 * `chat.account_credential` hashed by the product's own `hashPassword`
 * (Argon2id). It signs in through POST /auth/login like anyone else. No second
 * user table, no second hashing scheme, no bypass.
 *
 * ## The refusals, and why each one is a refusal rather than a repair
 *
 * Every existing-state case that is not "already exactly right" stops, names
 * the state, and changes nothing -- unless an explicit flag says to proceed:
 *
 *   - an account with this subject in another kind (a parent, a teacher):
 *     ALWAYS refused. Turning a family login into the organization owner is
 *     never what a bootstrap means.
 *   - the same address with different letter case: refused; logins are
 *     case-sensitive, so it would be a second, confusable account.
 *   - an inactive account: refused; reactivation is a decision, not a side effect.
 *   - a staff account holding another role: refused without
 *     `promoteExistingStaff`.
 *   - an existing password: kept, unless `resetPassword` -- which also revokes
 *     every live session on the account, because a credential change that left
 *     the old sessions running would not have changed who can get in.
 *   - another staff row already holding super_admin in this organization:
 *     ALWAYS refused. The bootstrap establishes one designated owner; it never
 *     hands the role to a second account as a side effect.
 *
 * Nothing here logs, returns or stores the password. Only its hash reaches the
 * database, and the audit row records THAT a credential was set, never what.
 */

export const BOOTSTRAP_AUDIT_ACTION = 'staff.super_admin_bootstrapped';
export const BOOTSTRAP_REVOKE_REASON = 'super admin bootstrap: password reset';
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export type BootstrapOutcome = 'created' | 'promoted' | 'already_super_admin';

export interface BootstrapInput {
  readonly email: string;
  /** Held in memory only for as long as it takes to hash it. */
  readonly password: string;
  readonly displayName: string;
  readonly promoteExistingStaff?: boolean;
  readonly resetPassword?: boolean;
  readonly dryRun?: boolean;
}

export interface BootstrapResult {
  readonly outcome: BootstrapOutcome;
  readonly accountId: string | null;
  readonly staffId: string | null;
  readonly organizationId: string;
  readonly passwordSet: boolean;
  readonly sessionsRevoked: number;
  readonly dryRun: boolean;
}

export const BootstrapRefusalCode = {
  INVALID_EMAIL: 'INVALID_EMAIL',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  INVALID_NAME: 'INVALID_NAME',
  SUBJECT_CASE_CONFLICT: 'SUBJECT_CASE_CONFLICT',
  ACCOUNT_NOT_STAFF: 'ACCOUNT_NOT_STAFF',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  ACCOUNT_WITHOUT_STAFF: 'ACCOUNT_WITHOUT_STAFF',
  STAFF_HAS_OTHER_ROLE: 'STAFF_HAS_OTHER_ROLE',
  ANOTHER_SUPER_ADMIN: 'ANOTHER_SUPER_ADMIN',
} as const;
export type BootstrapRefusalCode = (typeof BootstrapRefusalCode)[keyof typeof BootstrapRefusalCode];

export class BootstrapRefusal extends Error {
  constructor(
    readonly code: BootstrapRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'BootstrapRefusal';
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates input without touching the database. Messages never quote the
 * password -- not even its length.
 */
export function validateBootstrapInput(input: BootstrapInput): { subject: string; displayName: string } {
  const subject = input.email.trim().toLowerCase();
  if (!EMAIL.test(subject)) {
    throw new BootstrapRefusal(BootstrapRefusalCode.INVALID_EMAIL, 'the email address is not valid');
  }
  if (
    input.password.length < MIN_PASSWORD_LENGTH ||
    input.password.length > MAX_PASSWORD_LENGTH ||
    input.password.trim().length === 0 ||
    input.password.toLowerCase() === subject
  ) {
    throw new BootstrapRefusal(
      BootstrapRefusalCode.WEAK_PASSWORD,
      `the initial password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters ` +
        'and must not be the email address',
    );
  }
  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 120) {
    throw new BootstrapRefusal(BootstrapRefusalCode.INVALID_NAME, 'the display name must be 1-120 characters');
  }
  return { subject, displayName };
}

export async function bootstrapSuperAdmin(
  prisma: PrismaClient,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const { subject, displayName } = validateBootstrapInput(input);

  // Argon2id OUTSIDE the transaction: ~200ms is too long to hold a pooled
  // connection and the advisory lock (auth.service.ts makes the same choice).
  // Hashed even when it may not be used, so a refusal and a success cost the
  // same and the plaintext is dropped as early as possible.
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    // One bootstrap at a time, so two concurrent runs cannot each see "no other
    // super admin" and both grant. Transaction-scoped: released at commit.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('chat.super_admin_bootstrap'))`;

    const [{ organization_id: organizationId }] = await tx.$queryRaw<{ organization_id: string }[]>`
      select chat.default_organization_id()::text as organization_id`;

    const existing = await tx.account.findFirst({
      where: { subject: { equals: subject, mode: 'insensitive' } },
      include: { staff: true, credential: { select: { accountId: true } } },
    });

    if (existing && existing.subject !== subject) {
      throw new BootstrapRefusal(
        BootstrapRefusalCode.SUBJECT_CASE_CONFLICT,
        `account ${existing.id} has the same address in different letter case; ` +
          'resolve it by hand rather than creating a confusable second login',
      );
    }
    if (existing && existing.kind !== 'staff') {
      throw new BootstrapRefusal(
        BootstrapRefusalCode.ACCOUNT_NOT_STAFF,
        `account ${existing.id} exists as a "${existing.kind}" login; a family or teacher ` +
          'account is never converted into the super admin',
      );
    }
    if (existing && (!existing.isActive || existing.status !== 'active')) {
      throw new BootstrapRefusal(
        BootstrapRefusalCode.ACCOUNT_INACTIVE,
        `account ${existing.id} is ${existing.status}; reactivating it is a separate, explicit decision`,
      );
    }
    if (existing && !existing.staff) {
      throw new BootstrapRefusal(
        BootstrapRefusalCode.ACCOUNT_WITHOUT_STAFF,
        `staff account ${existing.id} has no chat.staff principal; this is a provisioning defect to ` +
          'investigate, not something to paper over',
      );
    }
    const existingStaff = existing?.staff ?? null;
    if (existingStaff && existingStaff.role !== StaffRole.SUPER_ADMIN && !input.promoteExistingStaff) {
      throw new BootstrapRefusal(
        BootstrapRefusalCode.STAFF_HAS_OTHER_ROLE,
        `staff ${existingStaff.id} holds role "${existingStaff.role}"; re-run with ` +
          '--promote-existing-staff to make this existing account the super admin',
      );
    }

    const otherSuperAdmin = await tx.staff.findFirst({
      where: {
        organizationId,
        role: StaffRole.SUPER_ADMIN,
        ...(existingStaff ? { id: { not: existingStaff.id } } : {}),
      },
      select: { id: true },
    });
    if (otherSuperAdmin) {
      throw new BootstrapRefusal(
        BootstrapRefusalCode.ANOTHER_SUPER_ADMIN,
        `staff ${otherSuperAdmin.id} is already this organization's super admin; the bootstrap ` +
          'never grants the role to a second account',
      );
    }

    const outcome: BootstrapOutcome = !existing
      ? 'created'
      : existingStaff?.role === StaffRole.SUPER_ADMIN
        ? 'already_super_admin'
        : 'promoted';
    const hadCredential = Boolean(existing?.credential);
    const willSetPassword = !hadCredential || Boolean(input.resetPassword);

    if (input.dryRun) {
      return {
        outcome,
        accountId: existing?.id ?? null,
        staffId: existingStaff?.id ?? null,
        organizationId,
        passwordSet: willSetPassword,
        sessionsRevoked: 0,
        dryRun: true,
      };
    }

    // The gate chat.guard_super_admin_grant checks. Transaction-local (`true`):
    // it closes at commit or rollback and cannot leak into a pooled connection.
    await tx.$executeRaw`select set_config('chat.provisioning_super_admin', 'on', true)`;

    let accountId: string;
    let staffId: string;
    if (!existing) {
      const account = await tx.account.create({
        data: { organizationId, subject, kind: 'staff', status: 'active', isActive: true },
      });
      const staff = await tx.staff.create({
        data: {
          organizationId,
          name: displayName,
          role: StaffRole.SUPER_ADMIN,
          accountId: account.id,
        },
      });
      accountId = account.id;
      staffId = staff.id;
    } else {
      accountId = existing.id;
      staffId = (existingStaff as NonNullable<typeof existingStaff>).id;
      if (outcome === 'promoted') {
        await tx.staff.update({ where: { id: staffId }, data: { role: StaffRole.SUPER_ADMIN } });
      }
    }

    let sessionsRevoked = 0;
    if (willSetPassword) {
      await tx.accountCredential.upsert({
        where: { accountId },
        create: { accountId, passwordHash },
        update: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
      if (hadCredential) {
        const revoked = await tx.session.updateMany({
          where: { accountId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: BOOTSTRAP_REVOKE_REASON },
        });
        sessionsRevoked = revoked.count;
      }
    }

    if (outcome !== 'already_super_admin' || willSetPassword) {
      await writeAudit(tx, {
        staffId,
        before: existingStaff ? { role: existingStaff.role } : null,
        after: {
          role: StaffRole.SUPER_ADMIN,
          accountId,
          outcome,
          credential: willSetPassword ? (hadCredential ? 'reset' : 'set') : 'unchanged',
          sessionsRevoked,
        },
      });
    }

    return {
      outcome,
      accountId,
      staffId,
      organizationId,
      passwordSet: willSetPassword,
      sessionsRevoked,
      dryRun: false,
    };
  });
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: { staffId: string; before: unknown; after: Record<string, unknown> },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      // No acting staff member: the bootstrap is performed by whoever holds the
      // database credentials, which is precisely what the reason says.
      actorId: null,
      action: BOOTSTRAP_AUDIT_ACTION,
      entity: 'staff',
      entityId: input.staffId,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: input.after as Prisma.InputJsonValue,
      reason: 'super admin bootstrap (out-of-band CLI, PD-5)',
    },
  });
}
