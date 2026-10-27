import { Body, Controller, Get, Param, Patch, UseFilters } from '@nestjs/common';
import { ParentProfileService } from '../profile/parent-profile.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { NotForStaff } from '../../platform/permissions/route-access';

/**
 * The signed-in parent's own profile, and their children's.
 *
 * ## There is no owner id anywhere below
 *
 * Every route reads the caller from the bearer token via `@ActorId()`. None of them accepts
 * a contact id, a family id, or any other ownership target -- so one parent editing another
 * is not a request this API can express. The only client-supplied id is `:learnerId`, which
 * the service treats as untrusted and resolves ONLY inside the caller's own family.
 *
 * ## Why a PATCH that takes both fields
 *
 * `PATCH /me/profile` saves the name and the About together because that is how the screen
 * edits them -- one Save, one round trip, one audit moment. Both fields are optional, so a
 * client may send either alone; an omitted field is left untouched rather than cleared,
 * which is what stops a one-field save from silently wiping the other.
 *
 * ## No photo routes here
 *
 * The parent's and the children's photos are set through `/me/avatar` and
 * `/me/children/:learnerId/avatar` (profile-photo.controller.ts), the one writer every
 * person shares. `GET /me/profile` carries their links.
 */
@Controller('me')
@UseFilters(CommErrorFilter)
export class ParentProfileController {
  constructor(private readonly profile: ParentProfileService) {}

  /** The caller's own profile and their family's children. */
  @NotForStaff()
  @Get('profile')
  async profileOf(@ActorId() actorId: string) {
    return this.profile.me(actorId);
  }

  /** Save the caller's own name and/or About. */
  @NotForStaff()
  @Patch('profile')
  async updateProfile(
    @ActorId() actorId: string,
    @Body() body: { name?: unknown; about?: unknown },
  ) {
    return this.profile.updateMe(actorId, body ?? {});
  }

  // ----------------------------------------------------------------- children

  /** Save one child's name and/or About. The server decides whose child it is. */
  @NotForStaff()
  @Patch('children/:learnerId')
  async updateChild(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
    @Body() body: { name?: unknown; about?: unknown },
  ) {
    return this.profile.updateChild(actorId, learnerId, body ?? {});
  }
}
