import { Body, Controller, Headers, HttpCode, Inject, Ip, Optional, Post } from '@nestjs/common';
import { Public } from './auth.guard';
import { AuthError, AuthErrorCode } from './auth.errors';
import { LoginRateLimiter } from './login-rate-limit';
import { ParentSignupService } from './parent-signup.service';
import { CLIENT_ADDRESS_POLICY, readClientAddressPolicy, sourceAddress, type ClientAddressPolicy } from './client-address';
import { toTokenPairDto, type TokenPairDto } from './auth.dto';

/**
 * PD-16: a parent sets the password of the account Chat created for them at
 * enrolment. Public, and metered by the login limiter BEFORE anything else --
 * per identifier and per source -- exactly like POST /auth/login.
 */
@Controller('auth/signup')
export class ParentSignupController {
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly signup: ParentSignupService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

  /** Always `{ ok: true }`: the answer never says whether the e-mail is a parent's. */
  @Public()
  @Post('request')
  @HttpCode(200)
  async request(@Body() body: { email?: unknown }, @Ip() ip?: string) {
    const email = typeof body?.email === 'string' ? body.email : '';
    await this.rateLimit.reserve(`signup:${email.trim().toLowerCase()}`, sourceAddress(ip, this.addressPolicy));
    return this.signup.request(email);
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body() body: { email?: unknown; code?: unknown; password?: unknown },
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ): Promise<TokenPairDto> {
    const email = typeof body?.email === 'string' ? body.email : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !code) throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
    await this.rateLimit.reserve(`signup:${email.trim().toLowerCase()}`, sourceAddress(ip, this.addressPolicy));
    return toTokenPairDto(await this.signup.verify(email, code, password, { userAgent, ip }));
  }
}
