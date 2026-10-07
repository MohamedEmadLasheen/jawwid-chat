/// The teacher's professional profile, exactly as `GET /me/teacher-profile`
/// returns it.
///
/// This mirrors the server's view and deliberately adds nothing. In particular
/// it carries:
///
/// * NO teacher name and NO role. Those come from the authenticated identity
///   (`AuthUser`), which is the one place they live. A profile that could carry
///   a second copy of the teacher's name is a profile that could disagree with
///   it.
/// * NO object key, storage path, revision id or reviewer id. The server never
///   sends them, so there is nothing here to leak and nothing to accidentally
///   render.
///
/// Versioning is the SERVER's. The client never decides which revision it is
/// editing, never creates one, and never computes the next state: it renders
/// what `published` and `draft` say and calls the endpoint that changes them.
library;

/// Where a revision sits in review. These are the server's own values; the
/// client never invents a state and never maps one onto another.
enum RevisionState {
  draft,
  pendingReview,
  changesRequested,
  approved,

  /// A past published version. The teacher-facing API never returns one — the
  /// published pointer always names the current version — but the value exists
  /// so an unexpected payload degrades to "something we do not render" rather
  /// than to a wrong state.
  superseded;

  static RevisionState? tryParse(String? raw) => switch (raw) {
        'draft' => RevisionState.draft,
        'pending_review' => RevisionState.pendingReview,
        'changes_requested' => RevisionState.changesRequested,
        'approved' => RevisionState.approved,
        'superseded' => RevisionState.superseded,
        _ => null,
      };
}

/// A credential's own review outcome, decided independently of the revision it
/// belongs to.
enum CertificateState {
  pending,
  approved,
  rejected;

  static CertificateState? tryParse(String? raw) => switch (raw) {
        'pending' => CertificateState.pending,
        'approved' => CertificateState.approved,
        'rejected' => CertificateState.rejected,
        _ => null,
      };
}

/// One credential claim.
///
/// [id] is the certificate's own id and is the only identifier the client ever
/// holds — it is what `DELETE …/certificates/:id` and the download endpoint
/// take. There is no revision id here, because the client has no business
/// naming a revision.
class ProfileCertificate {
  const ProfileCertificate({
    required this.id,
    required this.title,
    required this.state,
    this.issuingOrganization,
    this.issuedOn,
    this.reviewNote,
  });

  final String id;
  final String title;
  final CertificateState state;
  final String? issuingOrganization;
  final DateTime? issuedOn;

  /// Why a reviewer rejected it. Null unless they said.
  final String? reviewNote;
}

/// One version of the profile's content.
class ProfileRevision {
  const ProfileRevision({
    required this.state,
    required this.certificates,
    this.bio,
    this.specialization,
    this.qualifications,
    this.experience,
    this.languages = const [],
    this.reviewNote,
  });

  final RevisionState state;
  final List<ProfileCertificate> certificates;

  final String? bio;
  final String? specialization;
  final String? qualifications;
  final String? experience;
  final List<String> languages;

  /// The reviewer's note. Only ever present on a `changesRequested` revision.
  final String? reviewNote;

  /// Whether the teacher has written anything at all into this revision.
  bool get isEmpty =>
      (bio ?? '').trim().isEmpty &&
      (specialization ?? '').trim().isEmpty &&
      (qualifications ?? '').trim().isEmpty &&
      (experience ?? '').trim().isEmpty &&
      languages.isEmpty &&
      certificates.isEmpty;
}

/// What the teacher's own screen renders.
///
/// Both halves can be null, and the pair is what the screen reads:
///
/// * `published == null && draft == null` — nothing written yet.
/// * `published == null && draft != null` — a first profile, not yet approved.
/// * `published != null && draft == null` — approved, with no edit in flight.
/// * both — approved, and a new revision is being written or reviewed. The
///   family still reads `published`; the teacher edits `draft`.
class TeacherProfile {
  const TeacherProfile({this.published, this.draft});

  /// The approved version a family reads. Never editable — editing it is what
  /// copy-on-write exists to prevent, and the server refuses it outright.
  final ProfileRevision? published;

  /// The revision the teacher may edit, when one is open.
  final ProfileRevision? draft;

  /// The revision the screen shows.
  ///
  /// The open one when there is one, because that is what the teacher is
  /// working on; otherwise the published one, which is what exists. Null only
  /// before anything has ever been written.
  ProfileRevision? get current => draft ?? published;

  /// Whether the teacher may type right now.
  ///
  /// False while a revision is with a reviewer: the server would bounce the
  /// revision back to draft on any edit, and letting someone type into a
  /// screen that silently withdraws their submission is worse than not
  /// offering it.
  bool get isEditable {
    final open = draft;
    if (open == null) return true; // starting a new revision is always allowed
    return open.state == RevisionState.draft ||
        open.state == RevisionState.changesRequested;
  }

  /// Whether there is anything a reviewer could be asked to look at.
  bool get canSubmit =>
      draft != null &&
      !draft!.isEmpty &&
      (draft!.state == RevisionState.draft ||
          draft!.state == RevisionState.changesRequested);

  bool get isAwaitingReview => draft?.state == RevisionState.pendingReview;

  bool get hasChangesRequested => draft?.state == RevisionState.changesRequested;

  /// Approved AND nothing in flight — the resting state after a review.
  bool get isApproved => published != null && draft == null;
}

/// A file the teacher chose, on its way to becoming a certificate.
class PendingCertificateFile {
  const PendingCertificateFile({
    required this.filePath,
    required this.mimeType,
    required this.byteSize,
    this.fileName,
  });

  final String filePath;
  final String mimeType;
  final int byteSize;
  final String? fileName;
}

/// What the server accepts. Mirrors the check constraint and the service
/// validation, which are the real limits — this copy exists so the teacher is
/// told before a file is uploaded, never to decide anything the server decides.
abstract final class CertificateLimits {
  static const maxBytes = 10 * 1024 * 1024;

  static const allowedMimeTypes = {
    'application/pdf',
    'image/jpeg',
    'image/png',
  };

  static const maxTitleLength = 200;
  static const maxIssuerLength = 200;
}

/// Field limits for the profile text, matching the database check constraints.
abstract final class ProfileLimits {
  static const maxBio = 2000;
  static const maxSpecialization = 200;
  static const maxQualifications = 2000;
  static const maxExperience = 2000;
  static const maxLanguages = 10;
}
