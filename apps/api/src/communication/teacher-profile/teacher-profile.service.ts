import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import type { Actor } from '../../platform/types';
import { AUDIT_SERVICE, IDENTITY_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import type { ObjectStorage } from '../attachments/object-storage';
import { MediaUrlSigner } from '../../platform/media-url';
import { isUuid } from '../conversations/conversation.service';
import { signAvatar } from '../profile/avatar-urls';

/**
 * The teacher's professional profile. The teacher owns it.
 *
 * ## V2: saved is current
 *
 * V1 was a copy-on-write revision model behind an admin approval workflow: the
 * teacher edited a draft, an admin approved it, and a pointer decided what a
 * parent saw. That machinery existed to answer one question -- "what does a
 * parent see while the teacher is mid-edit?" -- and the product no longer asks
 * it. There is one profile row, Save writes it, and the write IS the publish.
 *
 * What did NOT change is the part that was never about revisions: a credential
 * does not become verified by being uploaded. Certificate review survives
 * intact, because immediate save on profile TEXT is not a reason to treat an
 * uploaded Ijazah as checked.
 *
 * ## What no method accepts
 *
 * A TEACHER ID. Every teacher-facing method takes the authenticated actor and
 * resolves the profile from it. There is no parameter through which a caller
 * could name somebody else's profile or identity, so "may this teacher edit
 * that teacher?" is not a check that can be forgotten -- it is unrepresentable.
 *
 * AN OBJECT KEY AS A FIELD, inbound or outbound. Keys are minted here from an
 * upload authorization and no response carries one as data -- not to the owning
 * teacher, not to a reviewer, not to a family. A certificate is read only
 * through {@link certificateDownloadUrl}.
 *
 * ## Reads go through the RT-037 media route
 *
 * A certificate link points at THIS API (`GET /media/teacher-certificates/:id`),
 * is bound to the reader and expires -- and every request re-decides, at that
 * moment, that the reader is live and may still see the file
 * ({@link authorizeCertificateRead}). No storage URL leaves the server, so a
 * deactivation or a deleted certificate stops the very next request.
 *
 * ## The photo is the teacher's ONE photo, and it is not set here
 *
 * It is `chat.teacher.avatar_object_key`, the column every chat surface shows,
 * and it has exactly one writer: the account photo routes every person shares
 * (`/me/avatar`, communication/profile/avatar.service.ts). This profile only
 * shows it, with the same `self` link that `GET /me/photo` hands out.
 *
 * ## Where the name lives
 *
 * On `chat.teacher`, and nowhere else. {@link updateName} writes that row and
 * this file holds no copy of it: `IdentityService` has no cache and resolves
 * actors from the database per request, so one UPDATE is visible to every
 * surface that renders a teacher's name -- `GET /me`, message authors,
 * conversation participants -- without anything here publishing an event.
 */
@Injectable()
export class TeacherProfileService {
  /** Matches the database check constraint, which is the real limit. */
  private static readonly ALLOWED_CERTIFICATE_MIME = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]);
  private static readonly MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;

  private static readonly MAX_NAME_LENGTH = 120;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Optional() private readonly mediaUrls: MediaUrlSigner = new MediaUrlSigner(),
  ) {}

  // ---------------------------------------------------------------------------
  // Teacher: the profile
  // ---------------------------------------------------------------------------

  /**
   * The signed-in teacher's own profile.
   *
   * Creates nothing: a teacher who has never saved gets an empty profile view
   * rather than a row, so opening the screen is not a write.
   */
  async myProfile(actorId: string): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);
    const profile = await this.prisma.teacherProfessionalProfile.findUnique({
      where: { teacherId: actor.actorId },
      include: { certificates: { orderBy: { createdAt: 'asc' } } },
    });
    return this.toProfileView(actor, profile);
  }

  /**
   * Save the profile content. This is the whole publish step.
   *
   * Upsert rather than "create if missing, then update": a teacher's first save
   * and their hundredth are the same action, and splitting them is how a first
   * save races itself into a unique-violation on `teacher_id`.
   */
  async saveProfile(actorId: string, input: ProfileContentInput): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);
    const content = this.validateContent(input);

    const profile = await this.prisma.$transaction(async (tx) => {
      const before = await tx.teacherProfessionalProfile.findUnique({
        where: { teacherId: actor.actorId },
      });

      const saved = await tx.teacherProfessionalProfile.upsert({
        where: { teacherId: actor.actorId },
        create: { teacherId: actor.actorId, ...content },
        update: content,
        include: { certificates: { orderBy: { createdAt: 'asc' } } },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.saved',
        entity: 'teacher_professional_profile',
        entityId: saved.id,
        before: before ? this.auditContent(before) : null,
        after: this.auditContent(saved),
        reason: 'the teacher saved their own professional profile',
      });

      return saved;
    });

    return this.toProfileView(actor, profile);
  }

  // ---------------------------------------------------------------------------
  // Teacher: the name, which is identity and not profile content
  // ---------------------------------------------------------------------------

  /**
   * Rename the signed-in teacher.
   *
   * Writes `chat.teacher.name` -- the authoritative, Chat-owned teacher
   * identity -- and deliberately does NOT write a copy into any profile table.
   * A profile that carried its own name is a profile that could disagree with
   * the identity every other screen renders.
   *
   * Scoped by `teacherId: actor.actorId`, so the statement cannot name another
   * teacher's row even if a caller wanted it to. Jawwid Core is not involved:
   * Core has no teacher entity, and `core_teacher_id` stays whatever it was.
   */
  async updateName(actorId: string, rawName: string): Promise<TeacherIdentityView> {
    const actor = await this.requireTeacher(actorId);
    const name = this.validateName(rawName);

    const teacher = await this.prisma.$transaction(async (tx) => {
      const before = await tx.teacher.findUnique({ where: { id: actor.actorId } });
      if (!before) {
        throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
      }

      const updated = await tx.teacher.update({
        where: { id: actor.actorId },
        data: { name },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher.renamed',
        entity: 'teacher',
        entityId: updated.id,
        before: { name: before.name },
        after: { name: updated.name },
        reason: 'the teacher changed their own name',
      });

      return updated;
    });

    return { name: teacher.name, role: 'teacher' };
  }

  // ---------------------------------------------------------------------------
  // Teacher: certificates
  // ---------------------------------------------------------------------------

  async authorizeCertificateUpload(
    actorId: string,
    input: { mimeType: string; byteSize: number },
  ): Promise<{ uploadUrl: string; uploadToken: string; expiresAt: string; headers: Record<string, string> }> {
    const actor = await this.requireTeacher(actorId);
    this.validateCertificate(input);

    const authorization = await this.storage.authorizeUpload({
      prefix: `teacher-certificates/${actor.actorId}`,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
    });

    return {
      uploadUrl: authorization.uploadUrl,
      uploadToken: authorization.objectKey,
      expiresAt: authorization.expiresAt,
      // The exact headers storage signed; an S3 PUT that differs is refused.
      headers: authorization.headers,
    };
  }

  async addCertificate(
    actorId: string,
    input: {
      title: string;
      issuingOrganization?: string | null;
      issuedOn?: string | null;
      mimeType: string;
      byteSize: number;
      uploadToken: string;
    },
  ): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);
    this.validateCertificate(input);
    this.requireOwnedObjectKey(actor, input.uploadToken, 'teacher-certificates');
    const title = this.requireTitle(input.title);

    const profile = await this.prisma.$transaction(async (tx) => {
      const owner = await this.ensureProfile(tx, actor);

      const certificate = await tx.teacherProfileCertificate.create({
        data: {
          profileId: owner.id,
          title,
          issuingOrganization: input.issuingOrganization?.trim() || null,
          issuedOn: this.optionalDate(input.issuedOn),
          objectKey: input.uploadToken,
          mimeType: input.mimeType,
          byteSize: BigInt(input.byteSize),
        },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.certificate_added',
        entity: 'teacher_profile_certificate',
        entityId: certificate.id,
        before: null,
        after: { title: certificate.title, state: certificate.state },
        reason: 'the teacher added a credential to their own profile',
      });

      return tx.teacherProfessionalProfile.findUniqueOrThrow({
        where: { id: owner.id },
        include: { certificates: { orderBy: { createdAt: 'asc' } } },
      });
    });

    return this.toProfileView(actor, profile);
  }

  /**
   * Metadata only.
   *
   * There is no field here for the file, so a rename cannot become a
   * substitution -- and the database trigger returns the claim to `pending`,
   * because the approval was of a claim and not of a file.
   */
  async updateCertificate(
    actorId: string,
    certificateId: string,
    input: { title: string; issuingOrganization?: string | null; issuedOn?: string | null },
  ): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);
    const title = this.requireTitle(input.title);

    const profile = await this.prisma.$transaction(async (tx) => {
      const certificate = await this.requireOwnCertificate(tx, actor, certificateId);

      const updated = await tx.teacherProfileCertificate.update({
        where: { id: certificate.id },
        data: {
          title,
          issuingOrganization: input.issuingOrganization?.trim() || null,
          issuedOn: this.optionalDate(input.issuedOn),
        },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.certificate_edited',
        entity: 'teacher_profile_certificate',
        entityId: updated.id,
        before: { title: certificate.title, state: certificate.state },
        after: { title: updated.title, state: updated.state },
        reason: 'the teacher edited a credential on their own profile',
      });

      return tx.teacherProfessionalProfile.findUniqueOrThrow({
        where: { id: certificate.profileId },
        include: { certificates: { orderBy: { createdAt: 'asc' } } },
      });
    });

    return this.toProfileView(actor, profile);
  }

  async removeCertificate(actorId: string, certificateId: string): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);

    const { profile, removed } = await this.prisma.$transaction(async (tx) => {
      const certificate = await this.requireOwnCertificate(tx, actor, certificateId);

      await tx.teacherProfileCertificate.delete({ where: { id: certificate.id } });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.certificate_removed',
        entity: 'teacher_profile_certificate',
        entityId: certificate.id,
        before: { title: certificate.title, state: certificate.state },
        after: null,
        reason: 'the teacher removed a credential from their own profile',
      });

      const owner = await tx.teacherProfessionalProfile.findUniqueOrThrow({
        where: { id: certificate.profileId },
        include: { certificates: { orderBy: { createdAt: 'asc' } } },
      });
      return { profile: owner, removed: certificate.objectKey };
    });

    await this.discardObject(removed);
    return this.toProfileView(actor, profile);
  }

  // ---------------------------------------------------------------------------
  // Reviewer: certificates only
  // ---------------------------------------------------------------------------

  /**
   * Teachers with at least one credential awaiting a decision.
   *
   * Certificate-level, because certificate review is all that is left: there is
   * no profile to approve. Authorization is re-checked here and again on the
   * decision, because a queue read and a decision are separate requests and a
   * role can be revoked between them.
   */
  async certificateReviewQueue(actorId: string): Promise<CertificateReviewItem[]> {
    const actor = await this.requireReviewer(actorId);

    const profiles = await this.prisma.teacherProfessionalProfile.findMany({
      where: {
        ...this.orgScope(actor),
        certificates: { some: { state: 'pending' } },
      },
      include: {
        teacher: true,
        certificates: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { updatedAt: 'asc' },
    });

    return profiles.map((profile) => ({
      profileId: profile.id,
      teacherName: profile.teacher.name,
      pendingCertificates: profile.certificates.filter((c) => c.state === 'pending').length,
      certificates: profile.certificates.map((c) => this.toCertificateView(c)),
    }));
  }

  async decideCertificate(
    actorId: string,
    certificateId: string,
    decision: { approved: boolean; note?: string | null },
  ): Promise<CertificateReviewItem> {
    const actor = await this.requireReviewer(actorId);

    if (!decision.approved && !(decision.note ?? '').trim()) {
      throw new CommError(
        CommErrorCode.TEACHER_PROFILE_REVIEW_NOTE_REQUIRED,
        'rejecting a certificate requires a reason',
        400,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Re-checked INSIDE the transaction and after the lock: the decision is
      // made against the row as it is now, not as the queue showed it.
      await this.lockCertificate(tx, certificateId);

      const certificate = await tx.teacherProfileCertificate.findUnique({
        where: { id: certificateId },
        include: { profile: { include: { teacher: true } } },
      });
      if (!certificate || !this.inOrg(actor, certificate.profile.organizationId)) {
        throw new CommError(
          CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
          'no such certificate',
          404,
        );
      }
      this.refuseSelfReview(actor, certificate.profile.teacherId);

      const reviewer = actor.kind === 'staff' ? actor.actorId : null;
      const updated = await tx.teacherProfileCertificate.update({
        where: { id: certificate.id },
        data: {
          state: decision.approved ? 'approved' : 'rejected',
          reviewedAt: new Date(),
          reviewedById: reviewer,
          reviewNote: decision.note?.trim() || null,
        },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: decision.approved
          ? 'teacher_profile.certificate_approved'
          : 'teacher_profile.certificate_rejected',
        entity: 'teacher_profile_certificate',
        entityId: updated.id,
        before: { state: certificate.state },
        after: { state: updated.state },
        // NOT NULL by design. A rejection carries the reviewer's own words;
        // an approval has none to carry, so it says what it is.
        reason: updated.reviewNote ?? 'a reviewer approved this credential',
      });

      const profile = await tx.teacherProfessionalProfile.findUniqueOrThrow({
        where: { id: certificate.profileId },
        include: { teacher: true, certificates: { orderBy: { createdAt: 'asc' } } },
      });

      return {
        profileId: profile.id,
        teacherName: profile.teacher.name,
        pendingCertificates: profile.certificates.filter((c) => c.state === 'pending').length,
        certificates: profile.certificates.map((c) => this.toCertificateView(c)),
      };
    });
  }

  /**
   * A fresh link for one certificate file.
   *
   * Two callers, one rule: the owning teacher, or a reviewer in the same
   * organization ({@link authorizeCertificateRead}, re-decided again on every
   * request to the link). The key is never returned, so a client cannot
   * construct a link of its own; the link is the RT-037 media route, bound to
   * this reader.
   */
  async certificateDownloadUrl(actorId: string, certificateId: string): Promise<string> {
    await this.authorizeCertificateRead(certificateId, actorId);
    return this.mediaUrls.url(
      'teacher-certificates',
      certificateId,
      'o',
      actorId,
      linkTtlSeconds(),
    );
  }

  /**
   * RT-037 -- the access-time decision behind a certificate link, made on every
   * request: the reader is the owning teacher, or may review teacher profiles
   * in the certificate's organization. Anything else reads as 404 -- "not
   * yours" and "does not exist" must not be told apart.
   */
  async authorizeCertificateRead(
    certificateId: string,
    readerId: string,
  ): Promise<{ objectKey: string }> {
    const notFound = () =>
      new CommError(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND, 'no such certificate', 404);
    if (!isUuid(certificateId) || !isUuid(readerId)) throw notFound();
    const actor = await this.identity.resolveActor(readerId);
    if (!actor || !actor.isActive) throw notFound();

    const certificate = await this.prisma.teacherProfileCertificate.findUnique({
      where: { id: certificateId },
      include: { profile: true },
    });
    if (!certificate || !this.inOrg(actor, certificate.profile.organizationId)) throw notFound();

    const isOwner = actor.kind === 'teacher' && actor.actorId === certificate.profile.teacherId;
    if (!isOwner && !this.authz.canReviewTeacherProfile(actor).allowed) throw notFound();
    return { objectKey: certificate.objectKey };
  }

  // ---------------------------------------------------------------------------
  // The public read
  // ---------------------------------------------------------------------------

  /**
   * One teacher's profile as a third party sees it.
   *
   * The CURRENT saved profile -- there is no other version any more. Approved
   * certificates only: a pending credential is unverified and a rejected one was
   * refused, and publishing either would make the decision meaningless. Carries
   * no id, no object key, no review metadata and no reviewer.
   *
   * No route exposes this yet; the Parent surface is a separate piece of work.
   */
  async publicProfile(teacherId: string): Promise<PublicProfileView | null> {
    const profile = await this.prisma.teacherProfessionalProfile.findUnique({
      where: { teacherId },
      include: {
        teacher: true,
        certificates: { where: { state: 'approved' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!profile) return null;

    return {
      teacherName: profile.teacher.name,
      // No link: a link is bound to its reader, and this read has none yet.
      // The Parent surface that exposes this will mint one for its caller.
      hasPhoto: profile.teacher.avatarObjectKey != null,
      bio: profile.bio,
      specialization: profile.specialization,
      qualifications: profile.qualifications,
      experience: profile.experience,
      languages: profile.languages,
      certificates: profile.certificates.map((c) => ({
        title: c.title,
        issuingOrganization: c.issuingOrganization,
        issuedOn: c.issuedOn,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async requireActor(actorId: string): Promise<Actor> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    return actor;
  }

  private async requireTeacher(actorId: string): Promise<Actor> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canOwnTeacherProfile(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    return actor;
  }

  private async requireReviewer(actorId: string): Promise<Actor> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canReviewTeacherProfile(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    return actor;
  }

  /**
   * A teacher may never decide their own credential.
   *
   * Role alone cannot express this -- a teacher who is also staff would pass
   * every role check -- so it is compared against the resolved owner. The
   * database enforces the same rule independently, because a service check is
   * one new call site away from being skipped.
   */
  private refuseSelfReview(actor: Actor, ownerTeacherId: string): void {
    if (actor.kind === 'teacher' && actor.actorId === ownerTeacherId) {
      throw new CommError(
        CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
        'a teacher cannot review their own certificate',
      );
    }
  }

  /**
   * Fail closed: an actor with no organization sees nothing. The original
   * returned "no filter" for such an actor, which is the wrong shape for a
   * tenant boundary -- IdentityService always resolves one, so this refuses a
   * state that does not occur rather than one anybody reaches.
   */
  private orgScope(actor: Actor): { organizationId: string } {
    if (!actor.organizationId) {
      throw new CommError(
        CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
        'an actor with no organization cannot review',
        403,
      );
    }
    return { organizationId: actor.organizationId };
  }

  private inOrg(actor: Actor, organizationId: string): boolean {
    return actor.organizationId != null && actor.organizationId === organizationId;
  }

  /**
   * The key must sit under the prefix this teacher's own upload authorization
   * minted. Without this a teacher could hand back a key belonging to another
   * teacher's upload and attach their file as their own.
   *
   * The `..` test is not decoration: the key becomes a path on the reference
   * storage's filesystem.
   */
  private requireOwnedObjectKey(actor: Actor, objectKey: string, prefix: string): void {
    const expected = `${prefix}/${actor.actorId}/`;
    if (!objectKey || !objectKey.startsWith(expected) || objectKey.includes('..')) {
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
        'that upload does not belong to this teacher',
        400,
      );
    }
  }

  private validateCertificate(input: { mimeType: string; byteSize: number }): void {
    if (!TeacherProfileService.ALLOWED_CERTIFICATE_MIME.has(input.mimeType)) {
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_INVALID_TYPE,
        'a certificate must be a PDF, JPEG or PNG',
        400,
      );
    }
    if (
      !Number.isFinite(input.byteSize) ||
      input.byteSize <= 0 ||
      input.byteSize > TeacherProfileService.MAX_CERTIFICATE_BYTES
    ) {
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_TOO_LARGE,
        'a certificate must be 10MB or smaller',
        400,
      );
    }
  }

  /**
   * A name is required, bounded, and renders as one tidy line.
   *
   * Whitespace runs -- newlines, tabs, control and format characters, and plain
   * double spaces -- collapse to a single space rather than being rejected: they
   * arrive from paste, not from intent, and "الأستاذ   محمد" looks broken in
   * every list it appears in. Unicode is otherwise untouched: these names are
   * Arabic, and normalising them further would be a product decision nobody
   * asked for.
   *
   * Collapsing is also what lets the CLIENT be honest. The contract is that the
   * client renders what the server stored, and a server that only trimmed would
   * make "trim" and "collapse" indistinguishable to anyone reading the response.
   */
  private validateName(raw: string): string {
    const name =
      typeof raw === 'string' ? raw.replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim() : '';
    if (name.length === 0) {
      throw new CommError(CommErrorCode.TEACHER_NAME_INVALID, 'a name is required', 400);
    }
    if (name.length > TeacherProfileService.MAX_NAME_LENGTH) {
      throw new CommError(
        CommErrorCode.TEACHER_NAME_INVALID,
        `a name must be ${TeacherProfileService.MAX_NAME_LENGTH} characters or fewer`,
        400,
      );
    }
    return name;
  }

  private requireTitle(raw: string): string {
    const title = (raw ?? '').trim();
    if (title.length === 0 || title.length > 200) {
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_INVALID_TYPE,
        'a certificate needs a title of at most 200 characters',
        400,
      );
    }
    return title;
  }

  private validateContent(input: ProfileContentInput): {
    bio: string | null;
    specialization: string | null;
    qualifications: string | null;
    experience: string | null;
    languages: string[];
  } {
    // The ceilings match the database CHECK constraints, which are the real
    // limit; these exist so a client is refused before a round trip, not
    // instead of one.
    const text = (value: string | null | undefined, max: number, field: string) => {
      const trimmed = (value ?? '').trim();
      if (trimmed.length === 0) return null;
      if (trimmed.length > max) {
        throw new CommError(
          CommErrorCode.TEACHER_PROFILE_INVALID_CONTENT,
          `${field} must be ${max} characters or fewer`,
          400,
        );
      }
      return trimmed;
    };

    const languages = (input.languages ?? [])
      .map((l) => (typeof l === 'string' ? l.trim() : ''))
      .filter((l) => l.length > 0 && l.length <= 40);
    if (languages.length > 10) {
      throw new CommError(
        CommErrorCode.TEACHER_PROFILE_INVALID_CONTENT,
        'at most 10 languages',
        400,
      );
    }

    return {
      bio: text(input.bio, 2000, 'bio'),
      specialization: text(input.specialization, 200, 'specialization'),
      qualifications: text(input.qualifications, 2000, 'qualifications'),
      experience: text(input.experience, 2000, 'experience'),
      languages: [...new Set(languages)],
    };
  }

  private optionalDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new CommError(CommErrorCode.TEACHER_PROFILE_INVALID_CONTENT, 'issuedOn is not a date', 400);
    }
    return date;
  }

  /**
   * Hold the row before deciding anything about it.
   *
   * Prisma runs READ COMMITTED, so without the lock two reviewers can both read
   * `pending`, both write, and both be told they decided it. The data stays
   * consistent; the story told about it does not.
   */
  private async lockCertificate(tx: PrismaTx, certificateId: string): Promise<void> {
    await tx.$queryRaw`
      select id from chat.teacher_profile_certificate where id = ${certificateId}::uuid for update
    `;
  }

  private async requireOwnCertificate(tx: PrismaTx, actor: Actor, certificateId: string) {
    const certificate = await tx.teacherProfileCertificate.findUnique({
      where: { id: certificateId },
      include: { profile: true },
    });
    // One error for "does not exist" and "is not yours": telling them apart
    // would turn this endpoint into an oracle for other teachers' certificate
    // ids.
    if (
      !certificate ||
      certificate.profile.teacherId !== actor.actorId ||
      !this.inOrg(actor, certificate.profile.organizationId)
    ) {
      throw new CommError(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND, 'no such certificate', 404);
    }
    return certificate;
  }

  private async ensureProfile(tx: PrismaTx, actor: Actor) {
    return tx.teacherProfessionalProfile.upsert({
      where: { teacherId: actor.actorId },
      create: { teacherId: actor.actorId },
      update: {},
    });
  }

  /**
   * Drop bytes nothing references any more.
   *
   * Best effort by design: the row is already committed, so a storage hiccup
   * must not fail the request the teacher made. A key that survives is an
   * orphan, which costs disk; a request that fails because cleanup failed costs
   * the teacher their edit.
   */
  private async discardObject(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch {
      // An orphan costs disk; failing the request because cleanup failed costs the edit.
    }
  }

  private auditContent(row: {
    bio: string | null;
    specialization: string | null;
    qualifications: string | null;
    experience: string | null;
    languages: string[];
  }): Record<string, unknown> {
    return {
      bio: row.bio,
      specialization: row.specialization,
      qualifications: row.qualifications,
      experience: row.experience,
      languages: row.languages,
    };
  }

  private toCertificateView(certificate: {
    id: string;
    title: string;
    issuingOrganization: string | null;
    issuedOn: Date | null;
    state: string;
    reviewNote: string | null;
  }): CertificateView {
    return {
      id: certificate.id,
      title: certificate.title,
      issuingOrganization: certificate.issuingOrganization,
      issuedOn: certificate.issuedOn,
      state: certificate.state,
      reviewNote: certificate.reviewNote,
    };
  }

  /**
   * The teacher's own view.
   *
   * `name` and `role` come from the resolved ACTOR, not from any profile
   * column, which is what makes a stale name impossible: there is nothing here
   * that could hold an old one.
   */
  private async toProfileView(
    actor: Actor,
    profile:
      | (ProfileRow & { certificates: CertificateRow[] })
      | null,
  ): Promise<TeacherProfileView> {
    // The photo is the teacher's own row, read now: the actor resolved at the
    // start of the request does not carry the key. Same link as GET /me/photo.
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: actor.actorId },
      select: { avatarObjectKey: true },
    });
    return {
      name: actor.displayName,
      role: 'teacher',
      photoUrl: signAvatar('teacher', actor.actorId, 'self', actor.actorId, teacher?.avatarObjectKey),
      bio: profile?.bio ?? null,
      specialization: profile?.specialization ?? null,
      qualifications: profile?.qualifications ?? null,
      experience: profile?.experience ?? null,
      languages: profile?.languages ?? [],
      certificates: (profile?.certificates ?? []).map((c) => this.toCertificateView(c)),
      updatedAt: profile?.updatedAt ?? null,
    };
  }
}

