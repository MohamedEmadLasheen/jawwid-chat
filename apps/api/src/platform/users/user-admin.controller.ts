import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseFilters } from '@nestjs/common';
import { UserAdminService } from './user-admin.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../types';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';

/**
 * Account administration. Every route requires `users.manage` and is confined
 * to the acting administrator's own organization.
 *
 * The account id in the path is not trusted to belong to the caller's tenant:
 * it is looked up with the tenant filter applied, and an account in another
 * organization is reported as not found.
 */
@Controller('users/accounts')
@UseFilters(CommErrorFilter)
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  @Get()
  async list(@CurrentActor() actor: Actor, @Query('limit') limit?: string) {
    return { accounts: await this.users.list(actor, limit ? Number(limit) : undefined) };
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.users.get(actor, id);
  }

  @Post(':id/activate')
  async activate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    await this.users.activate(actor, id, String(body?.reason ?? ''));
    return { ok: true };
  }

  @Post(':id/suspend')
  async suspend(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    await this.users.suspend(actor, id, String(body?.reason ?? ''));
    return { ok: true };
  }

  @Post(':id/deactivate')
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    await this.users.deactivate(actor, id, String(body?.reason ?? ''));
    return { ok: true };
  }

  /** Provision or replace a credential. All of that account's sessions end. */
  @Post(':id/password')
  async setPassword(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { password?: string; reason?: string },
  ) {
    await this.users.setPassword(
      actor,
      id,
      String(body?.password ?? ''),
      String(body?.reason ?? 'credential provisioned'),
    );
    return { ok: true };
  }

  /** Mint a reset token to hand over. Returned once and never stored in clear. */
  @Post(':id/reset-token')
  async resetToken(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.users.issueResetToken(actor, id);
  }

  @Post(':id/verification-token')
  async verificationToken(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.users.issueVerificationToken(actor, id);
  }

  @Delete(':id/sessions')
  async revokeSessions(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('reason') reason = 'revoked by an administrator',
  ) {
    return { revoked: await this.users.revokeSessions(actor, id, reason) };
  }

  /** A per-account ALLOW or DENY. DENY beats the role default. */
  @Put(':id/permissions/:permission')
  async setOverride(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('permission') permission: string,
    @Body() body: { effect?: string; reason?: string; expiresAt?: string | null },
  ) {
    await this.users.setOverride(
      actor,
      id,
      permission,
      String(body?.effect ?? ''),
      String(body?.reason ?? ''),
      body?.expiresAt ? new Date(body.expiresAt) : null,
    );
    return { ok: true };
  }

  @Delete(':id/permissions/:permission')
  async clearOverride(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('permission') permission: string,
    @Query('reason') reason = 'override cleared',
  ) {
    await this.users.clearOverride(actor, id, permission, reason);
    return { ok: true };
  }
}
