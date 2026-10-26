/**
 * PD-33: how a failed cover transaction reaches the caller. A transaction that
 * could not finish in time (Prisma P2028, e.g. a very large caseload on a busy
 * database) is a clean 503 that is safe to retry -- never a 500; an unlawful
 * cover the database refused is a 409 with the trigger's reason.
 */
import { Prisma } from '@prisma/client';
import { CommError, CommErrorCode } from '@platform/errors';
import { refusal } from '../../../src/org/supervisor-cover.service';

const known = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });

describe('PD-33 cover refusals', () => {
  it('P2028 (transaction timed out) is a 503 to retry', () => {
    const e = refusal(known('P2028', 'Transaction already closed: timeout'));
    expect(e).toBeInstanceOf(CommError);
    expect(e).toMatchObject({ code: CommErrorCode.ORG_STRUCTURE_BUSY, status: 503 });
  });

  it('a trigger refusal is a 409 with its reason', () => {
    const e = refusal(
      new Error(
        'Invalid `tx.supervisorCover.create()` invocation: Error occurred during query execution: ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "the backup already covers 2 supervisors at that time", severity: "ERROR", detail: None }) })',
      ),
    );
    expect(e).toMatchObject({ code: CommErrorCode.ORG_STRUCTURE_INVALID, status: 409 });
    expect((e as CommError).message).toBe('the backup already covers 2 supervisors at that time');
  });

  it('a second open cover is a 409', () => {
    expect(refusal(known('P2002', 'Unique constraint failed'))).toMatchObject({ code: CommErrorCode.ORG_STRUCTURE_INVALID, status: 409 });
  });

  it('anything else is passed through untouched', () => {
    const boom = new Error('network');
    expect(refusal(boom)).toBe(boom);
  });
});
