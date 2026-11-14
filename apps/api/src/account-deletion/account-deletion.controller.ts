import { Body, Controller, Get, HttpCode, Inject, Ip, Optional, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Public, type AuthenticatedRequest } from '../platform/auth/auth.guard';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { CLIENT_ADDRESS_POLICY, readClientAddressPolicy, sourceAddress, type ClientAddressPolicy } from '../platform/auth/client-address';
import { LoginRateLimiter } from '../platform/auth/login-rate-limit';
import { SelfService } from '../platform/permissions/route-access';
import { AccountDeletionService, type DeletionOutcome } from './account-deletion.service';
import { TeacherDeletionRequestService } from './teacher-deletion-request.service';
import { renderDeletionPage, type DeletionLang, type DeletionPageState } from './account-deletion-page';
import { formTokenValid, issueFormToken } from './deletion-form-token';

/**
 * PD-56: `POST /me/account/delete {password}` -- the signed-in parent or
 * teacher deletes their own account (Apple 5.1.1(v)). The password is asked
 * again; the same limiter as a password change. A support session cannot
 * reach it: it is a write the support-session allowlist does not name.
 *
 * O-3 (owner, 2026-11-07): a teacher with a lesson, a student or payroll open
 * is not refused. The answer is `{deleted: false, request}`: a deletion
 * request, deleted by its deadline (30 days). Asking again returns the same
 * request. `GET /me/account/deletion` says beforehand which it will be;
 * `POST /me/account/deletion-request/cancel` withdraws a pending request.
 */
@Controller('me/account')
@UseFilters(CommErrorFilter)
export class AccountDeletionController {
  private readonly addressPolicy: ClientAddressPolicy;

  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly requests: TeacherDeletionRequestService,
    private readonly rateLimit: LoginRateLimiter,
    @Optional() @Inject(CLIENT_ADDRESS_POLICY) addressPolicy?: ClientAddressPolicy,
  ) {
    this.addressPolicy = addressPolicy ?? readClientAddressPolicy();
  }

  @SelfService()
  @Post('delete')
  @HttpCode(200)
  async delete(@Req() request: AuthenticatedRequest, @Body() body: unknown, @Ip() ip?: string): Promise<DeletionOutcome> {
    if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    const password = passwordOf(body);
    if (!password) throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);
    const key = `account-delete:${request.accountId}`;
    await this.rateLimit.reserve(key, sourceAddress(ip, this.addressPolicy));
    const outcome = await this.deletion.deleteOwn(request.accountId, password);
    // A request (O-3) keeps its attempt counted: request-then-cancel cycles
    // stay within the limit (review of 00ccd748). A deleted account has no use for it.
    if (outcome.deleted) await this.rateLimit.clearIdentifier(key);
    return outcome;
  }

  /** O-3: whether deleting is immediate, the teacher's request, and the deadline a request would have. */
  @SelfService()
  @Get('deletion')
  status(@Req() request: AuthenticatedRequest) {
    if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    return this.requests.status(request.accountId);
  }

  /** O-3: the holder withdraws their pending request. Only their own: the route takes no id. */
  @SelfService()
  @Post('deletion-request/cancel')
  @HttpCode(200)
  async cancel(@Req() request: AuthenticatedRequest, @Ip() ip?: string) {
    if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    // Limited as the request is, and never cleared on success.
    await this.rateLimit.reserve(`account-deletion-cancel:${request.accountId}`, sourceAddress(ip, this.addressPolicy));
    return { request: await this.requests.cancel(request.accountId) };
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
    // Anti-forgery first: a POST this page did not render is refused unread.
    if (!formTokenValid(input.token)) return send(res, 400, l, { kind: 'form', error: 'expired' });
    if (!username || !password || input.confirm !== 'yes') return send(res, 400, l, { kind: 'form', error: 'incomplete' });
    const key = `account-delete-web:${username.toLowerCase()}`;
    try {
      await this.rateLimit.reserve(key, sourceAddress(ip, this.addressPolicy));
      const outcome = await this.deletion.deleteBySignIn(username, password);
      if (outcome.deleted) await this.rateLimit.clearIdentifier(key);
      // O-3: a teacher with work open -- a request, deleted by its deadline.
      if (!outcome.deleted) return send(res, 200, l, { kind: 'requested', deadlineAt: outcome.request.deadlineAt });
      return send(res, 200, l, { kind: 'done' });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      // Unknown, wrong password and locked read the same -- the page never says
      // whether an account exists. Past the password: staff.
      const error: NonNullable<Extract<DeletionPageState, { kind: 'form' }>['error']> =
        e.code === AuthErrorCode.RATE_LIMITED ? 'rate_limited'
        : e.code === AuthErrorCode.FORBIDDEN ? 'staff'
        : 'invalid';
      const status = { rate_limited: 429, staff: 403 } as Record<string, number>;
      return send(res, status[error] ?? 401, l, { kind: 'form', error });
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
  res.status(status).send(renderDeletionPage(lang, state, nonce, issueFormToken()));
}
