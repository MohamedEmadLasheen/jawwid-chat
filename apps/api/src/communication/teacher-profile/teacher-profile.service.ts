import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import type { Actor } from '../../platform/types';
import { AUDIT_SERVICE, IDENTITY_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import type { ObjectStorage } from '../attachments/object-storage';

/**
 * The teacher's professional profile.
 *
 * ## What no method accepts
 *
 * A TEACHER ID. Every teacher-facing method takes the authenticated actor and
 * resolves the profile from it. There is no parameter through which a caller
 * could name somebody else's profile, so "may this teacher edit that teacher?"
 * is not a check that can be forgotten -- it is unrepresentable.
 *
 * A STATE. A client submits, and a reviewer approves or requests changes; none
 * of them names the resulting state. The transitions are the server's, and the
 * database refuses the illegal ones independently.
 *
 * AN OBJECT KEY, inbound or outbound. The key is minted here from the upload
 * authorization and never echoed to a client -- not to the owning teacher, not
 * to a reviewer, not to a family. A certificate file is read only through
 * {@link certificateDownloadUrl}, which is a fresh authorization each time.
 *
 * ## Why the writes are transactional
 *
 * Two readers racing to submit, or two reviewers racing to approve, must not be
 * able to leave two open revisions, two published revisions, or a pointer
 * naming a revision that moved underneath it. Every mutation below runs inside
 * `$transaction` and re-reads the rows it depends on INSIDE that transaction;
 * the database's partial unique index on the open revision is the backstop that
 * turns a genuine race into a conflict error rather than a corrupt profile.
 */
@Injectable()
export class TeacherProfileService {
  /** Matches the database check constraint, which is the real limit. */
  private static readonly ALLOWED_MIME = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]);
  private static readonly MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;

  /** Long enough to open a PDF, short enough that a leaked URL is worthless. */
  private static readonly DOWNLOAD_TTL_SECONDS = 300;

  private static readonly OPEN_STATES = ['draft', 'pending_review', 'changes_requested'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Teacher
  // ---------------------------------------------------------------------------

  /**
   * The signed-in teacher's own profile: the published revision, the open one,
   * and the review state of each.
   *
   * Creates nothing. A teacher who has never written a profile gets a null
   * draft, and the first `saveDraft` is what brings a revision into existence --
   * so merely opening the screen does not put a row in the reviewer's world.
   */
  async myProfile(actorId: string): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);
    const profile = await this.prisma.teacherProfessionalProfile.findUnique({
      where: { teacherId: actor.actorId },
      include: {
        publishedRevision: { include: { certificates: true } },
        draftRevision: { include: { certificates: true } },
      },
    });

    return {
      published: profile?.publishedRevision
        ? this.toRevisionView(profile.publishedRevision)
        : null,
      draft: profile?.draftRevision ? this.toRevisionView(profile.draftRevision) : null,
    };
  }

  /**
   * Write the teacher's content to their OPEN revision, creating one if needed.
   *
   * This is where copy-on-write happens. If the profile has no open revision but
   * does have a published one, the new revision is seeded from the published
   * content AND its certificate claims -- the claims cite the same stored
   * objects, so an already-approved credential carries its approval forward and
   * does not need reviewing again. The published revision is not touched.
   */
  async saveDraft(actorId: string, input: ProfileContentInput): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);

    await this.prisma.$transaction(async (tx) => {
      const profile = await this.ensureProfile(tx, actor);
      const revision = await this.openRevision(tx, profile);

      await tx.teacherProfileRevision.update({
        where: { id: revision.id },
        data: {
          bio: input.bio ?? null,
          specialization: input.specialization ?? null,
          qualifications: input.qualifications ?? null,
          experience: input.experience ?? null,
          languages: input.languages ?? [],
        },
      });
    });

    return this.myProfile(actorId);
  }

  /**
   * Hand the open revision to a reviewer.
   *
   * The state is set here and nowhere else; a client never sends one. Submitting
   * an already-submitted revision is a conflict rather than a no-op, because the
   * two cases differ for the person looking at the screen.
   */
  async submit(actorId: string): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);

    await this.prisma.$transaction(async (tx) => {
      const profile = await this.requireProfile(tx, actor.actorId);
      const revision = profile.draftRevisionId
        ? await tx.teacherProfileRevision.findUnique({
            where: { id: profile.draftRevisionId },
            include: { certificates: true },
          })
        : null;

      if (!revision) {
        throw new CommError(
          CommErrorCode.TEACHER_PROFILE_NO_OPEN_REVISION,
          'there is nothing to submit',
          409,
        );
      }
      if (revision.state === 'pending_review') {
        throw new CommError(
          CommErrorCode.TEACHER_PROFILE_ALREADY_SUBMITTED,
          'this revision is already with a reviewer',
          409,
        );
      }

      await tx.teacherProfileRevision.update({
        where: { id: revision.id },
        data: { state: 'pending_review', submittedAt: new Date() },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.submitted',
        entity: 'teacher_profile_revision',
        entityId: revision.id,
        reason: 'teacher submitted a professional profile revision for review',
      });
    });

    return this.myProfile(actorId);
  }

  /**
   * Attach a credential to the open revision.
   *
   * Returns an upload authorization, never a key. The binding commits the
   * uploader to the exact type and size that were validated, so an
   * authorization taken out for a 2MB PDF cannot be spent on a 50MB one.
   */
  async authorizeCertificateUpload(
    actorId: string,
    input: CertificateUploadInput,
  ): Promise<CertificateUploadAuthorization> {
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
    };
  }

  /**
   * Record the uploaded credential against the open revision.
   *
   * Separate from the upload authorization on purpose: the row exists only once
   * the bytes do. `uploadToken` is the object key the previous call minted --
   * the client hands it straight back and cannot have chosen it, because the
   * prefix is derived from the authenticated teacher.
   */
  async addCertificate(
    actorId: string,
    input: AddCertificateInput,
  ): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);
    this.validateCertificate(input);
    this.requireOwnedObjectKey(actor, input.uploadToken);

    await this.prisma.$transaction(async (tx) => {
      const profile = await this.ensureProfile(tx, actor);
      const revision = await this.openRevision(tx, profile);

      await tx.teacherProfileCertificate.create({
        data: {
          revisionId: revision.id,
          title: input.title.trim(),
          issuingOrganization: input.issuingOrganization?.trim() || null,
          issuedOn: input.issuedOn ?? null,
          objectKey: input.uploadToken,
          mimeType: input.mimeType,
          byteSize: BigInt(input.byteSize),
        },
      });
    });

    return this.myProfile(actorId);
  }

  /** Drop a credential from the OPEN revision. The published one keeps its own. */
  async removeCertificate(actorId: string, certificateId: string): Promise<TeacherProfileView> {
    const actor = await this.requireTeacher(actorId);

    await this.prisma.$transaction(async (tx) => {
      const profile = await this.requireProfile(tx, actor.actorId);
      const certificate = await tx.teacherProfileCertificate.findUnique({
        where: { id: certificateId },
      });

      // Scoped to the OPEN revision, so a teacher cannot reach into their own
      // published revision -- which the database would refuse anyway -- nor into
      // anybody else's, which this lookup never finds.
      if (!certificate || certificate.revisionId !== profile.draftRevisionId) {
        throw new CommError(
          CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
          'certificate not found',
          404,
        );
      }

      await tx.teacherProfileCertificate.delete({ where: { id: certificate.id } });
    });

    return this.myProfile(actorId);
  }

  // ---------------------------------------------------------------------------
  // Reviewer
  // ---------------------------------------------------------------------------

  /** Submitted revisions waiting for a decision, oldest first. */
  async reviewQueue(actorId: string): Promise<ReviewQueueItem[]> {
    const actor = await this.requireReviewer(actorId);

    const revisions = await this.prisma.teacherProfileRevision.findMany({
      where: {
        state: 'pending_review',
        profile: this.orgScope(actor),
      },
      include: {
        certificates: true,
        profile: { include: { teacher: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    return revisions.map((revision) => ({
      ...this.toRevisionView(revision),
      revisionId: revision.id,
      // The name is read from chat.teacher through the join -- the profile has
      // no name of its own to disagree with it.
      teacherName: revision.profile.teacher.name,
      pendingCertificates: revision.certificates.filter((c) => c.state === 'pending').length,
    }));
  }

  /** One submitted revision, in full, for the reviewer reading it. */
  async revisionForReview(actorId: string, revisionId: string): Promise<ReviewQueueItem> {
    const actor = await this.requireReviewer(actorId);
    const revision = await this.prisma.teacherProfileRevision.findFirst({
      where: { id: revisionId, profile: this.orgScope(actor) },
      include: { certificates: true, profile: { include: { teacher: true } } },
    });
    if (!revision) {
      throw new CommError(CommErrorCode.TEACHER_PROFILE_NOT_FOUND, 'revision not found', 404);
    }

    return {
      ...this.toRevisionView(revision),
      revisionId: revision.id,
      teacherName: revision.profile.teacher.name,
      pendingCertificates: revision.certificates.filter((c) => c.state === 'pending').length,
    };
  }

  /** Approve or reject one credential. */
  async decideCertificate(
    actorId: string,
    certificateId: string,
    decision: { approved: boolean; note?: string },
  ): Promise<ReviewQueueItem> {
    const actor = await this.requireReviewer(actorId);

    const revisionId = await this.prisma.$transaction(async (tx) => {
      const certificate = await tx.teacherProfileCertificate.findFirst({
        where: { id: certificateId, revision: { profile: this.orgScope(actor) } },
        include: { revision: { include: { profile: true } } },
      });
      if (!certificate) {
        throw new CommError(
          CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
          'certificate not found',
          404,
        );
      }
      this.refuseSelfReview(actor, certificate.revision.profile.teacherId);
      this.requireOpen(certificate.revision.state);

      await tx.teacherProfileCertificate.update({
        where: { id: certificate.id },
        data: {
          state: decision.approved ? 'approved' : 'rejected',
          reviewedAt: new Date(),
          reviewedById: actor.actorId,
          reviewNote: decision.note?.trim() || null,
        },
      });
      return certificate.revisionId;
    });

    return this.revisionForReview(actorId, revisionId);
  }

  /**
   * Approve a revision and make it the published one.
   *
   * ONE transaction, and every precondition is re-read inside it: the caller's
   * authority was checked a moment ago against an actor that could since have
   * been deactivated, and the revision could since have been edited, withdrawn
   * or approved by somebody else. Checking outside the transaction and writing
   * inside it is the shape that produces two published revisions under load.
   */
  async approve(actorId: string, revisionId: string): Promise<ReviewQueueItem> {
    const actor = await this.requireReviewer(actorId);

    await this.prisma.$transaction(async (tx) => {
      // Re-resolve the authority INSIDE the transaction, per the brief: an actor
      // deactivated between the guard and the write must not approve.
      const fresh = await this.identity.resolveActor(actorId);
      if (!fresh) {
        throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
      }
      const decision = this.authz.canReviewTeacherProfile(fresh);
      if (!decision.allowed) throw new CommError(decision.code, decision.reason);

      await this.lockRevision(tx, revisionId);

      const revision = await tx.teacherProfileRevision.findFirst({
        where: { id: revisionId, profile: this.orgScope(actor) },
        include: { certificates: true, profile: true },
      });
      if (!revision) {
        throw new CommError(CommErrorCode.TEACHER_PROFILE_NOT_FOUND, 'revision not found', 404);
      }
      this.refuseSelfReview(actor, revision.profile.teacherId);

      if (revision.state !== 'pending_review') {
        throw new CommError(
          CommErrorCode.TEACHER_PROFILE_NOT_SUBMITTED,
          `this revision is ${revision.state} and is not awaiting a decision`,
          409,
        );
      }

      const undecided = revision.certificates.filter((c) => c.state === 'pending').length;
      if (undecided > 0) {
        throw new CommError(
          CommErrorCode.TEACHER_PROFILE_CERTIFICATES_UNDECIDED,
          `${undecided} certificate(s) still need a decision`,
          409,
        );
      }

      const now = new Date();
      await tx.teacherProfileRevision.update({
        where: { id: revision.id },
        data: {
          state: 'approved',
          approvedAt: now,
          reviewedAt: now,
          reviewedById: actor.actorId,
        },
      });

      // Retire the outgoing version. Conditional because the first approval has
      // nothing to retire.
      if (revision.profile.publishedRevisionId) {
        await tx.teacherProfileRevision.update({
          where: { id: revision.profile.publishedRevisionId },
          data: { state: 'superseded' },
        });
      }

      // The pointer swap is what a family's next read observes, and it happens
      // in the same transaction as both state changes -- so there is no instant
      // at which a family sees nothing, and none at which they see two versions.
      await tx.teacherProfessionalProfile.update({
        where: { id: revision.profileId },
        data: { publishedRevisionId: revision.id, draftRevisionId: null },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.approved',
        entity: 'teacher_profile_revision',
        entityId: revision.id,
        after: { publishedRevisionId: revision.id, supersededId: revision.profile.publishedRevisionId },
        reason: 'reviewer approved a professional profile revision',
      });
    });

    return this.revisionForReview(actorId, revisionId);
  }

  /**
   * Send a revision back with a note.
   *
   * The published revision is untouched, so a family keeps reading the last
   * approved version while the teacher works. The note is mandatory: telling
   * somebody to change something without saying what is not a review.
   */
  async requestChanges(
    actorId: string,
    revisionId: string,
    note: string,
  ): Promise<ReviewQueueItem> {
    const actor = await this.requireReviewer(actorId);
    const trimmed = note?.trim() ?? '';
    if (!trimmed) {
      throw new CommError(
        CommErrorCode.TEACHER_PROFILE_REVIEW_NOTE_REQUIRED,
        'say what needs to change',
        400,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const fresh = await this.identity.resolveActor(actorId);
      if (!fresh) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
      const decision = this.authz.canReviewTeacherProfile(fresh);
      if (!decision.allowed) throw new CommError(decision.code, decision.reason);

      await this.lockRevision(tx, revisionId);

      const revision = await tx.teacherProfileRevision.findFirst({
        where: { id: revisionId, profile: this.orgScope(actor) },
        include: { profile: true },
      });
      if (!revision) {
        throw new CommError(CommErrorCode.TEACHER_PROFILE_NOT_FOUND, 'revision not found', 404);
      }
      this.refuseSelfReview(actor, revision.profile.teacherId);
      if (revision.state !== 'pending_review') {
        throw new CommError(
          CommErrorCode.TEACHER_PROFILE_NOT_SUBMITTED,
          `this revision is ${revision.state} and is not awaiting a decision`,
          409,
        );
      }

      await tx.teacherProfileRevision.update({
        where: { id: revision.id },
        data: {
          state: 'changes_requested',
          reviewedAt: new Date(),
          reviewedById: actor.actorId,
          reviewNote: trimmed,
        },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_profile.changes_requested',
        entity: 'teacher_profile_revision',
        entityId: revision.id,
        reason: 'reviewer returned a professional profile revision to its author',
      });
    });

    return this.revisionForReview(actorId, revisionId);
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  /**
   * A short-lived signed URL for ONE certificate.
   *
   * THE GATE IS HERE, not at the call sites. The caller must either own the
   * revision the claim belongs to, or hold review authority. A family never
   * reaches this method at all -- the published read model returns metadata and
   * no file handle, because a parent has no reason to hold a teacher's
   * credential document.
   */
  async certificateDownloadUrl(actorId: string, certificateId: string): Promise<string> {
    const actor = await this.requireActor(actorId);

    const certificate = await this.prisma.teacherProfileCertificate.findUnique({
      where: { id: certificateId },
      include: { revision: { include: { profile: true } } },
    });
    if (!certificate) {
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
        'certificate not found',
        404,
      );
    }

    const ownsIt =
      actor.kind === 'teacher' && certificate.revision.profile.teacherId === actor.actorId;
    const reviewsIt =
      this.authz.canReviewTeacherProfile(actor).allowed &&
      (!actor.organizationId ||
        certificate.revision.profile.organizationId === actor.organizationId);

    if (!ownsIt && !reviewsIt) {
      // The same code and status as a missing row: whether a particular
      // certificate exists is not a fact an unauthorized caller gets to learn.
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
        'certificate not found',
        404,
      );
    }

    return this.storage.signedReadUrl(
      certificate.objectKey,
      TeacherProfileService.DOWNLOAD_TTL_SECONDS,
    );
  }

  // ---------------------------------------------------------------------------
  // Published read model (no UI in this feature; the contract is implemented)
  // ---------------------------------------------------------------------------

  /**
   * What a family may read about a teacher: the PUBLISHED revision, and nothing
   * else.
   *
   * Resolved through the pointer rather than by searching for an approved row,
   * so a superseded revision -- still historically approved -- can never be
   * selected. Returns no state, no review note, no timestamps, no ids and no
   * object key: the shape itself is what makes a leak hard to write.
   */
  async publishedProfile(teacherId: string): Promise<PublishedProfileView | null> {
    const profile = await this.prisma.teacherProfessionalProfile.findUnique({
      where: { teacherId },
      include: {
        teacher: true,
        publishedRevision: { include: { certificates: true } },
      },
    });
    if (!profile?.publishedRevision) return null;

    const revision = profile.publishedRevision;
    return {
      teacherName: profile.teacher.name,
      bio: revision.bio,
      specialization: revision.specialization,
      qualifications: revision.qualifications,
      experience: revision.experience,
      languages: revision.languages,
      certificates: revision.certificates
        .filter((c) => c.state === 'approved')
        .map((c) => ({
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
   * A teacher may never decide their own profile.
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
        'a teacher cannot review their own profile',
      );
    }
  }

  private requireOpen(state: string): void {
    if (!TeacherProfileService.OPEN_STATES.includes(state)) {
      throw new CommError(
        CommErrorCode.TEACHER_PROFILE_REVISION_CLOSED,
        `revision is ${state} and can no longer be changed`,
        409,
      );
    }
  }

  private orgScope(actor: Actor): { organizationId?: string } {
    return actor.organizationId ? { organizationId: actor.organizationId } : {};
  }

  /**
   * The key must sit under the prefix this teacher's upload authorization
   * minted. Without this a teacher could hand back a key belonging to another
   * teacher's upload and attach their document as a credential of their own.
   */
  private requireOwnedObjectKey(actor: Actor, objectKey: string): void {
    const prefix = `teacher-certificates/${actor.actorId}/`;
    if (!objectKey || !objectKey.startsWith(prefix) || objectKey.includes('..')) {
      throw new CommError(
        CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
        'that upload does not belong to this teacher',
        400,
      );
    }
  }

  private validateCertificate(input: { mimeType: string; byteSize: number }): void {
    if (!TeacherProfileService.ALLOWED_MIME.has(input.mimeType)) {
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
   * Take the row lock before deciding anything about a revision.
   *
   * Without it two reviewers both approve: Prisma runs READ COMMITTED, so the
   * loser's UPDATE re-reads the row after the winner commits, the transition
   * trigger sees `approved -> approved` and waves it through, and the second
   * reviewer is told they approved something they did not -- with a second audit
   * record to match. The data stayed consistent; the story told about it did
   * not. Locking first makes the loser re-read the committed state and fail the
   * `pending_review` check honestly.
   */
  private async lockRevision(tx: PrismaTx, revisionId: string): Promise<void> {
    await tx.$queryRaw`
      select id from chat.teacher_profile_revision where id = ${revisionId}::uuid for update
    `;
  }

  private async requireProfile(tx: PrismaTx, teacherId: string) {
    const profile = await tx.teacherProfessionalProfile.findUnique({ where: { teacherId } });
    if (!profile) {
      throw new CommError(CommErrorCode.TEACHER_PROFILE_NOT_FOUND, 'no profile yet', 404);
    }
    return profile;
  }

  private async ensureProfile(tx: PrismaTx, actor: Actor) {
    const existing = await tx.teacherProfessionalProfile.findUnique({
      where: { teacherId: actor.actorId },
    });
    if (existing) return existing;

    return tx.teacherProfessionalProfile.create({
      data: {
        teacherId: actor.actorId,
        ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
      },
    });
  }

  /**
   * The open revision, created by copy-on-write if there is none.
   *
   * Seeded from the published revision when one exists, certificate claims
   * included: the claims cite the SAME stored objects and keep their approval,
   * so an unchanged credential is not re-reviewed and no bytes are copied.
   */
  private async openRevision(tx: PrismaTx, profile: ProfileRow) {
    if (profile.draftRevisionId) {
      const open = await tx.teacherProfileRevision.findUnique({
        where: { id: profile.draftRevisionId },
      });
      if (open) return open;
    }

    const published = profile.publishedRevisionId
      ? await tx.teacherProfileRevision.findUnique({
          where: { id: profile.publishedRevisionId },
          include: { certificates: true },
        })
      : null;

    const last = await tx.teacherProfileRevision.aggregate({
      where: { profileId: profile.id },
      _max: { revisionNumber: true },
    });

    const created = await tx.teacherProfileRevision.create({
      data: {
        profileId: profile.id,
        revisionNumber: (last._max.revisionNumber ?? 0) + 1,
        bio: published?.bio ?? null,
        specialization: published?.specialization ?? null,
        qualifications: published?.qualifications ?? null,
        experience: published?.experience ?? null,
        languages: published?.languages ?? [],
      },
    });

    if (published?.certificates.length) {
      await tx.teacherProfileCertificate.createMany({
        data: published.certificates.map((c) => ({
          revisionId: created.id,
          title: c.title,
          issuingOrganization: c.issuingOrganization,
          issuedOn: c.issuedOn,
          objectKey: c.objectKey,
          mimeType: c.mimeType,
          byteSize: c.byteSize,
          state: c.state,
          reviewedAt: c.reviewedAt,
          reviewedById: c.reviewedById,
        })),
      });
    }

    await tx.teacherProfessionalProfile.update({
      where: { id: profile.id },
      data: { draftRevisionId: created.id },
    });

    return created;
  }

  /** Never includes objectKey. A view that cannot carry a key cannot leak one. */
  private toRevisionView(revision: RevisionRow): RevisionView {
    return {
      state: revision.state,
      revisionNumber: revision.revisionNumber,
      bio: revision.bio,
      specialization: revision.specialization,
      qualifications: revision.qualifications,
      experience: revision.experience,
      languages: revision.languages,
      reviewNote: revision.reviewNote,
      submittedAt: revision.submittedAt,
      approvedAt: revision.approvedAt,
      certificates: (revision.certificates ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        issuingOrganization: c.issuingOrganization,
        issuedOn: c.issuedOn,
        state: c.state,
        reviewNote: c.reviewNote,
        mimeType: c.mimeType,
        byteSize: Number(c.byteSize),
      })),
    };
  }
}

// --- shapes -----------------------------------------------------------------

type PrismaTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
type ProfileRow = { id: string; draftRevisionId: string | null; publishedRevisionId: string | null };
type RevisionRow = {
  state: string;
  revisionNumber: number;
  bio: string | null;
  specialization: string | null;
  qualifications: string | null;
  experience: string | null;
  languages: string[];
  reviewNote: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  certificates?: CertificateRow[];
};
type CertificateRow = {
  id: string;
  title: string;
  issuingOrganization: string | null;
  issuedOn: Date | null;
  state: string;
  reviewNote: string | null;
  mimeType: string;
  byteSize: bigint;
};

export interface ProfileContentInput {
  bio?: string | null;
  specialization?: string | null;
  qualifications?: string | null;
  experience?: string | null;
  languages?: string[];
}

export interface CertificateUploadInput {
  mimeType: string;
  byteSize: number;
}

export interface AddCertificateInput extends CertificateUploadInput {
  title: string;
  issuingOrganization?: string | null;
  issuedOn?: Date | null;
  /** The object key the upload authorization minted. Never client-chosen. */
  uploadToken: string;
}

export interface CertificateUploadAuthorization {
  uploadUrl: string;
  /** Handed straight back to `addCertificate`. Opaque to the client. */
  uploadToken: string;
  expiresAt: string;
}

export interface CertificateView {
  id: string;
  title: string;
  issuingOrganization: string | null;
  issuedOn: Date | null;
  state: string;
  reviewNote: string | null;
  mimeType: string;
  byteSize: number;
}

export interface RevisionView {
  state: string;
  revisionNumber: number;
  bio: string | null;
  specialization: string | null;
  qualifications: string | null;
  experience: string | null;
  languages: string[];
  reviewNote: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  certificates: CertificateView[];
}

export interface TeacherProfileView {
  published: RevisionView | null;
  draft: RevisionView | null;
}

export interface ReviewQueueItem extends RevisionView {
  revisionId: string;
  teacherName: string;
  pendingCertificates: number;
}

export interface PublishedProfileView {
  teacherName: string;
  bio: string | null;
  specialization: string | null;
  qualifications: string | null;
  experience: string | null;
  languages: string[];
  certificates: { title: string; issuingOrganization: string | null; issuedOn: Date | null }[];
}
