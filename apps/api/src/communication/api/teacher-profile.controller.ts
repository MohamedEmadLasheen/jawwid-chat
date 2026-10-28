import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseFilters,
} from '@nestjs/common';
import { TeacherProfileService } from '../teacher-profile/teacher-profile.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { NotForStaff, Requires } from '../../platform/permissions/route-access';

/**
 * The teacher's professional profile, and certificate review.
 *
 * ## What no route accepts
 *
 * A TEACHER ID. Every teacher route takes the authenticated actor from
 * `@ActorId()` -- written only by AuthenticatedGuard from a verified bearer
 * token -- and resolves the profile from it. `/me/teacher-profile` cannot be
 * asked for somebody else's profile or name, because there is no field in which
 * to name one.
 *
 * AN OBJECT KEY. Uploads return an opaque `uploadToken` which is handed straight
 * back; no response on any route carries a storage key. A certificate file is
 * read only through `GET …/certificates/:id/download`, a fresh authorization.
 *
 * THE PHOTO. It is the teacher's one account photo, set through `/me/avatar`
 * like everyone else's; the profile carries its `self` link as `photoUrl`.
 *
 * ## What V2 removed
 *
 * SUBMIT, APPROVE and REQUEST-CHANGES, for the profile. The teacher owns their
 * profile: `POST /me/teacher-profile` saves it and the save IS the publish.
 * There is no state for a client to send and none for a reviewer to set.
 *
 * What survives is CERTIFICATE review, which was never about revisions: a
 * credential does not become verified by being uploaded, so a reviewer still
 * decides each one and a teacher still cannot decide their own.
 *
 * ## What is deliberately absent
 *
 * A PARENT ROUTE. `publicProfile` exists on the service and is tested, but no
 * family-facing endpoint is exposed here -- there is no parent-facing teacher
 * surface in the product yet, and shipping an endpoint before the screen that
 * justifies it invites exactly one caller to guess at the shape.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TeacherProfileController {
  constructor(private readonly profiles: TeacherProfileService) {}

  // --- the teacher's own profile ---------------------------------------------

  /** The signed-in teacher's current profile. Creates nothing. */
  @NotForStaff()
  @Get('me/teacher-profile')
  async mine(@ActorId() actorId: string) {
    return this.profiles.myProfile(actorId);
  }

  /** Save the profile. Immediately current; nothing waits for a reviewer. */
  @NotForStaff()
  @Post('me/teacher-profile')
  async save(
    @ActorId() actorId: string,
    @Body()
    body: {
      bio?: string | null;
      specialization?: string | null;
      qualifications?: string | null;
      experience?: string | null;
      languages?: string[];
    },
  ) {
    return this.profiles.saveProfile(actorId, {
      bio: body?.bio ?? null,
      specialization: body?.specialization ?? null,
      qualifications: body?.qualifications ?? null,
      experience: body?.experience ?? null,
      languages: Array.isArray(body?.languages) ? body.languages : [],
    });
  }

  // --- identity --------------------------------------------------------------

  /**
   * Rename the signed-in teacher.
   *
   * Separate from the profile save on purpose: the name is IDENTITY, lives on
   * `chat.teacher`, and is read by surfaces that have nothing to do with this
   * feature. Folding it into the profile body would imply the profile owns it.
   */
  @NotForStaff()
  @Patch('me/teacher-profile/name')
  async rename(@ActorId() actorId: string, @Body() body: { name?: string }) {
    return this.profiles.updateName(actorId, body?.name ?? '');
  }

  // --- certificates ----------------------------------------------------------

  @NotForStaff()
  @Post('me/teacher-profile/certificates/upload')
  async authorizeCertificate(
    @ActorId() actorId: string,
    @Body() body: { mimeType?: string; byteSize?: number },
  ) {
    return this.profiles.authorizeCertificateUpload(actorId, {
      mimeType: body?.mimeType ?? '',
      byteSize: Number(body?.byteSize),
    });
  }

  @NotForStaff()
  @Post('me/teacher-profile/certificates')
  async addCertificate(
    @ActorId() actorId: string,
    @Body()
    body: {
      title?: string;
      issuingOrganization?: string | null;
      issuedOn?: string | null;
      mimeType?: string;
      byteSize?: number;
      uploadToken?: string;
    },
  ) {
    return this.profiles.addCertificate(actorId, {
      title: body?.title ?? '',
      issuingOrganization: body?.issuingOrganization ?? null,
      issuedOn: body?.issuedOn ?? null,
      mimeType: body?.mimeType ?? '',
      byteSize: Number(body?.byteSize),
      uploadToken: body?.uploadToken ?? '',
    });
  }

  /** Metadata only. There is no field here for the file. */
  @NotForStaff()
  @Patch('me/teacher-profile/certificates/:id')
  async updateCertificate(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body()
    body: { title?: string; issuingOrganization?: string | null; issuedOn?: string | null },
  ) {
    return this.profiles.updateCertificate(actorId, id, {
      title: body?.title ?? '',
      issuingOrganization: body?.issuingOrganization ?? null,
      issuedOn: body?.issuedOn ?? null,
    });
  }

  @NotForStaff()
  @Delete('me/teacher-profile/certificates/:id')
  async removeCertificate(@ActorId() actorId: string, @Param('id') id: string) {
    return this.profiles.removeCertificate(actorId, id);
  }

  // --- certificate review (staff) -------------------------------------------

  /** Teachers with at least one credential awaiting a decision. */
  @Requires('teacher_profiles.review')
  @Get('teacher-profiles/review')
  async reviewQueue(@ActorId() actorId: string) {
    return { profiles: await this.profiles.certificateReviewQueue(actorId) };
  }

  @Requires('teacher_profiles.review')
  @Post('teacher-profiles/certificates/:id/decide')
  async decideCertificate(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { approved?: boolean; note?: string | null },
  ) {
    return this.profiles.decideCertificate(actorId, id, {
      approved: body?.approved === true,
      note: body?.note ?? null,
    });
  }

  /** A fresh RT-037 media link, bound to the caller. The owning teacher, or a reviewer. */
  @Requires('teacher_profiles.review')
  @Get('teacher-profiles/certificates/:id/download')
  async certificateUrl(@ActorId() actorId: string, @Param('id') id: string) {
    return { url: await this.profiles.certificateDownloadUrl(actorId, id) };
  }
}
