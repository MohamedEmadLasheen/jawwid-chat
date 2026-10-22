import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import type { Actor } from '../platform/types';
import { ImpersonationService, type AdministratorContext } from './impersonation.service';

interface AdminRequest {
  actor?: Actor;
  accountId?: string;
  sessionId?: string;
}

/** The administrator as AuthenticatedGuard established them: actor, own account, own session. */
function administrator(request: AdminRequest): AdministratorContext {
  if (!request.actor || !request.accountId || !request.sessionId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
  return { actor: request.actor, accountId: request.accountId, sessionId: request.sessionId };
}

/**
 * PD-21: `/admin/impersonations` -- support sessions.
 *
 * Every route runs on the ADMINISTRATOR's own token. A support session's token
 * cannot reach any of them: its actor is the parent or teacher, and
 * ImpersonationService refuses anyone but staff before any lookup.
 */
@Controller('admin/impersonations')
@UseFilters(CommErrorFilter)
export class ImpersonationController {
  constructor(private readonly impersonations: ImpersonationService) {}

  /** Body: `{ accountId, reason }`. Returns the support session and an access token for it. */
  @Post()
  @HttpCode(201)
  start(@Req() request: AdminRequest, @Body() body: { accountId?: unknown; reason?: unknown }) {
    return this.impersonations.start(administrator(request), body ?? {});
  }

  /** The record: the super admin's whole organization, anyone else their own. `?accountId=` narrows it. */
  @Get()
  list(@CurrentActor() actor: Actor, @Query('accountId') accountId?: string) {
    return this.impersonations.list(actor, { accountId: typeof accountId === 'string' ? accountId : undefined });
  }

  /** The trail: every request made in one support session. */
  @Get(':id/actions')
  actions(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.impersonations.actions(actor, id);
  }

  /** A fresh access token (after a reload, or to keep working); extends by one step, never past the hour. */
  @Post(':id/token')
  @HttpCode(200)
  token(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.impersonations.token(administrator(request), id);
  }

  /** Exit: ends the support session and its session. Idempotent. */
  @Post(':id/end')
  @HttpCode(200)
  end(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.impersonations.end(administrator(request), id);
  }
}
