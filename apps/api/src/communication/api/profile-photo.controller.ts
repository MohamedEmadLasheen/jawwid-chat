import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { AvatarService } from '../profile/avatar.service';
import { NotForStaff, SelfService } from '../../platform/permissions/route-access';
import { RequiresLegal } from '../../legal/requires-legal.decorator';

/**
 * Profile photos for parents and teachers (their own) and for parents'
 * children. Two steps, as for staff photos: `upload` returns a signed PUT
 * bound to type and size, then `POST ... avatar { objectKey }` commits it once
 * the stored bytes are checked. Staff use POST /staff-profiles/me/avatar.
 */
@Controller('me')
export class ProfilePhotoController {
  constructor(private readonly avatars: AvatarService) {}

  /** The caller's photo and, for a parent, each child's -- as links for the caller. */
  @SelfService()
  @Get('photo')
  mine(@ActorId() actorId: string) {
    return this.avatars.mine(actorId);
  }

  @SelfService()
  @RequiresLegal()
  @Post('avatar/upload')
  upload(@ActorId() actorId: string, @Body() body: { mimeType?: unknown; byteSize?: unknown }) {
    return this.avatars.authorizeUpload(actorId, { kind: 'self' }, body ?? {});
  }

  @SelfService()
  @RequiresLegal()
  @Post('avatar')
  commit(@ActorId() actorId: string, @Body() body: { objectKey?: unknown }) {
    return this.avatars.commit(actorId, { kind: 'self' }, body ?? {});
  }

  @SelfService()
  @RequiresLegal()
  @Delete('avatar')
  remove(@ActorId() actorId: string) {
    return this.avatars.remove(actorId, { kind: 'self' });
  }

  @NotForStaff()
  @RequiresLegal()
  @Post('children/:learnerId/avatar/upload')
  childUpload(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
    @Body() body: { mimeType?: unknown; byteSize?: unknown },
  ) {
    return this.avatars.authorizeUpload(actorId, { kind: 'child', learnerId }, body ?? {});
  }

  @NotForStaff()
  @RequiresLegal()
  @Post('children/:learnerId/avatar')
  childCommit(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: { objectKey?: unknown }) {
    return this.avatars.commit(actorId, { kind: 'child', learnerId }, body ?? {});
  }

  @NotForStaff()
  @RequiresLegal()
  @Delete('children/:learnerId/avatar')
  childRemove(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    return this.avatars.remove(actorId, { kind: 'child', learnerId });
  }
}
