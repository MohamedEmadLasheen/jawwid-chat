import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { AvatarService } from '../profile/avatar.service';

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
  @Get('photo')
  mine(@ActorId() actorId: string) {
    return this.avatars.mine(actorId);
  }

  @Post('avatar/upload')
  upload(@ActorId() actorId: string, @Body() body: { mimeType?: unknown; byteSize?: unknown }) {
    return this.avatars.authorizeUpload(actorId, { kind: 'self' }, body ?? {});
  }

  @Post('avatar')
  commit(@ActorId() actorId: string, @Body() body: { objectKey?: unknown }) {
    return this.avatars.commit(actorId, { kind: 'self' }, body ?? {});
  }

  @Delete('avatar')
  remove(@ActorId() actorId: string) {
    return this.avatars.remove(actorId, { kind: 'self' });
  }

  @Post('children/:learnerId/avatar/upload')
  childUpload(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
    @Body() body: { mimeType?: unknown; byteSize?: unknown },
  ) {
    return this.avatars.authorizeUpload(actorId, { kind: 'child', learnerId }, body ?? {});
  }

  @Post('children/:learnerId/avatar')
  childCommit(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: { objectKey?: unknown }) {
    return this.avatars.commit(actorId, { kind: 'child', learnerId }, body ?? {});
  }

  @Delete('children/:learnerId/avatar')
  childRemove(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    return this.avatars.remove(actorId, { kind: 'child', learnerId });
  }
}
