import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { DATABASE_RETRY_AFTER_SECONDS } from '../../platform/database-unavailable';
import { CommError, CommErrorCode } from '../../platform/errors';

/** Maps a domain error to a stable {code, message} body clients can branch on. */
@Catch(CommError)
export class CommErrorFilter implements ExceptionFilter {
  catch(exception: CommError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    // The documented contract of this code (docs/communication/error-codes.md): always
    // sent with Retry-After, whichever layer raised it (here: a send cancelled twice by
    // a deadlock, RT-014; the Prisma filter sets it for its own cases).
    if (exception.code === CommErrorCode.DATABASE_UNAVAILABLE) {
      response.setHeader('Retry-After', String(DATABASE_RETRY_AFTER_SECONDS));
    }
    response.status(exception.status).json({
      error: { code: exception.code, message: exception.message, ...(exception.detail ? { detail: exception.detail } : {}) },
    });
  }
}
