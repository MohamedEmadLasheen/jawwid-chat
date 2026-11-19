import { Body, Controller, Get, HttpCode, Post, Req, UseFilters } from '@nestjs/common';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Public, type AuthenticatedRequest } from '../platform/auth/auth.guard';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { CommError, CommErrorCode } from '../platform/errors';
import { SelfService } from '../platform/permissions/route-access';
import { ACCEPT_BODY_KEYS, LegalService } from './legal.service';
import type { LegalDto, LegalStateDto } from './legal-documents';

/**
 * PD-58 (roadmap §7.4): the account's Terms of Use.
 *
 *   GET  /me/legal          -> 200 {required: [...], documents: [{documentKey, version,
 *                              urlAr, urlEn, accepted, acceptedVersion, acceptedAt}]}
 *   POST /me/legal/accept   {documents: [{documentKey, version}], client, locale}
 *                           -> 200 {legal: {required: [...]}} (empty once done)
 *
 * Neither is ever gated: they are how an account gets through the gate.
 *
 * The account is the AUTHENTICATED one (the token's); the body may not name
 * one -- any field beyond documents, client and locale is 400. Recorded with
 * method 'gate' (P-2). A
 * support session (an administrator acting as the person) never accepts for
 * them: 403 COMM.SUPPORT_SESSION_FORBIDDEN (the support-session interceptor
 * refuses it too -- it is not on its allowlist).
 */
@Controller('me/legal')
@UseFilters(CommErrorFilter)
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @SelfService()
  @Get()
  async state(@Req() request: AuthenticatedRequest): Promise<LegalStateDto> {
    if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    return this.legal.stateFor(request.accountId);
  }

  @SelfService()
  @Post('accept')
  @HttpCode(200)
  async accept(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<{ legal: LegalDto }> {
    if (!request.accountId || !request.actor) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    if (request.impersonation) {
      throw new CommError(CommErrorCode.SUPPORT_SESSION_FORBIDDEN, 'a support session never accepts the Terms of Use for the person', 403);
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new CommError(CommErrorCode.VALIDATION, 'the body is {documents, client, locale}', 400);
    }
    const input = body as Record<string, unknown>;
    const extra = Object.keys(input).filter((k) => !ACCEPT_BODY_KEYS.has(k));
    if (extra.length > 0) {
      // Above all an account id: the account is the token's, never the body's.
      throw new CommError(CommErrorCode.VALIDATION, `unknown field: ${extra.sort().join(', ')}`, 400);
    }
    const legal = await this.legal.accept(request.accountId, {
      documents: input.documents,
      client: input.client,
      locale: input.locale,
    });
    return { legal };
  }
}

/**
 * PD-58 + PD-16: what a parent accepts on the sign-up screen, BEFORE they can
 * sign in -- the family terms and the Code of Conduct in force, with the URLs
 * for each language. Public: these are public documents, and the answer is the
 * same for everyone (no e-mail, no account).
 *
 *   GET /auth/signup/legal  -> 200 {required: [{documentKey, version, urlAr, urlEn}]}
 *                              (empty only outside production with nothing configured)
 */
@Controller('auth/signup')
@UseFilters(CommErrorFilter)
export class SignupLegalController {
  constructor(private readonly legal: LegalService) {}

  @Public()
  @Get('legal')
  async current(): Promise<Pick<LegalDto, 'required'>> {
    return { required: await this.legal.currentFor('family') };
  }
}
