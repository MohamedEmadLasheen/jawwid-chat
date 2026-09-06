import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { CommError } from '../../platform/errors';

/** Maps a domain error to a stable {code, message} body clients can branch on. */
@Catch(CommError)
export class CommErrorFilter implements ExceptionFilter {
  catch(exception: CommError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.status).json({
      error: { code: exception.code, message: exception.message },
    });
  }
}
