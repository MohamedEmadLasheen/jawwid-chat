import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import type { Actor } from '../platform/types';
import { Requires } from '../platform/permissions/route-access';
import { FamilyAccessService } from './family-access.service';

/**
 * ADMIN-002: exceptional, time-boxed access to one family's parent accounts.
 * The key is the Accounts page's; FamilyAccessService decides who grants
 * (the Operations Manager, the super admin), who revokes and who sees what.
 */
@Controller('admin/family-access-grants')
@UseFilters(CommErrorFilter)
export class FamilyAccessController {
  constructor(private readonly access: FamilyAccessService) {}

  @Requires('accounts.administer')
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.access.list(actor);
  }

  @Requires('accounts.administer')
  @Post()
  grant(@CurrentActor() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.access.grant(actor, body ?? {});
  }

  @Requires('accounts.administer')
  @Post(':grantId/revoke')
  @HttpCode(200)
  revoke(@CurrentActor() actor: Actor, @Param('grantId') grantId: string, @Body() body: Record<string, unknown>) {
    return this.access.revoke(actor, grantId, body ?? {});
  }
}
