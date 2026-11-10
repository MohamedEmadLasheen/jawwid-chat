import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthService } from '../platform/auth/auth.service';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { CommError, CommErrorCode } from '../platform/errors';
import { PrismaService } from '../platform/prisma.service';
import { contactKeyHashesOfAccount } from '../parent-profile/family-contact-keys';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { ObjectStorage } from '../communication/attachments/object-storage';

/** The session revocation reason, and the audit reason of the erasure. */
export const ACCOUNT_DELETED_REASON = 'account deleted by its holder';
/** What a wrong password here is recorded as (the sign-in failure log). */
export const DELETION_WRONG_PASSWORD = 'account_deletion_wrong_password';

/** The session revocation reason when a deletion request is completed (staff or the deadline). */
export const REQUEST_COMPLETED_REASON = 'account deleted on its holder\'s request';

/** PD-56 O-3: a teacher's deletion request, as the holder and staff read it. */
export interface DeletionRequestView {
  id: string;
  state: 'pending' | 'completed' | 'cancelled';
  requestedAt: string;
  deadlineAt: string;
  openItems: string[];
  completedAt: string | null;
  completedVia: 'staff' | 'deadline' | 'holder' | null;
  cancelledAt: string | null;
}

/** What asking to delete did: deleted at once, or (a teacher with work open) a request recorded. */
export type DeletionOutcome = { deleted: true } | { deleted: false; request: DeletionRequestView };

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

  /**
   * The signed-in holder of `accountId`, re-confirming with the password. A
   * teacher with nothing open is deleted at once; with a lesson, a student or
   * payroll still open, a deletion request is recorded instead (O-3), or the
   * pending one is returned: asking again changes nothing.
   */
  async deleteOwn(accountId: string, password: string): Promise<DeletionOutcome> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, include: { credential: true } });
    await this.auth.proveHolder(account, account?.subject ?? '', password, DELETION_WRONG_PASSWORD);
    return this.eraseOrRequest(account!.id, account!.kind);
  }

  /** The public page: the sign-in name and password, nothing else. */
  async deleteBySignIn(username: string, password: string): Promise<DeletionOutcome> {
    const account = await this.auth.findForSignIn(username);
    await this.auth.proveHolder(account, username, password, DELETION_WRONG_PASSWORD);
    return this.eraseOrRequest(account!.id, account!.kind);
  }

  private async eraseOrRequest(accountId: string, kind: string): Promise<DeletionOutcome> {
    // Twice at most: a request is refused when the last open item closed in between.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.erase(accountId, kind);
        return { deleted: true };
      } catch (e) {
        if (!(e instanceof TeacherWorkOpen)) throw e;
      }
      try {
        return { deleted: false, request: await this.requestDeletion(accountId) };
      } catch (e) {
        if (attempt === 0 && /nothing is open: the account is deleted at once/.test(String((e as Error)?.message ?? ''))) continue;
        throw e;
      }
    }
  }

  /** O-3: the pending request of this teacher's account, or a new one (its task and audit row are the database's). */
  async requestDeletion(accountId: string): Promise<DeletionRequestView> {
    const [row] = await this.prisma.$queryRaw<Array<{ r: DeletionRequestView }>>`
      SELECT chat.request_account_deletion(${accountId}::uuid) AS r`;
    return view(row!.r);
  }

  /**
   * O-3: a pending request is completed -- by staff (the API checked who may)
   * or at its deadline -- and the same erasure runs, past the open-items gate.
   */
  async completeRequest(requestId: string, by: { staffId: string; staffAccountId: string | null } | null): Promise<Erasure & { requestId: string; leftOpen: Record<string, unknown> }> {
    const via = by ? 'staff' : 'deadline';
    const [target] = await this.prisma.$queryRaw<Array<{ account_id: string }>>`
      SELECT account_id::text FROM chat.account_deletion_request WHERE id = ${requestId}::uuid`;
    if (!target) throw new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'deletion request not found');
    return this.run(target.account_id, REQUEST_COMPLETED_REASON, by ? { revokedBy: by.staffAccountId ?? target.account_id, actorId: by.staffId } : null, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ r: Erasure & { requestId: string; leftOpen: Record<string, unknown> } }>>`
        SELECT chat.complete_account_deletion_request(${requestId}::uuid, ${by?.staffId ?? null}::uuid, ${via}) AS r`.catch((e: unknown) => {
        const text = String((e as Error)?.message ?? '');
        if (/this deletion request is (completed|cancelled)|not due yet/.test(text)) {
          throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this deletion request is no longer pending', 409);
        }
        throw e;
      });
      return row!.r;
    });
  }

  private async erase(accountId: string, kind: string): Promise<Erasure> {
    // Staff close through an administrator (PD-21); said only once the password was right.
    if (kind !== 'family' && kind !== 'teacher') throw new AuthError(AuthErrorCode.FORBIDDEN);
    // A parent's PD-42 contact keys are server-keyed hashes: made here, deleted there.
    const contactKeys = kind === 'family' ? await contactKeyHashesOfAccount(this.prisma, accountId) : [];
    return this.run(accountId, ACCOUNT_DELETED_REASON, null, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ r: Erasure }>>`
        SELECT chat.erase_account(${accountId}::uuid, ${ACCOUNT_DELETED_REASON}, ${contactKeys}::text[]) AS r`.catch((e: unknown) => {
        // A teacher with a lesson, a student or payroll still open: nothing was written (O-3: a request instead).
        if (String((e as Error)?.message ?? '').includes('TEACHER_DELETION_BLOCKED')) throw new TeacherWorkOpen();
        throw e;
      });
      return row!.r;
    });
  }

  /**
   * One erasure, in one transaction with the session revocation; then the
   * account's sockets are dropped and the photos deleted from storage.
   */
  private async run<E extends Erasure>(
    accountId: string,
    reason: string,
    by: { revokedBy: string; actorId: string } | null,
    erase: (tx: Prisma.TransactionClient) => Promise<E>,
  ): Promise<E> {
    const { erasure, revoked } = await this.prisma.$transaction(async (tx) => {
      // LR-46 (#537): lock the account's live sessions before erase_account touches its
      // push tokens. registerDevice locks the session, then the token; taking them here in
      // the same order means a registration racing this deletion waits instead of
      // deadlocking it. Here, at the top of the shared run(), it covers every erasure
      // (the holder's own, staff's completion and the deadline's).
      await tx.$queryRaw`
        SELECT 1 FROM chat.session WHERE account_id = ${accountId}::uuid AND revoked_at IS NULL FOR UPDATE`;
      const r = await erase(tx);
      const revokedCount = await this.auth.revokeAccountSessionsInTx(tx, accountId, reason, by ?? {
        revokedBy: accountId,
        actorId: r.principalIds[0] ?? accountId,
      });
      return { erasure: r, revoked: revokedCount };
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

/** Internal: the erasure's gate refused (a teacher with work open). Never leaves this service. */
class TeacherWorkOpen extends Error {}

/** The database's JSON, with its timestamps as ISO strings. */
export function view(r: DeletionRequestView): DeletionRequestView {
  const iso = (v: string | null) => (v == null ? null : new Date(v).toISOString());
  return {
    id: r.id,
    state: r.state,
    requestedAt: iso(r.requestedAt)!,
    deadlineAt: iso(r.deadlineAt)!,
    openItems: r.openItems ?? [],
    completedAt: iso(r.completedAt),
    completedVia: r.completedVia ?? null,
    cancelledAt: iso(r.cancelledAt),
  };
}
