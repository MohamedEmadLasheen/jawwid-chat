import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { Public } from '../platform/auth/auth.guard';
import { MediaUrlSigner } from '../platform/media-url';
import { PrismaService } from '../platform/prisma.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { serveAuthorizedMedia, type RequestLike, type ResponseLike } from '../communication/api/media-serve';
import { StaffProfileService } from './staff-profile.service';

/**
 * RT-037 -- staff profile photos, served through the same access-checked media
 * path as attachments and story media (`serveAuthorizedMedia`, one
 * implementation): link signature + expiry, the reader LIVE now, and then
 * `StaffProfileService.authorizePhotoRead` -- the profile-visibility rules this
 * service already applies, re-decided on every request. `@Public()` to the
 * bearer guard because an <img> cannot send a header; the link is the binding.
 */
@Public()
@Controller('media')
export class StaffPhotoController {
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly profiles: StaffProfileService,
  ) {}

  @Get('staff/:staffId')
  async photo(
    @Param('staffId') staffId: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    return serveAuthorizedMedia(
      { signer: this.signer, prisma: this.prisma, storage: this.storage },
      'staff', staffId, variant, actorId, expires, sig, req, res,
      () => this.profiles.authorizePhotoRead(actorId, staffId),
    );
  }
}
