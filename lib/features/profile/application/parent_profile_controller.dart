import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../shared/models/parent_profile.dart';
import '../presentation/profile_photos_section.dart';

/// The signed-in parent's own profile, and the edits a parent may make to it.
///
/// ## Why the state is the profile and nothing else
///
/// Every mutation on the repository answers with the WHOLE profile, so this controller never
/// patches a field locally and never has to reconcile two sources. The screen shows what the
/// server last said, which is what makes "save and immediately see the result" true rather
/// than optimistic — and it is why a rename is instantly consistent with the chat list, which
/// reads the same identity row.
///
/// ## Why a failure never leaves the screen wrong
///
/// A failed save restores the previous [AsyncData] rather than parking the screen in
/// [AsyncError]: the profile the parent was looking at is still valid, and replacing it with
/// a full-screen error because one save failed would lose their place for no reason. The
/// failure is returned to the caller instead, which is what shows the message. Only the
/// initial LOAD may put the screen in an error state, because then there is genuinely
/// nothing to show.
class ParentProfileController extends AsyncNotifier<ParentProfile> {
  @override
  Future<ParentProfile> build() => ref.read(profileRepositoryProvider).me();

  /// Refetch. Wired to pull-to-refresh and to the retry action on the error state.
  Future<void> refresh() async {
    state = await AsyncValue.guard(() => ref.read(profileRepositoryProvider).me());
  }

  Future<AppError?> saveMe({String? name, String? about}) =>
      _mutate((repo) => repo.updateMe(name: name, about: about));

  Future<AppError?> saveChild(String childId, {String? name, String? about}) =>
      _mutate((repo) => repo.updateChild(childId, name: name, about: about));

  // The photos go through the one writer every person shares (`/me/avatar`,
  // `/me/children/:id/avatar` -- [profilePhotoRepositoryProvider]), and the profile is then
  // re-read for the new links. My account's copy is dropped so it cannot show the old face.

  Future<AppError?> setAvatar(PendingAttachment image) =>
      _photo(() => ref.read(profilePhotoRepositoryProvider).set(image));

  Future<AppError?> removeAvatar() =>
      _photo(() => ref.read(profilePhotoRepositoryProvider).remove());

  Future<AppError?> setChildAvatar(String childId, PendingAttachment image) =>
      _photo(() => ref.read(profilePhotoRepositoryProvider).set(image, childId: childId));

  Future<AppError?> removeChildAvatar(String childId) =>
      _photo(() => ref.read(profilePhotoRepositoryProvider).remove(childId: childId));

  Future<AppError?> _photo(Future<void> Function() write) => _mutate((repo) async {
        await write();
        ref.invalidate(myPhotosProvider);
        return repo.me();
      });

  /// Run one edit, keeping the screen coherent whatever happens.
  ///
  /// Returns null on success and the failure otherwise, so the caller can say something
  /// specific. Nothing here inspects the error: mapping it to words is the screen's job and
  /// the localisation's, not this layer's.
  Future<AppError?> _mutate(
    Future<ParentProfile> Function(ProfileRepository repo) run,
  ) async {
    // Deliberately no intermediate AsyncLoading: the screen keeps showing the profile it
    // has while a save is in flight, so the whole page does not blink for one field. The
    // caller drives its own in-place progress indicator.
    final previous = switch (state) {
      AsyncData(:final value) => value,
      _ => null,
    };

    try {
      state = AsyncData(await run(ref.read(profileRepositoryProvider)));
      return null;
    } catch (error, stack) {
      // Put the parent back where they were. The save did not happen; the screen should not
      // pretend otherwise, and should not lose the rest of the profile either.
      if (previous != null) {
        state = AsyncData(previous);
      } else {
        state = AsyncError(error, stack);
      }
      return error is AppError ? error : const AppError(AppErrorKind.unknown);
    }
  }
}

/// `autoDispose` because the state carries signed photo links, which expire: re-opening the
/// screen refetches them. (They are bucketed to the hour, so a screen left open is fine.)
final parentProfileProvider =
    AsyncNotifierProvider.autoDispose<ParentProfileController, ParentProfile>(
  ParentProfileController.new,
);
