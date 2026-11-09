/**
 * RT-014: a send cancelled by Postgres to break a deadlock (40P01) or a
 * serialization conflict (40001) is run once more from the start; a second
 * cancellation is a retryable 503, never a 500. Nothing else is retried.
 */
import { Prisma } from '@prisma/client';
import { CommError, CommErrorCode } from '@platform/errors';
import { retryOnTransactionConflict, transactionConflictCode } from '@platform/transaction-retry';

const V = '6.0.0';
/** A raw query cancelled as a deadlock victim, as Prisma reports it. */
const rawDeadlock = () =>
  new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`', {
    code: 'P2010',
    clientVersion: V,
    meta: { code: '40P01', message: 'ERROR: deadlock detected' },
  });
/** A model query in an interactive transaction cancelled the same way. */
const modelDeadlock = () =>
  new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock. Please retry your transaction', {
    code: 'P2034',
    clientVersion: V,
  });
const rawSerialization = () =>
  new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`', {
    code: 'P2010',
    clientVersion: V,
    meta: { code: '40001', message: 'could not serialize access due to concurrent update' },
  });
const unknownDeadlock = () =>
  new Prisma.PrismaClientUnknownRequestError('Error occurred during query execution: PostgresError { code: "40P01", message: "deadlock detected" }', {
    clientVersion: V,
  });
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: V });

const instant = { sleep: async () => undefined };

/** A unit of work that throws the given errors in turn, then returns 'sent'. */
function failing(...errors: Error[]) {
  const calls = { n: 0 };
  const work = async () => {
    const e = errors[calls.n++];
    if (e) throw e;
    return 'sent';
  };
  return { work, calls };
}

describe('RT-014 · transactionConflictCode', () => {
  it('recognises a deadlock and a serialization failure in each shape Prisma reports them', () => {
    expect(transactionConflictCode(rawDeadlock())).toBe('40P01');
    expect(transactionConflictCode(modelDeadlock())).toBe('40P01');
    expect(transactionConflictCode(unknownDeadlock())).toBe('40P01');
    expect(transactionConflictCode(rawSerialization())).toBe('40001');
  });

  it('nothing else is a conflict: a unique violation, a decision, a plain error, a non-error', () => {
    expect(transactionConflictCode(uniqueViolation())).toBeNull();
    expect(transactionConflictCode(new CommError(CommErrorCode.NOT_CONVERSATION_MEMBER, 'deadlock detected'))).toBeNull();
    expect(transactionConflictCode(new Error('boom'))).toBeNull();
    expect(transactionConflictCode('40P01')).toBeNull();
    expect(transactionConflictCode(undefined)).toBeNull();
  });
});

describe('RT-014 · retryOnTransactionConflict', () => {
  it('a deadlock victim is run once more from the start, and its second result is returned', async () => {
    const { work, calls } = failing(rawDeadlock());
    await expect(retryOnTransactionConflict(work, instant)).resolves.toBe('sent');
    expect(calls.n).toBe(2);
  });

  it('a serialization failure and a model-query deadlock are retried the same way', async () => {
    for (const e of [rawSerialization(), modelDeadlock(), unknownDeadlock()]) {
      const { work, calls } = failing(e);
      await expect(retryOnTransactionConflict(work, instant)).resolves.toBe('sent');
      expect(calls.n).toBe(2);
    }
  });

  it('a second deadlock is a retryable 503 (DATABASE_UNAVAILABLE), never a 500, and there is no third attempt', async () => {
    const { work, calls } = failing(rawDeadlock(), modelDeadlock(), rawDeadlock());
    const err = await retryOnTransactionConflict(work, instant).catch((e) => e);
    expect(err).toBeInstanceOf(CommError);
    expect((err as CommError).code).toBe(CommErrorCode.DATABASE_UNAVAILABLE);
    expect((err as CommError).status).toBe(503);
    expect(calls.n).toBe(2);
  });

  it('any other error is thrown unchanged at once, never retried', async () => {
    const refusal = new CommError(CommErrorCode.NOT_CONVERSATION_MEMBER, 'not a member');
    for (const e of [refusal, uniqueViolation(), new Error('boom')]) {
      const { work, calls } = failing(e);
      await expect(retryOnTransactionConflict(work, instant)).rejects.toBe(e);
      expect(calls.n).toBe(1);
    }
  });

  it('success first time: run once, no wait', async () => {
    const sleep = jest.fn(async () => undefined);
    const { work, calls } = failing();
    await expect(retryOnTransactionConflict(work, { sleep })).resolves.toBe('sent');
    expect(calls.n).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits a short jittered delay (20-80 ms) before the retry', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    for (let i = 0; i < 50; i++) await retryOnTransactionConflict(failing(rawDeadlock()).work, { sleep });
    expect(waits).toHaveLength(50);
    for (const ms of waits) {
      expect(ms).toBeGreaterThanOrEqual(20);
      expect(ms).toBeLessThanOrEqual(80);
    }
  });
});
