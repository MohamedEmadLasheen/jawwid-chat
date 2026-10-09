import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Redirect,
  UseFilters,
} from '@nestjs/common';
import { ProfileService } from '../profile/profile.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * The signed-in parent's own profile.
 *
 * ## EVERY ROUTE IS FIRST-PERSON
 *
 * Mounted under `me`, and no route takes a parent id -- not in the path, not in the body,
 * not in a header. The actor comes from `@ActorId()`, which reads `request.actor`, which
 * only the auth guard writes and only a verified bearer token produces. There is no
 * `GET /parents/:id/profile` to point somewhere else, because there is no such route.
 *
 * ## THE ONE ID A CLIENT DOES SEND
 *
 * `:learnerId`, on the child-photo routes. It is treated as untrusted input: the service
 * resolves it only inside a query already narrowed to the caller's own family, and a
 * learner in anybody else's family answers 404 exactly as a non-existent one does.
 *
 * ## WHAT IS NOT HERE
 *
 * No route writes a name, a phone, an email, a level, a teacher, a subscription or a
 * permission flag. The only mutable thing a parent owns on this surface is a photo --
 * theirs, and their own children's.
 */
@Controller('me')
@UseFilters(CommErrorFilter)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** The caller's own profile, including the children of their family. */
  @Get('profile')
  async profileOf(@ActorId() actorId: string) {
    return this.profile.me(actorId);
  }

  /**
   * The caller's own name and photo, for any principal that can have one.
   *
   * `GET profile` above answers the richer parent question and is a contact-only route.
   * This one is the small universal read a TEACHER or an ADMIN needs to render their own
   * avatar control -- the Flutter My Account screen and the Admin Web avatar panel.
   *
   * Like every route here it takes no target: the actor comes from the bearer token.
   */
  @Get('avatar')
  async myAvatar(@ActorId() actorId: string) {
    return this.profile.myAvatar(actorId);
  }

  /**
   * The STABLE image endpoint. This is the URL identity carries.
   *
   * Takes no target — not in the path, not in the query — so the only photo it can serve
   * is the caller's own, resolved from the bearer token by `requireAvatarOwner`. A caller
   * cannot name whose face it wants.
   *
   * It answers 302 to a short-lived signed URL rather than proxying the bytes: the object
   * never passes through this process, and nothing here serialises the key or the signature
   * into a body. 404 when the caller has no photo, which the client renders as initials.
   *
   * `no-store` because the destination expires. A shared cache that kept this redirect
   * would hand a later reader a dead URL, or one it was never entitled to.
   */
  @Get('avatar/image')
  @Redirect('', 302)
  @Header('Cache-Control', 'private, no-store')
  async myAvatarImage(@ActorId() actorId: string) {
    return { url: await this.profile.myAvatarImageUrl(actorId), statusCode: 302 };
  }

  /**
   * Authorize a photo upload. The bytes go straight to storage on the returned URL and
   * never pass through this process; the signature is bound to the exact type and size
   * authorized here.
   */
  @Post('avatar/authorize')
  async authorizeAvatar(
    @ActorId() actorId: string,
    @Body() body: { mimeType?: unknown; byteSize?: unknown },
  ) {
    return this.profile.authorizeAvatarUpload(actorId, {
      mimeType: typeof body?.mimeType === 'string' ? body.mimeType : '',
      byteSize: Number(body?.byteSize),
    });
  }

  /**
   * Commit an uploaded photo as the caller's own.
   *
   * An explicit allowlist of one field. The body is never spread into the update: a
   * caller who adds `familyId`, `canMessage` or `name` here changes nothing, because
   * nothing reads them.
   */
  @Post('avatar')
  async setAvatar(@ActorId() actorId: string, @Body() body: { objectKey?: unknown }) {
    return this.profile.setAvatar(actorId, String(body?.objectKey ?? ''));
  }

  @Delete('avatar')
  async removeAvatar(@ActorId() actorId: string) {
    return this.profile.removeAvatar(actorId);
  }

  /** Same allowlist of one field, for a child the caller is authorized to manage. */
  @Post('children/:learnerId/avatar')
  async setChildAvatar(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
    @Body() body: { objectKey?: unknown },
  ) {
    return this.profile.setChildAvatar(actorId, learnerId, String(body?.objectKey ?? ''));
  }

  @Delete('children/:learnerId/avatar')
  async removeChildAvatar(
    @ActorId() actorId: string,
    @Param('learnerId') learnerId: string,
  ) {
    return this.profile.removeChildAvatar(actorId, learnerId);
  }
}
