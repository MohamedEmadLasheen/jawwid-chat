import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/conversation.dart';

/// Opening the 1:1 channel with one other person.
///
/// A one-shot action, not a screen's state, so it holds the smallest thing that
/// makes the action safe: whether a request is already in flight.
///
/// ## Why the in-flight guard is here and not in the widget
///
/// Two taps on the same row is the ordinary case, not the edge case — the row
/// does not visibly change the instant it is pressed, because the result is a
/// navigation that happens after a round trip on a slow network. A guard in the
/// widget would have to be re-implemented at every call site and would be lost
/// the moment the row is rebuilt. Here it is one place and it survives rebuilds.
///
/// The server is idempotent regardless (`conversation.direct_key` is unique), so
/// a lost guard would produce a duplicate *request*, never a duplicate
/// conversation. This keeps the request from happening at all, which is what the
/// user's data plan cares about.
///
/// ## What this does not decide
///
/// Whether the two actors may share a channel. That is
/// `AuthorizationService.canOpenDirect`, server-side, evaluated per action —
/// PD-6 resolves a Teacher↔Parent pairing from the live teaching relationship,
/// which no client can know. A refusal arrives as a typed [AppError] and is
/// surfaced with its own message; it is never retried, and it is never guessed
/// at in advance. `CommunicationPolicy` decides only whether to *offer* the
/// action, which is a narrower and purely cosmetic question.
class OpenDirectController extends Notifier<OpenDirectState> {
  @override
  OpenDirectState build() => const OpenDirectState.idle();

  /// Opens (or resolves) the channel with [withActorId].
  ///
  /// Returns the conversation on success and null on failure or when a request
  /// is already in flight. The failure itself is on [state], so a caller that
  /// wants to show it does not have to catch anything.
  Future<Conversation?> open(String withActorId) async {
    if (state.isInFlight) return null;

    state = OpenDirectState.opening(withActorId);

    try {
      final conversation =
          await ref.read(conversationRepositoryProvider).openDirect(withActorId);
      state = const OpenDirectState.idle();
      return conversation;
    } catch (error) {
      // Mapped, never raw: a DioException reaching a widget would be rendered by
      // ErrorPresenter as `unknown`, which is how a forbidden pairing turns into
      // "something went wrong".
      state = OpenDirectState.failed(ErrorMapper.map(error));
      return null;
    }
  }

  /// Clears a failure once it has been shown, so it is not shown twice.
  void acknowledge() {
    if (state.failure != null) state = const OpenDirectState.idle();
  }
}

/// Idle, opening one specific channel, or failed.
class OpenDirectState {
  const OpenDirectState.idle() : openingWith = null, failure = null;
  const OpenDirectState.opening(String this.openingWith) : failure = null;
  const OpenDirectState.failed(AppError this.failure) : openingWith = null;

  /// The actor whose channel is being opened. Names *which* row is busy, so one
  /// spinner cannot appear on every row at once.
  final String? openingWith;

  final AppError? failure;

  bool get isInFlight => openingWith != null;

  bool isOpening(String actorId) => openingWith == actorId;
}

final openDirectControllerProvider =
    NotifierProvider<OpenDirectController, OpenDirectState>(
  OpenDirectController.new,
);
