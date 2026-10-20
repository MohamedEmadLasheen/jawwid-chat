/// The teacher's professional profile, exactly as `GET /me/teacher-profile`
/// returns it.
///
/// This mirrors the server's view and deliberately adds nothing. In particular
/// it carries NO object key, storage path or reviewer id: the server never
/// sends them, so there is nothing here to leak and nothing to render by
/// accident. [photoUrl] is a short-lived signed URL, not a path.
///
/// ## V2: there are no versions
///
/// The previous shape was `{published, draft}` with a five-value review state,
/// because an admin decided when a teacher's words became visible. The teacher
/// now owns their profile: Save writes it and the write is the publish. So this
/// is one flat object, and the client has no state to interpret.
///
/// [name] is the teacher's authoritative identity, served from `chat.teacher`
/// and NOT stored in any profile table. It is here because the screen renders
/// it and edits it; it is never a second copy, because the only place it is
/// written is `PATCH /me/teacher-profile/name`, and the response to that is
/// what the client then shows.
library;

/// A credential's own review outcome.
///
/// Credentials still have one: profile text saves immediately, but a document
/// claiming a qualification does not become verified by being uploaded.
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
/// [id] is the only identifier the client ever holds -- it is what
/// `PATCH`/`DELETE …/certificates/:id` and the download endpoint take.
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

/// The teacher's professional profile: one object, current as of the last save.
class TeacherProfile {
  const TeacherProfile({
    required this.name,
    this.photoUrl,
    this.bio,
    this.specialization,
    this.qualifications,
    this.experience,
    this.languages = const [],
    this.certificates = const [],
    this.updatedAt,
  });

  /// Empty, for a teacher who has never saved. The server creates no row for
  /// one either, so opening the screen is not a write.
  const TeacherProfile.empty({required String name})
      : this(name: name);

  /// The authoritative teacher name, from `chat.teacher`.
  final String name;

  /// A short-lived signed URL, or null when there is no photo -- in which case
  /// the avatar falls back to generated initials.
  final String? photoUrl;

  final String? bio;
  final String? specialization;
  final String? qualifications;
  final String? experience;
  final List<String> languages;
  final List<ProfileCertificate> certificates;

  /// When the profile was last saved. Null when it never has been.
  final DateTime? updatedAt;

  /// Whether the teacher has written anything at all.
  bool get isEmpty =>
      (bio ?? '').trim().isEmpty &&
      (specialization ?? '').trim().isEmpty &&
      (qualifications ?? '').trim().isEmpty &&
      (experience ?? '').trim().isEmpty &&
      languages.isEmpty &&
      certificates.isEmpty &&
      photoUrl == null;

  /// How many credentials are still awaiting a decision. Shown as information,
  /// never as something that blocks the teacher from saving.
  int get pendingCertificates =>
      certificates.where((c) => c.state == CertificateState.pending).length;

  TeacherProfile copyWith({String? name}) => TeacherProfile(
        name: name ?? this.name,
        photoUrl: photoUrl,
        bio: bio,
        specialization: specialization,
        qualifications: qualifications,
        experience: experience,
        languages: languages,
        certificates: certificates,
        updatedAt: updatedAt,
      );
}

/// A file the teacher has chosen but not yet uploaded.
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

/// What the server accepts for profile CONTENT. Repeated here so a field can
/// stop the teacher at the limit instead of letting a save fail at it; the
/// database CHECK constraints are the real limit.
abstract final class ProfileLimits {
  static const maxBio = 2000;
  static const maxSpecialization = 200;
  static const maxQualifications = 2000;
  static const maxExperience = 2000;
  static const maxLanguages = 10;
  static const maxName = 120;
}

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
