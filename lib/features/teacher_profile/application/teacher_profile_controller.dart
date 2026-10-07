import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../shared/models/teacher_profile.dart';

/// The code this controller reports when no profile backend is registered in
/// this build. Mirrors `storiesNotAvailableCode` — the same distinction the
/// Stories rail draws between "nothing here" and "not wired".
const teacherProfileNotAvailableCode = 'teacher_profile_not_available';

/// The signed-in teacher's professional profile.
///
/// ## What this controller is authoritative about: nothing
///
/// The server owns the revision model. This controller does not decide which
/// revision is being edited, does not create one, does not compute the next
/// state, and never writes a state of its own into the model it holds. Every
/// mutation returns the server's fresh view and that view replaces the state
/// wholesale — so an optimistic guess cannot drift from what was actually
/// stored.
///
/// That is a deliberate cost: each save is a round trip before the screen
/// settles. The alternative is a client that believes it knows whether its edit
/// opened a new revision, which is exactly the fact copy-on-write makes
/// non-obvious.
class TeacherProfileController extends AsyncNotifier<TeacherProfile> {
  @override
  Future<TeacherProfile> build() => _load();

  Future<TeacherProfile> _load() async {
    final TeacherProfileRepository repository;
    try {
      repository = ref.read(teacherProfileRepositoryProvider);
    } catch (error) {
      // Riverpod wraps whatever a provider's create function throws, so the
      // UnimplementedError arrives one layer down. Unwrap before deciding.
      final cause = error is ProviderException ? error.exception : error;
      if (cause is! UnimplementedError) rethrow;

      throw const AppError(
        AppErrorKind.notFound,
        code: teacherProfileNotAvailableCode,
        debugDetail: 'No TeacherProfileRepository is registered in this build.',
      );
    }
    return repository.myProfile();
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }

  /// Save the teacher's content.
  ///
  /// Whether this opened a NEW revision — because the last one was approved —
  /// is the server's answer, and arrives in the response. The screen learns it
  /// by rendering what came back, not by predicting it.
  Future<void> save({
    String? bio,
    String? specialization,
    String? qualifications,
    String? experience,
    List<String> languages = const [],
  }) =>
      _mutate((repository) => repository.saveDraft(
            bio: bio,
            specialization: specialization,
            qualifications: qualifications,
            experience: experience,
            languages: languages,
          ));

  Future<void> submit() => _mutate((repository) => repository.submit());

  Future<void> addCertificate({
    required PendingCertificateFile file,
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
    void Function(int sent, int total)? onProgress,
  }) =>
      _mutate((repository) => repository.addCertificate(
            file: file,
            title: title,
            issuingOrganization: issuingOrganization,
            issuedOn: issuedOn,
            onProgress: onProgress,
          ));

  Future<void> removeCertificate(String certificateId) =>
      _mutate((repository) => repository.removeCertificate(certificateId));

  /// A fresh, short-lived URL for one certificate file.
  ///
  /// Deliberately not held in state: it expires, and a URL kept in a widget
  /// outlives the moment it was authorized for.
  Future<String> certificateUrl(String certificateId) =>
      ref.read(teacherProfileRepositoryProvider).certificateUrl(certificateId);

  /// One mutation, one rule: on success the server's view replaces ours; on
  /// failure the previous view stays and the error is rethrown for the caller
  /// to show.
  ///
  /// No intermediate `AsyncLoading`: blanking a half-filled form because a save
  /// is in flight loses the thing the teacher is looking at. The screen tracks
  /// "saving" itself and keeps the fields on screen.
  Future<void> _mutate(
    Future<TeacherProfile> Function(TeacherProfileRepository repository) run,
  ) async {
    final repository = ref.read(teacherProfileRepositoryProvider);
    final updated = await run(repository);
    state = AsyncData(updated);
  }
}

final teacherProfileControllerProvider =
    AsyncNotifierProvider<TeacherProfileController, TeacherProfile>(
  TeacherProfileController.new,
);
