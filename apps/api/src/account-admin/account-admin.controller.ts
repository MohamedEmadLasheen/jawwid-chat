import { Body, Controller, createParamDecorator, ExecutionContext, Get, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import type { Actor } from '../platform/types';
import { AccountAdminService } from './account-admin.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * The caller's own ACCOUNT id -- what chat.session.revoked_by and
 * chat.account.deactivated_by reference. Written only by AuthenticatedGuard.
 */
const CurrentAccountId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ accountId?: string }>();
  if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
  return request.accountId;
});

/**
 * PD-21: `/admin/accounts` -- reset a password, suspend, reactivate.
 * PD-23: list and end an account's sessions.
 *
 * Protected twice, and neither depends on the other: the global
 * AuthenticatedGuard (no verified bearer, no request), and
 * AccountAdminService, which asks AuthorizationService.canAdministerAccount
 * before it acts. No route takes an organization, an actor or a role from the
 * request.
 */
@Controller('admin/accounts')
@UseFilters(CommErrorFilter)
export class AccountAdminController {
  constructor(private readonly accounts: AccountAdminService) {}

  @Requires('accounts.administer')
  @Get()
  list(@CurrentActor() actor: Actor, @Query('q') q?: string, @Query('kind') kind?: string) {
    return this.accounts.list(actor, { q: typeof q === 'string' ? q : undefined, kind: typeof kind === 'string' ? kind : undefined });
  }

  @Requires('accounts.administer')
  @Get(':accountId')
  get(@CurrentActor() actor: Actor, @Param('accountId') accountId: string) {
    return this.accounts.get(actor, accountId);
  }

  /** Returns the one-time code ONCE. Body: `{ reason, signOutEverywhere? }`. */
  @Requires('accounts.administer')
  @Post(':accountId/password-reset')
  @HttpCode(201)
  passwordReset(
    @CurrentActor() actor: Actor,
    @CurrentAccountId() actorAccountId: string,
    @Param('accountId') accountId: string,
    @Body() body: { reason?: unknown; signOutEverywhere?: unknown },
  ) {
    return this.accounts.issuePasswordReset(actor, actorAccountId, accountId, body ?? {});
  }

  /** Body: `{ reason }`. */
  @Requires('accounts.administer')
  @Post(':accountId/suspend')
  @HttpCode(200)
  suspend(
    @CurrentActor() actor: Actor,
    @CurrentAccountId() actorAccountId: string,
    @Param('accountId') accountId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.accounts.suspend(actor, actorAccountId, accountId, body ?? {});
  }

  /** PD-23: the account's live sessions (devices). */
  @Requires('accounts.administer')
  @Get(':accountId/sessions')
  sessions(@CurrentActor() actor: Actor, @Param('accountId') accountId: string) {
    return this.accounts.listSessions(actor, accountId);
  }

  /** PD-23: end every session. Body: `{ reason }`. Declared before `:sessionId/revoke` so the literal wins. */
  @Requires('accounts.administer')
  @Post(':accountId/sessions/revoke-all')
  @HttpCode(200)
  revokeAllSessions(
    @CurrentActor() actor: Actor,
    @CurrentAccountId() actorAccountId: string,
    @Param('accountId') accountId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.accounts.revokeAllSessions(actor, actorAccountId, accountId, body ?? {});
  }

  /** PD-23: end one session. Body: `{ reason }`. */
  @Requires('accounts.administer')
  @Post(':accountId/sessions/:sessionId/revoke')
  @HttpCode(200)
  revokeSession(
    @CurrentActor() actor: Actor,
    @CurrentAccountId() actorAccountId: string,
    @Param('accountId') accountId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.accounts.revokeSession(actor, actorAccountId, accountId, sessionId, body ?? {});
  }

  /** Body: `{ reason }`. */
  @Requires('accounts.administer')
  @Post(':accountId/reactivate')
  @HttpCode(200)
  reactivate(@CurrentActor() actor: Actor, @Param('accountId') accountId: string, @Body() body: { reason?: unknown }) {
    return this.accounts.reactivate(actor, accountId, body ?? {});
  }
}
