import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { Public } from '../../platform/auth/auth.guard';
import { MediaUrlSigner } from '../../platform/media-url';
import { PrismaService } from '../../platform/prisma.service';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage } from '../attachments/object-storage';
import { TeacherProfileService } from '../teacher-profile/teacher-profile.service';
import { serveAuthorizedMedia, type RequestLike, type ResponseLike } from './media-serve';

/**
 * RT-037 -- a teacher's qualification certificate files, served through the
 * same access-checked media path as attachments, story
 * media and photos (`serveAuthorizedMedia`, one implementation): link
 * signature + expiry, the reader LIVE now, and then the Teacher Profile's own
 * read rule, re-decided on every request. `@Public()` to the bearer guard
 * because an <img> or a PDF viewer cannot send a header; the link is the
 * binding.
 *
 * Its own controller, as StaffPhotoController is, so the attachment route's
 * constructor -- and every suite that builds it -- is untouched.
 */
@Public()
@Controller('media')
export class TeacherMediaController {
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly profiles: TeacherProfileService,
  ) {}

  /** The owning teacher or a reviewer -- TeacherProfileService.authorizeCertificateRead. */
  @Get('teacher-certificates/:certificateId')
  async certificate(
    @Param('certificateId') certificateId: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    return serveAuthorizedMedia(
      { signer: this.signer, prisma: this.prisma, storage: this.storage },
      'teacher-certificates', certificateId, variant, actorId, expires, sig, req, res,
      () => this.profiles.authorizeCertificateRead(certificateId, actorId),
    );
  }
}
