import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/shared/models/teacher_profile.dart';

/// A [TeacherProfileRepository] standing in for the network, and nothing more.
///
/// It fakes the TRANSPORT. It does not reimplement the server: there is no
/// validation here, no ownership check, no certificate review. Those are the
/// server's, are tested against a real database in
/// `apps/api/test/integration/teacher-profile.spec.ts` and
/// `db/tests/teacher_profile_rls.sql`, and a second copy in this file could
/// only ever agree with itself.
///
/// What a test does instead is set [profile] to the shape the server would
/// return and assert what the screen does with it. [next] exists for the one
/// thing that genuinely is client behaviour: that a mutation's response
/// replaces what is on screen.
class FakeTeacherProfileRepository implements TeacherProfileRepository {
  FakeTeacherProfileRepository({
    TeacherProfile? profile,
    this.loadError,
    this.mutationError,
    this.uploadError,
    this.loadDelay = Duration.zero,
  }) : profile = profile ?? const TeacherProfile(name: 'Ustadh Teacher');

  TeacherProfile profile;

  /// What the NEXT mutation resolves to. Null means "return [profile]".
  TeacherProfile? next;

  AppError? loadError;
  AppError? mutationError;

  /// Thrown by [addCertificate] after progress has been reported, so a test can
  /// exercise a failure that arrives mid-upload.
  Object? uploadError;

  Duration loadDelay;

  /// Held for this long inside every mutation. Without it a 'double tap sends
  /// one request' test is vacuous: the first call completes in a microtask and
  /// the guard it is meant to exercise is never under pressure.
  Duration mutationDelay = Duration.zero;

  final List<String> calls = [];
  final List<String> removed = [];
  ({String title, String? issuer, DateTime? issuedOn})? lastCertificate;
  Map<String, Object?>? lastSave;

  @override
  Future<TeacherProfile> myProfile() async {
    calls.add('myProfile');
    if (loadDelay > Duration.zero) await Future<void>.delayed(loadDelay);
    if (loadError != null) throw loadError!;
    return profile;
  }

  @override
  Future<TeacherProfile> saveProfile({
    String? bio,
    String? specialization,
    String? qualifications,
    String? experience,
    List<String> languages = const [],
  }) async {
    calls.add('saveProfile');
    if (mutationDelay > Duration.zero) await Future<void>.delayed(mutationDelay);
    lastSave = {
      'bio': bio,
      'specialization': specialization,
      'qualifications': qualifications,
      'experience': experience,
      'languages': languages,
    };
    if (mutationError != null) throw mutationError!;
    return _resolve();
  }

  /// The name the fake "stored", after the trimming the real server does.
  ///
  /// Trimmed HERE on purpose: the contract the client must honour is that it
  /// renders the SERVER's answer, so the fake has to be able to answer something
  /// different from what was sent.
  String storedName = 'Ustadh Teacher';
  final List<String> renames = [];

  @override
  Future<String> updateName(String name) async {
    calls.add('updateName');
    renames.add(name);
    if (mutationDelay > Duration.zero) await Future<void>.delayed(mutationDelay);
    if (mutationError != null) throw mutationError!;
    storedName = name.replaceAll(RegExp(r'\s+'), ' ').trim();
    profile = profile.copyWith(name: storedName);
    return storedName;
  }

  @override
  Future<TeacherProfile> addCertificate({
    required PendingCertificateFile file,
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
    void Function(int sent, int total)? onProgress,
  }) async {
    calls.add('addCertificate');
    lastCertificate = (title: title, issuer: issuingOrganization, issuedOn: issuedOn);

    // Report partial progress before deciding the outcome, so a failing upload
    // is one that failed PART WAY -- which is the case a progress bar has to
    // survive.
    onProgress?.call(file.byteSize ~/ 2, file.byteSize);
    if (uploadError != null) throw uploadError!;
    onProgress?.call(file.byteSize, file.byteSize);
    if (mutationError != null) throw mutationError!;
    return _resolve();
  }

  @override
  Future<TeacherProfile> updateCertificate(
    String certificateId, {
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
  }) async {
    calls.add('updateCertificate:$certificateId');
    if (mutationDelay > Duration.zero) await Future<void>.delayed(mutationDelay);
    lastCertificate = (title: title, issuer: issuingOrganization, issuedOn: issuedOn);
    if (mutationError != null) throw mutationError!;
    return _resolve();
  }

  @override
  Future<TeacherProfile> removeCertificate(String certificateId) async {
    calls.add('removeCertificate');
    if (mutationDelay > Duration.zero) await Future<void>.delayed(mutationDelay);
    removed.add(certificateId);
    if (mutationError != null) throw mutationError!;
    return _resolve();
  }

  @override
  Future<String> certificateUrl(String certificateId) async {
    calls.add('certificateUrl:$certificateId');
    if (mutationError != null) throw mutationError!;
    return 'https://files.example/$certificateId';
  }

  TeacherProfile _resolve() {
    final updated = next;
    if (updated != null) {
      profile = updated;
      next = null;
    }
    return profile;
  }
}

/// A picker that returns whatever the test put in it.
class FakeCertificatePicker implements MediaPicker {
  FakeCertificatePicker({this.file});

  PendingAttachment? file;

  @override
  Future<PendingAttachment?> pickFile() async => file;

  @override
  Future<PendingAttachment?> pickImage() async => file;

  @override
  Future<PendingAttachment?> captureImage() async => file;
}

/// Records what the screen asked to open, without launching anything.
class RecordingAttachmentOpener implements AttachmentOpener {
  final List<String> opened = [];

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return true;
  }
}
