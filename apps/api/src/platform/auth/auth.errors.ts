import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable authentication error codes. Clients branch on these, never on message
 * text (docs/communication/error-codes.md).
 *
 * Note what is NOT here: any code that distinguishes "no such account" from
 * "wrong password". Every credential failure is INVALID_CREDENTIALS, so the
 * response cannot be used to enumerate which subjects exist.
 */
export enum AuthErrorCode {
  MISSING_TOKEN = 'AUTH.MISSING_TOKEN',
  INVALID_TOKEN = 'AUTH.INVALID_TOKEN',
  INVALID_CREDENTIALS = 'AUTH.INVALID_CREDENTIALS',
  ACCOUNT_DISABLED = 'AUTH.ACCOUNT_DISABLED',
  ACCOUNT_LOCKED = 'AUTH.ACCOUNT_LOCKED',
  SESSION_INVALID = 'AUTH.SESSION_INVALID',
  DEVICE_LIMIT_REACHED = 'AUTH.DEVICE_LIMIT_REACHED',
  WEAK_PASSWORD = 'AUTH.WEAK_PASSWORD',
  INVALID_RESET_TOKEN = 'AUTH.INVALID_RESET_TOKEN',
  INVALID_VERIFICATION_TOKEN = 'AUTH.INVALID_VERIFICATION_TOKEN',
  FORBIDDEN = 'AUTH.FORBIDDEN',
  NOT_FOUND = 'AUTH.NOT_FOUND',
}

export class AuthError extends HttpException {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    status: number = HttpStatus.UNAUTHORIZED,
  ) {
    super({ error: { code, message } }, status);
    this.name = 'AuthError';
  }
}

export const invalidCredentials = (): AuthError =>
  new AuthError(AuthErrorCode.INVALID_CREDENTIALS, 'invalid credentials');
