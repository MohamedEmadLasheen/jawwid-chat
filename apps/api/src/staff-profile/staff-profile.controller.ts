import { Body, Controller, Delete, Get, Param, Patch, Post, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import type { Actor } from '../platform/types';
import { StaffProfileService } from './staff-profile.service';

/**
 * `/staff-profiles` -- staff profiles, responsibilities, teams and the super
 * admin's organization overview.
 *
 * Protected twice, independently:
 *   1. the global AuthenticatedGuard -- no verified bearer token, no request;
 *   2. StaffProfileService asks AuthorizationService.staffProfileAccess (or
 *      canViewOrganizationProfiles) before it reads or writes anything.
 *
 * `:staffId` is the TARGET, never the caller: the caller is always
 * `request.actor`. `me` names the caller's own profile. No route accepts a
 * role, a permission, an account status, an organization or an actor id in its
 * body, so there is nothing to send that would widen what the caller may do.
 * Hiding a control in the Admin Web is UX; these routes are the control.
 */
@Controller('staff-profiles')
@UseFilters(CommErrorFilter)
export class StaffProfileController {
  constructor(private readonly profiles: StaffProfileService) {}

  /** The caller's direct reports (managers; the super admin's reports). */
  @Get('team')
  team(@CurrentActor() actor: Actor) {
    return this.profiles.team(actor);
  }

  /** Super admin only: the organization's staff, teams, coverage, workload and health. */
  @Get('organization')
  organization(@CurrentActor() actor: Actor) {
    return this.profiles.organization(actor);
  }

  @Get(':staffId')
  profile(@CurrentActor() actor: Actor, @Param('staffId') staffId: string) {
    return this.profiles.profile(actor, staffId);
  }

  @Get(':staffId/activity')
  activity(@CurrentActor() actor: Actor, @Param('staffId') staffId: string) {
    return this.profiles.activity(actor, staffId);
  }

  /** Job title, introduction, display name. Only the fields sent change. */
  @Patch(':staffId')
  update(@CurrentActor() actor: Actor, @Param('staffId') staffId: string, @Body() body: Record<string, unknown>) {
    return this.profiles.updateProfile(actor, staffId, body && typeof body === 'object' ? body : {});
  }

  /** A signed PUT bound to type and size, under this profile's own prefix. */
  @Post(':staffId/avatar/upload')
  avatarUpload(
    @CurrentActor() actor: Actor,
    @Param('staffId') staffId: string,
    @Body() body: { mimeType?: unknown; byteSize?: unknown },
  ) {
    return this.profiles.authorizeAvatarUpload(actor, staffId, body ?? {});
  }

  /** Commit an uploaded object as the photo, after its bytes are inspected. */
  @Post(':staffId/avatar')
  avatarCommit(
    @CurrentActor() actor: Actor,
    @Param('staffId') staffId: string,
    @Body() body: { objectKey?: unknown },
  ) {
    return this.profiles.commitAvatar(actor, staffId, body ?? {});
  }

  @Delete(':staffId/avatar')
  avatarRemove(@CurrentActor() actor: Actor, @Param('staffId') staffId: string) {
    return this.profiles.removeAvatar(actor, staffId);
  }

  @Post(':staffId/responsibilities')
  assign(
    @CurrentActor() actor: Actor,
    @Param('staffId') staffId: string,
    @Body() body: { category?: unknown; scopeNote?: unknown },
  ) {
    return this.profiles.assignResponsibility(actor, staffId, body ?? {});
  }

  @Post(':staffId/responsibilities/:responsibilityId/end')
  end(
    @CurrentActor() actor: Actor,
    @Param('staffId') staffId: string,
    @Param('responsibilityId') responsibilityId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.profiles.endResponsibility(actor, staffId, responsibilityId, body ?? {});
  }

  /** Super admin only. `managerStaffId: null` removes the line. A reason is required. */
  @Post(':staffId/reporting-line')
  reportingLine(
    @CurrentActor() actor: Actor,
    @Param('staffId') staffId: string,
    @Body() body: { managerStaffId?: unknown; reason?: unknown },
  ) {
    return this.profiles.setReportingLine(actor, staffId, body ?? {});
  }
}
