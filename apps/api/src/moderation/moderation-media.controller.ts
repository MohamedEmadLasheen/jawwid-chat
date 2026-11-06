import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { Public } from '../platform/auth/auth.guard';
import { MediaUrlSigner } from '../platform/media-url';
import { PrismaService } from '../platform/prisma.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { serveAuthorizedMedia, type RequestLike, type ResponseLike } from '../communication/api/media-serve';
import { ModerationService } from './moderation.service';

/**
 * PD-57 closure plan §4: one evidence attachment of a report, through the
 * same signed, per-viewer, re-authorized media path as every file (RT-037).
 * The link comes from POST /moderation/reports/:id/attachments/:index/url
 * (5 minutes, one staff member); `id` is `<reportId>.<index>`.
 *
 * Its own authorization (ModerationService.authorizeEvidenceRead): live staff
 * holding moderation.view with the report in their moderation scope now. The
 * message's read path (MessageService.authorizeAttachmentRead) is untouched
 * and is not consulted: the evidence outlives the message's deletion, and a
 * reviewer is no member of the conversation. `@Public()` to the bearer guard
 * because an <img> or a viewer cannot send a header; the link is the binding.
 */
@Public()
@Controller('media')
export class ModerationMediaController {
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly moderation: ModerationService,
  ) {}

  @Get('report-evidence/:id')
  evidence(
    @Param('id') id: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    return serveAuthorizedMedia(
      { signer: this.signer, prisma: this.prisma, storage: this.storage },
      'report-evidence', id, variant, actorId, expires, sig, req, res,
      () => this.moderation.authorizeEvidenceRead(id, actorId),
    );
  }
}
