import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../shared/models/parent_profile.dart';

/// The signed-in parent's own profile, and the photo operations on it.
///
/// ## Why the state is the profile and nothing else
///
/// Every mutation on the repository answers with the WHOLE profile, so this controller
/// never patches a field locally and never has to reconcile two sources. The screen shows
/// what the server last said, which is what makes "the avatar updates immediately" true
/// rather than optimistic.
///
/// ## Why a failure never leaves the screen wrong
///
/// A failed upload or removal restores the previous [AsyncData] rather than parking the
/// screen in [AsyncError]: the profile the parent was looking at is still valid, and
/// replacing it with a full-screen error because one photo upload failed would lose their
/// place for no reason. The failure is returned to the caller instead, which is what shows
/// the message. Only the initial LOAD may put the screen in an error state, because then
/// there is genuinely nothing to show.
/// The photo operations every account kind shares.
///
/// A parent, a teacher and an admin all change their own photo the same way -- the server
/// decides whose row it is from the bearer token -- so the mutation discipline lives here
/// once and each subclass only says what its initial READ is. See [ParentProfileController]
/// and [OwnAvatarController].
abstract class AvatarNotifier extends AsyncNotifier<ParentProfile> {
  /// The one thing a subclass must say: WHICH read answers "who am I".
  ///
  /// Declared separately from `build` so `refresh` can call it too -- `build` is
  /// for-overriding only and must not be invoked directly.
  Future<ParentProfile> read();

  @override
  Future<ParentProfile> build() => read();

  /// Refetch. Wired to pull-to-refresh and to the retry action on the error state.
  Future<void> refresh() async {
    state = await AsyncValue.guard(read);
  }

  Future<AppError?> setAvatar(PendingAttachment image) =>
      mutate((repo) => repo.setAvatar(image), refreshesIdentity: true);

  Future<AppError?> removeAvatar() =>
      mutate((repo) => repo.removeAvatar(), refreshesIdentity: true);

  /// Run one photo operation, keeping the screen coherent whatever happens.
  ///
  /// Returns null on success and the failure otherwise, so the caller can say something
  /// specific. Nothing here inspects the error: mapping it to words is the screen's job
  /// and the localisation's, not this layer's.
  /// Set for a mutation that changes WHOSE FACE THE SIGNED-IN ACTOR HAS.
  ///
  /// True for the caller's own photo, false for a child's. A child's avatar is not the
  /// signed-in actor's identity, so refreshing after it would be a request that could
  /// change nothing — and the contract says exactly one refresh per own-avatar mutation.
  @protected
  Future<AppError?> mutate(
    Future<ParentProfile> Function(ProfileRepository repo) run, {
    bool refreshesIdentity = false,
  }) async {
    // Deliberately no intermediate AsyncLoading: the screen keeps showing the profile it
    // has while the photo uploads, so the whole page does not blink for one avatar.
    final previous = switch (state) {
      AsyncData(:final value) => value,
      _ => null,
    };

    try {
      final updated = await run(ref.read(profileRepositoryProvider));
      // Local state FIRST: this screen shows what the server last said, and it should
      // show the new photo whether or not the identity read that follows succeeds.
      state = AsyncData(updated);
    } catch (error, stack) {
      // Put the caller back where they were. The photo did not change; the screen should
      // not pretend otherwise, and should not lose the rest of the profile either.
      if (previous != null) {
        state = AsyncData(previous);
      } else {
        state = AsyncError(error, stack);
      }
      return error is AppError ? error : const AppError(AppErrorKind.unknown);
    }

    if (refreshesIdentity) {
      // OUTSIDE the try, deliberately. The auth session holds the identity that Settings,
      // the chat list, message authors and every participant list render, and re-reading
      // it ONCE is what makes a new photo visible there without this feature knowing
      // those screens exist — the same seam the teacher profile already renames through.
      //
      // It sits outside because the photo is ALREADY SAVED by this point. Inside the try,
      // a throw from the refresh would roll the screen back and report failure for a
      // mutation that actually succeeded — which is the one thing this must never do.
      //
      // No retry and no polling: `refreshIdentity` owns what a failure means, ending the
      // session when the error is terminal and otherwise logging and moving on.
      await ref.read(authControllerProvider.notifier).refreshIdentity();
    }
    return null;
  }
}

class ParentProfileController extends AvatarNotifier {
  @override
  Future<ParentProfile> read() => ref.read(profileRepositoryProvider).me();

  // The photo operations on the caller's OWN avatar come from AvatarNotifier. Only the
  // children's photos are specific to a parent, because only a parent has children.

  Future<AppError?> setChildAvatar(String childId, PendingAttachment image) =>
      mutate((repo) => repo.setChildAvatar(childId, image));

  Future<AppError?> removeChildAvatar(String childId) =>
      mutate((repo) => repo.removeChildAvatar(childId));
}

/// The signed-in actor's own name and photo, for an account that is NOT a parent.
///
/// Reads `GET /me/avatar` rather than `/me/profile`: a teacher and an admin have no family
/// and no children, and the parent route rightly refuses them. The mutations are the same
/// ones a parent uses, because the server resolves whose row to write from the bearer
/// token -- so there is no second ownership model here, only a second read.
class OwnAvatarController extends AvatarNotifier {
  @override
  Future<ParentProfile> read() => ref.read(profileRepositoryProvider).myAvatar();
}

/// `autoDispose` because the state carries SHORT-LIVED CREDENTIALS.
///
/// A `ParentProfile` is not inert data: its `avatarUrl` -- and every child's -- is a signed
/// URL minted when the profile was fetched, valid for five minutes. Cached for the life of
/// the session, this provider would keep handing those URLs to `Image.network` long after
/// storage stopped honouring them, and the photos would quietly become initials. That was
/// observed, not theorised: a profile fetched at 19:54:30 was re-rendered at 20:04:47 and
/// both the parent's and the child's reads came back `403 Request has expired` -- 617
/// seconds against a 300-second TTL, from one cached instance, which is why the two failed
/// together.
///
/// Dropping the state when My Account closes means re-entering it refetches and re-signs.
/// The data a screen shows is only as fresh as the credential inside it.
///
/// ## What this does NOT claim to fix
///
/// A screen that STAYS mounted past the TTL and then rebuilds an image can still reach an
/// expired URL. Closing that needs re-signing on demand or a refresh driven by the image
/// failing, and neither is warranted by anything observed. This is a lifetime correction,
/// not an avatar-refresh architecture.
///
/// Matches `conversationProfileProvider`, which is `autoDispose` for exactly this reason.
final parentProfileProvider =
    AsyncNotifierProvider.autoDispose<ParentProfileController, ParentProfile>(
  ParentProfileController.new,
);

/// `autoDispose` for the same reason as [parentProfileProvider]: the state holds a signed
/// URL with a five-minute life, so it must not outlive the screen that showed it.
final ownAvatarProvider =
    AsyncNotifierProvider.autoDispose<OwnAvatarController, ParentProfile>(
  OwnAvatarController.new,
);
