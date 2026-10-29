import { Body, Controller, createParamDecorator, ExecutionContext, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import type { Actor } from '../platform/types';
import { Requires } from '../platform/permissions/route-access';
import { StaffAccountsService } from './staff-accounts.service';

const CurrentAccountId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ accountId?: string }>();
  if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
  return request.accountId;
});

/**
 * PD-40 PR-3: staff accounts. Who may do what is StaffAccountsService's (and,
 * behind it, the database's); a key here is necessary, never sufficient.
 */
@Controller('admin/staff-accounts')
@UseFilters(CommErrorFilter)
export class StaffAccountsController {
  constructor(private readonly accounts: StaffAccountsService) {}

  @Requires('staff_accounts.view')
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.accounts.list(actor);
  }

  @Requires('staff_accounts.view')
  @Get(':staffId')
  get(@CurrentActor() actor: Actor, @Param('staffId') staffId: string) {
    return this.accounts.get(actor, staffId);
  }

  /** Body: `{ name, email, tier, departmentId?, roleIds?, reason }`. Returns the first sign-in code ONCE. */
  @Requires('staff_accounts.create')
  @Post()
  @HttpCode(201)
  create(@CurrentActor() actor: Actor, @CurrentAccountId() accountId: string, @Body() body: Record<string, unknown>) {
    return this.accounts.create(actor, accountId, body ?? {});
  }

  /** Body: `{ roleId, reason }`. */
  @Requires('staff_accounts.manage')
  @Post(':staffId/roles')
  @HttpCode(200)
  grant(@CurrentActor() actor: Actor, @Param('staffId') staffId: string, @Body() body: Record<string, unknown>) {
    return this.accounts.grantRole(actor, staffId, body ?? {});
  }

  /** Body: `{ reason }`. */
  @Requires('staff_accounts.manage')
  @Post(':staffId/roles/:roleId/revoke')
  @HttpCode(200)
  revoke(@CurrentActor() actor: Actor, @Param('staffId') staffId: string, @Param('roleId') roleId: string, @Body() body: Record<string, unknown>) {
    return this.accounts.revokeRole(actor, staffId, roleId, body ?? {});
  }

  /** A new first sign-in code; the old one dies. Body: `{ reason }`. Returns the code ONCE. */
  @Requires('staff_accounts.manage')
  @Post(':staffId/setup-code')
  @HttpCode(201)
  setupCode(
    @CurrentActor() actor: Actor,
    @CurrentAccountId() accountId: string,
    @Param('staffId') staffId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.accounts.reissueSetupCode(actor, accountId, staffId, body ?? {});
  }
}

/** PD-40 PR-3: access roles -- named bundles of permissions -- and the catalogue they are made from. */
@Controller('admin')
@UseFilters(CommErrorFilter)
export class AccessRolesController {
  constructor(private readonly accounts: StaffAccountsService) {}

  @Requires('staff_accounts.view', 'access_roles.manage')
  @Get('access-roles')
  roles(@CurrentActor() actor: Actor) {
    return this.accounts.roles(actor);
  }

  /** The super admin, from a checklist, in one step. Body: `{ key, nameEn, nameAr, description?, maxTier?, permissions, reason }`. */
  @Requires('access_roles.manage')
  @Post('access-roles')
  @HttpCode(201)
  define(@CurrentActor() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.accounts.defineRole(actor, body ?? {});
  }

  /** Body: `{ nameEn?, nameAr?, description?, permissions?, reason }`. */
  @Requires('access_roles.manage')
  @Post('access-roles/:roleId')
  @HttpCode(200)
  update(@CurrentActor() actor: Actor, @Param('roleId') roleId: string, @Body() body: Record<string, unknown>) {
    return this.accounts.updateRole(actor, roleId, body ?? {});
  }

  /** Body: `{ reason }`. */
  @Requires('access_roles.manage')
  @Post('access-roles/:roleId/archive')
  @HttpCode(200)
  archive(@CurrentActor() actor: Actor, @Param('roleId') roleId: string, @Body() body: Record<string, unknown>) {
    return this.accounts.archiveRole(actor, roleId, body ?? {});
  }

  @Requires('staff_accounts.view', 'access_roles.manage')
  @Get('permissions')
  permissions() {
    return this.accounts.permissions();
  }
}
