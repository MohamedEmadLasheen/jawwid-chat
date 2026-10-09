import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../shared/models/parent_profile.dart';

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

  /// How many re-signs one visit to the screen may spend. See
  /// [resignAfterImageFailure] for why this is a COUNT and not a set of URLs.
  static const _maxResigns = 3;

  int _resigns = 0;

  /// Re-sign after a photo failed to load — a bounded number of times.
  ///
  /// ## Why this exists
  ///
  /// Every `avatarUrl` is a signed URL with a five-minute life. `autoDispose` already means
  /// re-ENTERING the screen mints fresh ones, but a screen left OPEN past the TTL that then
  /// rebuilds an image would reach an expired URL and show initials for as long as it stayed
  /// open — a parent watching the photo they just set turn back into letters. Refetching
  /// replaces the profile with freshly signed URLs, so the photo returns.
  ///
  /// ## Why the bound is a COUNT, and not "once per URL"
  ///
  /// Deduplicating by URL looks like the obvious guard and is WRONG here, which a test
  /// proved by hanging: the server mints a NEW signature on every fetch, so each retry
  /// carries a URL never seen before, passes the check, and refetches forever whenever the
  /// image can never load at all.
  ///
  /// A count terminates whatever the server returns. Expiry needs exactly one; a genuinely
  /// broken image — a deleted object, a permanent 404 — spends the budget and then settles
  /// on initials. Several avatars failing together share the same budget, which is why it is
  /// three rather than one.
  ///
  /// Nothing here weakens the security model: the refetch goes through the same
  /// authenticated API, the object stays private, and no URL outlives its signature.
  Future<void> resignAfterImageFailure(String failedUrl) async {
    if (failedUrl.isEmpty) return;
    if (_resigns >= _maxResigns) return;
    _resigns++;
    await refresh();
  }

  Future<AppError?> saveMe({String? name, String? about}) =>
      _mutate((repo) => repo.updateMe(name: name, about: about));

  Future<AppError?> saveChild(String childId, {String? name, String? about}) =>
      _mutate((repo) => repo.updateChild(childId, name: name, about: about));

  Future<AppError?> setAvatar(PendingAttachment image) =>
      _mutate((repo) => repo.setAvatar(image));

  Future<AppError?> removeAvatar() => _mutate((repo) => repo.removeAvatar());

  Future<AppError?> setChildAvatar(String childId, PendingAttachment image) =>
      _mutate((repo) => repo.setChildAvatar(childId, image));

  Future<AppError?> removeChildAvatar(String childId) =>
      _mutate((repo) => repo.removeChildAvatar(childId));

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

/// `autoDispose` because the state carries SHORT-LIVED CREDENTIALS.
///
/// A `ParentProfile` is not inert data: its `avatarUrl` — and every child's — is a signed URL
/// valid for five minutes. Cached for the life of the session, this provider would keep
/// handing expired URLs to `Image.network` long after storage stopped honouring them, and
/// every photo would quietly become initials.
///
/// Dropping the state when the screen closes means re-opening it refetches and re-signs. The
/// data a screen shows is only as fresh as the credential inside it.
///
/// A screen left OPEN past the TTL is handled separately, by
/// [ParentProfileController.resignAfterImageFailure]: the image failure is reported back and
/// answered with a bounded refetch, so the photo returns instead of becoming initials.
final parentProfileProvider =
    AsyncNotifierProvider.autoDispose<ParentProfileController, ParentProfile>(
  ParentProfileController.new,
);
