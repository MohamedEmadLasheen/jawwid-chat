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

/**
 * The same lock, without waiting: false while another transaction holds it.
 * For a submit whose transaction spans a slow outside call (a Stripe refund):
 * a retry is told at once that the first is in progress instead of holding a
 * pool connection behind the lock for the whole call.
 */
export async function tryLockIdempotencyKey(tx: Tx, key: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`billing:${key}`}, 0)) AS locked`;
  return row?.locked === true;
}

/** A Postgres lock wait that hit `lock_timeout` (55P03). */
export function isLockTimeout(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  return err?.meta?.code === '55P03' || err?.code === '55P03' || /lock timeout/i.test(String(err?.message ?? ''));
}

/** A stored row under this id: the same request (a replay) or a refusal. */
export function assertReplay(what: 'payment' | 'refund' | 'receipt', same: boolean): void {
  if (!same) throw new CommError(CommErrorCode.BILLING_STATE, `this ${what} id was already used for a different ${what}`, 409);
}

/**
 * The reason Stripe's webhook writes on a refund it learned of
 * (CheckoutService.recordStripeRefund). A refund our API asked for, whose
 * recording transaction was lost, is written by the webhook under the
 * client's refundId with this reason -- still a replay of that submit.
 */
export const WEBHOOK_REFUND_REASON = 'refunded in Stripe';

/** A date column as YYYY-MM-DD. */
export function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
