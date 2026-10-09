import { Body, Controller, Delete, Get, Param, Patch, Post, UseFilters } from '@nestjs/common';
import { ParentProfileService } from '../profile/parent-profile.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

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
 * ## Photos are a two-step, and the bytes never come here
 *
 * Authorize, then PUT the bytes STRAIGHT to storage on the returned signed URL, then tell
 * this API the key. The same pipeline attachments and stories use; no storage credential
 * ever reaches a client, and no image ever passes through this process.
 */
@Controller('me')
@UseFilters(CommErrorFilter)
export class ParentProfileController {
  constructor(private readonly profile: ParentProfileService) {}

  /** The caller's own profile and their family's children. */
  @Get('profile')
  async profileOf(@ActorId() actorId: string) {
    return this.profile.me(actorId);
  }

  /** Save the caller's own name and/or About. */
  @Patch('profile')
  async updateProfile(
    @ActorId() actorId: string,
    @Body() body: { name?: unknown; about?: unknown },
  ) {
    return this.profile.updateMe(actorId, body ?? {});
  }

  /**
   * Authorize a photo upload. The signature is bound to the exact type and size authorized
   * here, so a file that changed afterwards is refused by storage rather than accepted.
   */
  @Post('avatar/authorize')
  async authorizeAvatar(
    @ActorId() actorId: string,
    @Body() body: { mimeType?: unknown; byteSize?: unknown },
  ) {
    return this.profile.authorizeAvatarUpload(actorId, {
      mimeType: body?.mimeType,
      byteSize: body?.byteSize,
    });
  }

  @Post('avatar')
  async setAvatar(@ActorId() actorId: string, @Body() body: { objectKey?: unknown }) {
    return this.profile.setAvatar(actorId, body?.objectKey);
  }

  @Delete('avatar')
  async removeAvatar(@ActorId() actorId: string) {
    return this.profile.removeAvatar(actorId);
  }

  // ----------------------------------------------------------------- children

  /** Save one child's name and/or About. The server decides whose child it is. */
  @Patch('children/:learnerId')
  async updateChild(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
    @Body() body: { name?: unknown; about?: unknown },
  ) {
    return this.profile.updateChild(actorId, learnerId, body ?? {});
  }

  @Post('children/:learnerId/avatar')
  async setChildAvatar(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
    @Body() body: { objectKey?: unknown },
  ) {
    return this.profile.setChildAvatar(actorId, learnerId, body?.objectKey);
  }

  @Delete('children/:learnerId/avatar')
  async removeChildAvatar(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
  ) {
    return this.profile.removeChildAvatar(actorId, learnerId);
  }
}
