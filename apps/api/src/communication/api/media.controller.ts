import { Controller, Get, Inject, Logger, Param, Query, Req, Res } from '@nestjs/common';
import { Public } from '../../platform/auth/auth.guard';
import { MediaUrlSigner, type MediaVariant } from '../../platform/media-url';
import { serveAuthorizedMedia, type MediaServeDeps, type RequestLike, type ResponseLike } from './media-serve';
import { PrismaService } from '../../platform/prisma.service';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage } from '../attachments/object-storage';
import { MessageService } from '../messages/message.service';
import { StoryService } from '../stories/story.service';

/**
 * RT-037 -- every attachment byte is served here, authorized at ACCESS time.
 *
 * `@Public()` to the bearer guard because an <img>, a link or a media player
 * cannot send an Authorization header; the URL carries a signature binding it
 * to one attachment, variant and actor (MediaUrlSigner). The signature is not
 * the decision. On every request, before any byte:
 *
 *   1. the signature and expiry verify (403 otherwise);
 *   2. the actor is LIVE now -- principal and login (403 otherwise);
 *   3. the actor may read that message now -- conversation scope, membership,
 *      visibility, deletion (`MessageService.authorizeAttachmentRead`; reads as
 *      404 otherwise).
 *
 * So a deactivation, a removal from the conversation or a deletion stops the
 * very next request -- a guarantee a presigned storage URL cannot give. What
 * this cannot recall: bytes already delivered, and a single response already
 * streaming when the change commits.
 */
@Public()
@Controller('media')
export class MediaController {
  private readonly log = new Logger(MediaController.name);
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly stories: StoryService,
  ) {}

  @Get('attachments/:attachmentId')
  async attachment(
    @Param('attachmentId') attachmentId: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    return serveAuthorizedMedia(this.deps(), 'attachments', attachmentId, variant, actorId, expires, sig, req, res, () =>
      this.messages.authorizeAttachmentRead(attachmentId, actorId, variant as MediaVariant),
    );
  }

  @Get('stories/:storyId')
  async story(
    @Param('storyId') storyId: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    return serveAuthorizedMedia(this.deps(), 'stories', storyId, variant, actorId, expires, sig, req, res, () =>
      this.stories.authorizeMediaRead(storyId, actorId),
    );
  }

  private deps(): MediaServeDeps {
    return { signer: this.signer, prisma: this.prisma, storage: this.storage };
  }
}
