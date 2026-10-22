import { Body, Controller, createParamDecorator, ExecutionContext, Get, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import type { Actor } from '../platform/types';
import { AccountAdminService } from './account-admin.service';

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
 * PD-20: `/admin/accounts` -- reset a password, suspend, reactivate.
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

  @Get()
  list(@CurrentActor() actor: Actor, @Query('q') q?: string, @Query('kind') kind?: string) {
    return this.accounts.list(actor, { q: typeof q === 'string' ? q : undefined, kind: typeof kind === 'string' ? kind : undefined });
  }

  @Get(':accountId')
  get(@CurrentActor() actor: Actor, @Param('accountId') accountId: string) {
    return this.accounts.get(actor, accountId);
  }

  /** Returns the one-time code ONCE. Body: `{ reason, signOutEverywhere? }`. */
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

  /** Body: `{ reason }`. */
  @Post(':accountId/reactivate')
  @HttpCode(200)
  reactivate(@CurrentActor() actor: Actor, @Param('accountId') accountId: string, @Body() body: { reason?: unknown }) {
    return this.accounts.reactivate(actor, accountId, body ?? {});
  }
}
