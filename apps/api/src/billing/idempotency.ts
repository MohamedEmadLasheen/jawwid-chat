import type { Prisma } from '@prisma/client';
import { CommError, CommErrorCode } from '../platform/errors';

type Tx = Prisma.TransactionClient;

/**
 * ADMIN-001: money is recorded once per submit. A money-recording POST may
 * carry a client-generated UUID (`paymentId`, `refundId`) -- generated once per
 * form submit and sent again on every retry -- that becomes the id of the row
 * it writes, as `intakeId` does for a family intake:
 *
 *   - the same id and the same request again -> the first answer, nothing written;
 *   - the same id for a different request    -> 409, nothing written;
 *   - two arriving together                  -> serialized on the id, so the
 *     second finds the first's row and is a replay.
 *
 * The row's primary key is the last guard. Amounts and every money rule are
 * unchanged: this only decides whether a submit is new.
 */
export async function lockIdempotencyKey(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${key}`}, 0))`;
}

/** A stored row under this id: the same request (a replay) or a refusal. */
export function assertReplay(what: 'payment' | 'refund' | 'receipt', same: boolean): void {
  if (!same) throw new CommError(CommErrorCode.BILLING_STATE, `this ${what} id was already used for a different ${what}`, 409);
}

/** A date column as YYYY-MM-DD. */
export function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
