import { Body, Controller, HttpCode, Inject, Ip, Optional, Post } from '@nestjs/common';
import { Public } from './auth.guard';
import { AuthError, AuthErrorCode } from './auth.errors';
import { LoginRateLimiter } from './login-rate-limit';
import { PasswordResetService } from './password-reset.service';
import { CLIENT_ADDRESS_POLICY, readClientAddressPolicy, sourceAddress, type ClientAddressPolicy } from './client-address';

/**
 * PD-21: the person finishes the password reset an administrator started.
 * Public, and metered by the login limiter BEFORE anything else -- per
 * identifier and per source -- exactly like POST /auth/login. Issuing a code is
 * POST /admin/accounts/:accountId/password-reset (AccountAdminController).
 */
@Controller('auth/password-reset')
export class PasswordResetController {
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly reset: PasswordResetService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

  /** Sets the password and ends every session; the client then signs in with POST /auth/login. */
  @Public()
  @Post()
  @HttpCode(200)
  async complete(@Body() body: { username?: unknown; code?: unknown; password?: unknown }, @Ip() ip?: string) {
    const username = typeof body?.username === 'string' ? body.username : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!username || !code) throw new AuthError(AuthErrorCode.RESET_CODE_INVALID);
    await this.rateLimit.reserve(`reset:${username.trim()}`, sourceAddress(ip, this.addressPolicy));
    return this.reset.complete(username, code, password);
  }
}
