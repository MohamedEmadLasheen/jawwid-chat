import { Body, Controller, Get, HttpCode, Inject, Ip, Optional, Post } from '@nestjs/common';
import { Public } from '../platform/auth/auth.guard';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { LoginRateLimiter } from '../platform/auth/login-rate-limit';
import { CLIENT_ADDRESS_POLICY, readClientAddressPolicy, sourceAddress, type ClientAddressPolicy } from '../platform/auth/client-address';
import { AccountRecoveryService } from './account-recovery.service';

/**
 * PD-25: a parent recovers their account from the sign-in screen. Public, and
 * every POST spends the login limiter (per identifier and per source) before
 * anything else, exactly like POST /auth/login. Setting the new password is the
 * PD-21 completion, POST /auth/password-reset.
 */
@Controller('auth/recovery')
export class AccountRecoveryController {
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly recovery: AccountRecoveryService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

  /** Which ways in are switched on in this deployment: `{ email, whatsapp, codeMinutes }`. */
  @Public()
  @Get('options')
  options() {
    return this.recovery.options();
  }

  /** Forgot password. Always `{ ok: true }`: the answer never says whether the e-mail is a parent's. */
  @Public()
  @Post('password')
  @HttpCode(200)
  async password(@Body() body: { email?: unknown }, @Ip() ip?: string) {
    const email = typeof body?.email === 'string' ? body.email : '';
    await this.rateLimit.reserve(`recover-email:${email.trim().toLowerCase()}`, sourceAddress(ip, this.addressPolicy));
    return this.recovery.requestByEmail(email);
  }

  /** Forgot e-mail, step 1. Always `{ ok: true }`: the answer never says whether the phone is on file. */
  @Public()
  @Post('email')
  @HttpCode(200)
  async email(@Body() body: { phone?: unknown }, @Ip() ip?: string) {
    const phone = typeof body?.phone === 'string' ? body.phone : '';
    await this.rateLimit.reserve(phoneKey(phone), sourceAddress(ip, this.addressPolicy));
    return this.recovery.requestByPhone(phone);
  }

  /** Forgot e-mail, step 2: `{ emails }` the code is good for, or AUTH.RESET_CODE_INVALID. */
  @Public()
  @Post('email/verify')
  @HttpCode(200)
  async verifyEmail(@Body() body: { phone?: unknown; code?: unknown }, @Ip() ip?: string) {
    const phone = typeof body?.phone === 'string' ? body.phone : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!phone || !code) throw new AuthError(AuthErrorCode.RESET_CODE_INVALID);
    await this.rateLimit.reserve(phoneKey(phone), sourceAddress(ip, this.addressPolicy));
    return this.recovery.confirmByPhone(phone, code);
  }
}

/** One limiter bucket per number however it is spaced; the digits only, never stored. */
function phoneKey(phone: string): string {
  return `recover-phone:${phone.replace(/[^0-9]/g, '').slice(-9)}`;
}
