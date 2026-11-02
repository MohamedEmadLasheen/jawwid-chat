import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../platform/auth/auth.service';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { PrismaService } from '../platform/prisma.service';
import { contactKeyHashesOfAccount } from '../parent-profile/family-contact-keys';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { ObjectStorage } from '../communication/attachments/object-storage';

/** The session revocation reason, and the audit reason of the erasure. */
export const ACCOUNT_DELETED_REASON = 'account deleted by its holder';
/** What a wrong password here is recorded as (the sign-in failure log). */
export const DELETION_WRONG_PASSWORD = 'account_deletion_wrong_password';

export interface Erasure {
  kind: 'family' | 'teacher';
  alreadyErased: boolean;
  principalIds: string[];
  avatarKeys: string[];
  tasks: string[];
}

/**
 * PD-56 (store compliance): a parent or a teacher deletes their own account,
 * from the app (signed in) or from the public web page (Google Play's link).
 * Either way the holder proves the password first: the same lockout and
 * failure count as a sign-in.
 *
 * chat.erase_account does the whole erasure in one transaction with the
 * session revocation; the retention it applies is in its migration
 * (20261102210000). After the commit the account's sockets are dropped and the
 * photos deleted from storage (a photo left behind is unreachable: its key is
 * gone from every row).
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** The signed-in holder of `accountId`, re-confirming with the password. */
  async deleteOwn(accountId: string, password: string): Promise<Erasure> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, include: { credential: true } });
    await this.auth.proveHolder(account, account?.subject ?? '', password, DELETION_WRONG_PASSWORD);
    return this.erase(account!.id, account!.kind);
  }

  /** The public page: the sign-in name and password, nothing else. */
  async deleteBySignIn(username: string, password: string): Promise<Erasure> {
    const account = await this.auth.findForSignIn(username);
    await this.auth.proveHolder(account, username, password, DELETION_WRONG_PASSWORD);
    return this.erase(account!.id, account!.kind);
  }

  private async erase(accountId: string, kind: string): Promise<Erasure> {
    // Staff close through an administrator (PD-21); said only once the password was right.
    if (kind !== 'family' && kind !== 'teacher') throw new AuthError(AuthErrorCode.FORBIDDEN);
    // A parent's PD-42 contact keys are server-keyed hashes: made here, deleted there.
    const contactKeys = kind === 'family' ? await contactKeyHashesOfAccount(this.prisma, accountId) : [];
    const { erasure, revoked } = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ r: Erasure }>>`
        SELECT chat.erase_account(${accountId}::uuid, ${ACCOUNT_DELETED_REASON}, ${contactKeys}::text[]) AS r`.catch((e: unknown) => {
        // A teacher with a lesson, a student or payroll still open: refused before any write.
        if (String((e as Error)?.message ?? '').includes('TEACHER_DELETION_BLOCKED')) {
          throw new AuthError(AuthErrorCode.TEACHER_DELETION_BLOCKED);
        }
        throw e;
      });
      const revokedCount = await this.auth.revokeAccountSessionsInTx(tx, accountId, ACCOUNT_DELETED_REASON, {
        revokedBy: accountId,
        actorId: row.r.principalIds[0] ?? accountId,
      });
      return { erasure: row.r, revoked: revokedCount };
    });
    await this.auth.enforceAccountRevocation(accountId, revoked > 0);
    for (const key of erasure.avatarKeys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.warn(`could not delete an erased account's photo: ${(error as Error).message}`);
      }
    }
    return erasure;
  }
}