/** One notion of how long a media link lives, as attachments and staff photos read it. */
function linkTtlSeconds(): number {
  const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 300;
}

type PrismaTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

interface ProfileRow {
  bio: string | null;
  specialization: string | null;
  qualifications: string | null;
  experience: string | null;
  languages: string[];
  updatedAt: Date;
}

interface CertificateRow {
  id: string;
  title: string;
  issuingOrganization: string | null;
  issuedOn: Date | null;
  state: string;
  reviewNote: string | null;
}

export interface ProfileContentInput {
  bio?: string | null;
  specialization?: string | null;
  qualifications?: string | null;
  experience?: string | null;
  languages?: string[];
}

export interface CertificateView {
  id: string;
  title: string;
  issuingOrganization: string | null;
  issuedOn: Date | null;
  /** pending | approved | rejected -- the reviewer's decision. */
  state: string;
  reviewNote: string | null;
}

/** What the owning teacher sees. No ids, no keys, no reviewer. */
export interface TeacherProfileView {
  name: string;
  role: 'teacher';
  photoUrl: string | null;
  bio: string | null;
  specialization: string | null;
  qualifications: string | null;
  experience: string | null;
  languages: string[];
  certificates: CertificateView[];
  updatedAt: Date | null;
}

export interface TeacherIdentityView {
  name: string;
  role: 'teacher';
}

/** One row of the certificate review queue. No revision, because there is none. */
export interface CertificateReviewItem {
  profileId: string;
  teacherName: string;
  pendingCertificates: number;
  certificates: CertificateView[];
}

export interface PublicProfileView {
  teacherName: string;
  hasPhoto: boolean;
  bio: string | null;
  specialization: string | null;
  qualifications: string | null;
  experience: string | null;
  languages: string[];
  certificates: { title: string; issuingOrganization: string | null; issuedOn: Date | null }[];
}
