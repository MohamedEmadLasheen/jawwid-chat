import { ArgumentsHost } from '@nestjs/common';
import { CommErrorFilter } from '../../../src/communication/api/http-exception.filter';
import { DATABASE_RETRY_AFTER_SECONDS } from '../../../src/platform/database-unavailable';
import { CommError, CommErrorCode } from '../../../src/platform/errors';

/** RT-014 review: COMM.DATABASE_UNAVAILABLE always carries Retry-After, whichever filter renders it. */
describe('CommErrorFilter and Retry-After', () => {
  function render(error: CommError) {
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const response = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new CommErrorFilter().catch(error, host);
    return { headers, status, body };
  }

  it('a database-unavailable CommError is a 503 with Retry-After', () => {
    const out = render(new CommError(CommErrorCode.DATABASE_UNAVAILABLE, 'busy', 503));
    expect(out.status).toBe(503);
    expect(out.headers['Retry-After']).toBe(String(DATABASE_RETRY_AFTER_SECONDS));
    expect(out.body).toEqual({ error: { code: 'COMM.DATABASE_UNAVAILABLE', message: 'busy' } });
  });

  it('other CommErrors get no Retry-After', () => {
    const out = render(new CommError(CommErrorCode.NOT_CONVERSATION_MEMBER, 'no', 403));
    expect(out.headers['Retry-After']).toBeUndefined();
  });
});
