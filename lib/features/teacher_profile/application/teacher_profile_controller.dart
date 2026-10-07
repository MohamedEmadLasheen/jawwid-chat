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
/// Every mutation returns the server's fresh view and that view replaces the
/// state wholesale — so an optimistic guess cannot drift from what was actually
/// stored. That matters most for the NAME: the server trims it, collapses
/// pasted newlines and has the last word, so what is rendered after a rename is
/// what came back, never the string that was typed.
///
/// It is a deliberate cost: each save is a round trip before the screen
/// settles. The alternative is a client that shows the teacher a profile the
/// server does not have.
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

  /// Save the teacher's content. It is current the moment this returns.
  Future<void> save({
    String? bio,
    String? specialization,
    String? qualifications,
    String? experience,
    List<String> languages = const [],
  }) =>
      _mutate((repository) => repository.saveProfile(
            bio: bio,
            specialization: specialization,
            qualifications: qualifications,
            experience: experience,
            languages: languages,
          ));

  /// Rename the teacher.
  ///
  /// Two writes land here, and the order is the point: the server's stored name
  /// goes into THIS state, and the session identity is refreshed so every other
  /// Teacher Account surface re-reads it through its own data flow. Nothing is
  /// copied between them -- both read the same server answer.
  Future<void> rename(String name) async {
    final repository = ref.read(teacherProfileRepositoryProvider);
    final stored = await repository.updateName(name);

    final current = state.value;
    if (current != null) state = AsyncData(current.copyWith(name: stored));

    // The auth session holds the identity that Settings, message authors and
    // every participant list render. Re-reading it is what makes the rename
    // visible there without this feature knowing those screens exist.
    await ref.read(authControllerProvider.notifier).refreshIdentity();
  }

  /// Replace the profile photo.
  Future<void> setPhoto({
    required PendingPhotoFile file,
    void Function(int sent, int total)? onProgress,
  }) =>
      _mutate((repository) => repository.setPhoto(file: file, onProgress: onProgress));

  Future<void> removePhoto() => _mutate((repository) => repository.removePhoto());

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

  /// Rename a credential. The server re-pends it; the screen learns that from
  /// the response rather than assuming it.
  Future<void> updateCertificate(
    String certificateId, {
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
  }) =>
      _mutate((repository) => repository.updateCertificate(
            certificateId,
            title: title,
            issuingOrganization: issuingOrganization,
            issuedOn: issuedOn,
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
