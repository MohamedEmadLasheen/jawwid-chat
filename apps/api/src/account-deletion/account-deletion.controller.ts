import { Body, Controller, Get, HttpCode, Inject, Ip, Optional, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Public, type AuthenticatedRequest } from '../platform/auth/auth.guard';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { CLIENT_ADDRESS_POLICY, readClientAddressPolicy, sourceAddress, type ClientAddressPolicy } from '../platform/auth/client-address';
import { LoginRateLimiter } from '../platform/auth/login-rate-limit';
import { SelfService } from '../platform/permissions/route-access';
import { AccountDeletionService } from './account-deletion.service';
import { renderDeletionPage, type DeletionLang, type DeletionPageState } from './account-deletion-page';

/**
 * PD-56: `POST /me/account/delete {password}` -- the signed-in parent or
 * teacher deletes their own account (Apple 5.1.1(v)). The password is asked
 * again; the same limiter as a password change. A support session cannot
 * reach it: it is a write the support-session allowlist does not name.
 */
@Controller('me/account')
@UseFilters(CommErrorFilter)
export class AccountDeletionController {
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

  @SelfService()
  @Post('delete')
  @HttpCode(200)
  async delete(@Req() request: AuthenticatedRequest, @Body() body: unknown, @Ip() ip?: string): Promise<{ deleted: true }> {
    if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    const password = passwordOf(body);
    if (!password) throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);
    const key = `account-delete:${request.accountId}`;
    await this.rateLimit.reserve(key, sourceAddress(ip, this.addressPolicy));
    await this.deletion.deleteOwn(request.accountId, password);
    await this.rateLimit.clearIdentifier(key);
    return { deleted: true };
  }
}

interface HtmlResponse {
  status(code: number): HtmlResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

/**
 * PD-56: the public page Google Play links to -- `GET /account-deletion`
 * (the form) and `POST /account-deletion` (sign-in name, password, and a
 * tick that the holder understands). Server-rendered, no script; its CSP lets
 * it post only to itself. Same limiter and lockout as a sign-in.
 */
@Public()
@Controller('account-deletion')
export class AccountDeletionPageController {
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

  @Get()
  page(@Query('lang') lang: string | undefined, @Res() res: HtmlResponse) {
    send(res, 200, langOf(lang), { kind: 'form' });
  }

  @Post()
  async submit(@Query('lang') lang: string | undefined, @Body() body: unknown, @Ip() ip: string | undefined, @Res() res: HtmlResponse) {
    const l = langOf(lang);
    const input = (body ?? {}) as Record<string, unknown>;
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = passwordOf(body);
    if (!username || !password || input.confirm !== 'yes') return send(res, 400, l, { kind: 'form', error: 'incomplete' });
    const key = `account-delete-web:${username.toLowerCase()}`;
    try {
      await this.rateLimit.reserve(key, sourceAddress(ip, this.addressPolicy));
      await this.deletion.deleteBySignIn(username, password);
      await this.rateLimit.clearIdentifier(key);
      return send(res, 200, l, { kind: 'done' });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      const error: NonNullable<Extract<DeletionPageState, { kind: 'form' }>['error']> =
        e.code === AuthErrorCode.RATE_LIMITED ? 'rate_limited'
        : e.code === AuthErrorCode.ACCOUNT_LOCKED ? 'locked'
        : e.code === AuthErrorCode.FORBIDDEN ? 'staff'
        : 'invalid';
      return send(res, e.code === AuthErrorCode.RATE_LIMITED ? 429 : e.code === AuthErrorCode.FORBIDDEN ? 403 : 401, l, { kind: 'form', error });
    }
  }
}

function passwordOf(body: unknown): string {
  const v = ((body ?? {}) as Record<string, unknown>).password;
  return typeof v === 'string' && v.length > 0 ? v : '';
}

function langOf(v: string | undefined): DeletionLang {
  return v === 'en' ? 'en' : 'ar';
}

function send(res: HtmlResponse, status: number, lang: DeletionLang, state: DeletionPageState) {
  const nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.status(status).send(renderDeletionPage(lang, state, nonce));
}
