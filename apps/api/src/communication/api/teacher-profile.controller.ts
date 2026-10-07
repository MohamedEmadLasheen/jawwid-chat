import { Body, Controller, Delete, Get, Param, Post, UseFilters } from '@nestjs/common';
import {
  TeacherProfileService,
  type AddCertificateInput,
} from '../teacher-profile/teacher-profile.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * The teacher's professional profile, and its review.
 *
 * ## What no route accepts
 *
 * A TEACHER ID. Every teacher route takes the authenticated actor from
 * `@ActorId()` -- written only by AuthenticatedGuard from a verified bearer
 * token -- and resolves the profile from it. `/me/teacher-profile` cannot be
 * asked for somebody else's profile, because there is no field in which to name
 * one.
 *
 * A STATE. A teacher submits; a reviewer approves or requests changes. None of
 * them sends the resulting state, so a client cannot drive the profile into
 * `approved` by asking nicely. The service sets it and the database refuses the
 * illegal transitions independently.
 *
 * AN OBJECT KEY. Uploads return an opaque `uploadToken` which is handed straight
 * back; no response on any route carries a storage key. A certificate file is
 * read only through `GET …/certificates/:id/download`, which re-authorizes.
 *
 * ## What is deliberately absent
 *
 * A PARENT ROUTE. The published read model exists on the service and is tested,
 * but no family-facing endpoint is exposed in this feature -- there is no
 * parent-facing teacher surface in the product yet, and shipping an endpoint
 * before the screen that justifies it invites exactly one caller to guess at the
 * shape. It is a deliberate scope boundary, not an oversight.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TeacherProfileController {
  constructor(private readonly profiles: TeacherProfileService) {}

  // --- the teacher's own -----------------------------------------------------

  /** The signed-in teacher's published and open revisions. Creates nothing. */
  @Get('me/teacher-profile')
  async mine(@ActorId() actorId: string) {
    return this.profiles.myProfile(actorId);
  }

  /** Write content to the open revision, opening one by copy-on-write if needed. */
  @Post('me/teacher-profile')
  async save(
    @ActorId() actorId: string,
    @Body()
    body: {
      bio?: string;
      specialization?: string;
      qualifications?: string;
      experience?: string;
      languages?: string[];
    },
  ) {
    return this.profiles.saveDraft(actorId, {
      bio: body?.bio,
      specialization: body?.specialization,
      qualifications: body?.qualifications,
      experience: body?.experience,
      languages: Array.isArray(body?.languages) ? body.languages : undefined,
    });
  }

  @Post('me/teacher-profile/submit')
  async submit(@ActorId() actorId: string) {
    return this.profiles.submit(actorId);
  }

  /**
   * Authorize a credential upload. Returns a URL and an opaque token, never a
   * storage key: the prefix is derived from the authenticated teacher, so the
   * client cannot choose where the bytes land.
   */
  @Post('me/teacher-profile/certificates/upload')
  async authorizeUpload(
    @ActorId() actorId: string,
    @Body() body: { mimeType?: string; byteSize?: number },
  ) {
    return this.profiles.authorizeCertificateUpload(actorId, {
      mimeType: String(body?.mimeType ?? ''),
      byteSize: Number(body?.byteSize),
    });
  }

  @Post('me/teacher-profile/certificates')
  async addCertificate(
    @ActorId() actorId: string,
    @Body()
    body: {
      title?: string;
      issuingOrganization?: string;
      issuedOn?: string;
      mimeType?: string;
      byteSize?: number;
      uploadToken?: string;
    },
  ) {
    const input: AddCertificateInput = {
      title: String(body?.title ?? ''),
      issuingOrganization: body?.issuingOrganization,
      issuedOn: body?.issuedOn ? new Date(body.issuedOn) : null,
      mimeType: String(body?.mimeType ?? ''),
      byteSize: Number(body?.byteSize),
      uploadToken: String(body?.uploadToken ?? ''),
    };
    return this.profiles.addCertificate(actorId, input);
  }

  @Delete('me/teacher-profile/certificates/:id')
  async removeCertificate(@ActorId() actorId: string, @Param('id') id: string) {
    return this.profiles.removeCertificate(actorId, id);
  }

  // --- review ----------------------------------------------------------------

  @Get('teacher-profiles/review')
  async queue(@ActorId() actorId: string) {
    return { revisions: await this.profiles.reviewQueue(actorId) };
  }

  @Get('teacher-profiles/review/:revisionId')
  async forReview(@ActorId() actorId: string, @Param('revisionId') revisionId: string) {
    return this.profiles.revisionForReview(actorId, revisionId);
  }

  @Post('teacher-profiles/review/:revisionId/approve')
  async approve(@ActorId() actorId: string, @Param('revisionId') revisionId: string) {
    return this.profiles.approve(actorId, revisionId);
  }

  @Post('teacher-profiles/review/:revisionId/request-changes')
  async requestChanges(
    @ActorId() actorId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: { note?: string },
  ) {
    return this.profiles.requestChanges(actorId, revisionId, String(body?.note ?? ''));
  }

  @Post('teacher-profiles/certificates/:id/decide')
  async decideCertificate(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { approved?: boolean; note?: string },
  ) {
    return this.profiles.decideCertificate(actorId, id, {
      approved: body?.approved === true,
      note: body?.note,
    });
  }

  // --- files -----------------------------------------------------------------

  /**
   * A short-lived signed URL for one certificate.
   *
   * Shared by the owning teacher and a reviewer; the service decides which of
   * those the caller is. An unauthorized caller gets the same 404 a missing
   * certificate gets, because whether a particular credential exists is not a
   * fact they are entitled to learn.
   */
  @Get('teacher-profiles/certificates/:id/download')
  async download(@ActorId() actorId: string, @Param('id') id: string) {
    return { url: await this.profiles.certificateDownloadUrl(actorId, id) };
  }
}
