import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/data/wire/wire_vocab.dart';
import '../../../core/errors/app_error.dart';
import '../../../shared/models/story.dart';

/// The code this controller reports when no story backend is registered in this build.
///
/// Distinct from "you have no stories", which is an empty list and a perfectly normal
/// answer. Mirrors `callsNotAvailableCode` — the same distinction the Calls tab draws.
const storiesNotAvailableCode = 'stories_not_available';

/// The reader's story feed.
///
/// ## What this is authoritative about: nothing
///
/// The server decides which stories exist for this actor, whether they are still live, and
/// whether a view may be recorded. This controller holds the answer and re-asks; it never
/// second-guesses. There is no client-side audience filter here, because the feed is already
/// a join through the caller's own recipient rows — a filter would be a weaker second copy of
/// a decision already made correctly.
///
/// ## Three outcomes, deliberately distinguished
///
/// * **Stories.** A non-empty list. The rail renders rings.
/// * **No stories.** An empty list. A real answer, and since the rail now SAYS so rather than
///   disappearing, the distinction below finally matters on screen as well as in the code.
/// * **Not available.** No [StoryRepository] is registered — the development composition root
///   provides none, because there is no fake story backend. Reading the provider throws
///   [UnimplementedError], which is caught here and turned into a specific error rather than
///   an empty list that would read as "the academy has published nothing".
///
/// The rail renders the last two DIFFERENTLY ([StoryRailDisplay]): an established absence
/// earns a line saying so, an unknown one stays silent. Keeping them apart here is what makes
/// that possible, and is why a missing wiring cannot masquerade as a quiet academy.
class StoriesController extends AsyncNotifier<List<Story>>
    with SessionScoped<List<Story>> {
  @override
  List<Story> get sessionEmptyValue => const [];

  @override
  Future<List<Story>> build() {
    // THE SESSION BOUNDARY: a feed belongs to the person it was resolved for, so a change of
    // principal must take it with it rather than leave it on screen. See `bindToSession`.
    bindToSession();
    return _load();
  }

  Future<List<Story>> _load() async {
    final StoryRepository repository;
    try {
      repository = ref.read(storyRepositoryProvider);
    } catch (error) {
      // Riverpod wraps whatever a provider's create function throws, so the
      // UnimplementedError arrives one layer down. Unwrap before deciding.
      final cause = error is ProviderException ? error.exception : error;
      if (cause is! UnimplementedError) rethrow;

      throw const AppError(
        AppErrorKind.notFound,
        code: storiesNotAvailableCode,
        debugDetail: 'No StoryRepository is registered in this build.',
      );
    }

    return repository.feed();
  }

  /// Refetch. Wired to the Chats screen's existing pull-to-refresh, so stories and
  /// conversations come back together and the rail needs no refresh affordance of its own.
  Future<void> refresh() async {
    // No intermediate AsyncLoading: the rail keeps showing what it has until the new answer
    // arrives, so a pull-to-refresh does not make the rings vanish and reappear. Matches
    // ConversationsController.refresh, and the RefreshIndicator already shows the spinner.
    state = await AsyncValue.guard(_load);
  }

  /// Record that the reader opened this story.
  ///
  /// The optimistic update is the point: the ring must stop looking unread the moment the
  /// reader opens it, not after a round trip. The server is still the source of truth, and
  /// the next [refresh] replaces this with whatever it says.
  ///
  /// Returns the failure when the story has gone — expired, deleted, or never theirs — so the
  /// viewer can leave it and refetch. Any other failure returns null: a view that did not
  /// record is not worth interrupting a reader for, and the story is still perfectly
  /// readable.
  Future<AppError?> markViewed(String storyId) async {
    final current = switch (state) {
      AsyncData(:final value) => value,
      _ => null,
    };
    if (current != null) {
      state = AsyncData(
        current
            .map((s) => s.id == storyId ? s.copyWith(isViewed: true) : s)
            .toList(growable: false),
      );
    }

    try {
      final repository = ref.read(storyRepositoryProvider);
      await repository.markViewed(storyId);
      return null;
    } catch (error) {
      final mapped = error is AppError ? error : null;
      if (mapped != null && WireErrors.storyGone.contains(mapped.code)) {
        return mapped;
      }
      // Deliberately swallowed. The reader is looking at the story; telling them the
      // bookkeeping failed would be noise, and the next refresh reconciles it.
      return null;
    }
  }
}

final storiesControllerProvider =
    AsyncNotifierProvider<StoriesController, List<Story>>(StoriesController.new);

/// The rail's stories, ordered the way a rail is worth swiping: unviewed first, then newest.
///
/// A derived provider rather than sorting inside the widget, so the order is testable on its
/// own and the widget has no opinion about it.
final storyRailOrderProvider = Provider<List<Story>>((ref) {
  final stories = switch (ref.watch(storiesControllerProvider)) {
    AsyncData(:final value) => value,
    // Loading, unavailable and failed all reach the rail as "nothing to show". The
    // controller keeps them apart; see [storyRailDisplayProvider] for which of them earns
    // an empty state and which stays absent.
    _ => const <Story>[],
  };
  final ordered = [...stories]..sort((a, b) {
      if (a.isViewed != b.isViewed) return a.isViewed ? 1 : -1;
      return b.publishedAt.compareTo(a.publishedAt);
    });
  return ordered;
});

/// What the rail should put on screen.
///
/// The controller has always distinguished "no stories" from "no story backend"; until now
/// the rail collapsed both to nothing, and that is precisely why an ordinary 24-hour expiry
/// read to users as the Stories feature having been removed from the app.
enum StoryRailDisplay {
  /// At least one live story. Rings.
  stories,

  /// A real, successful answer that contained nothing. The rail says so, quietly, so the
  /// feature stays visibly part of the app between publications.
  empty,

  /// Nothing may be claimed. Three cases, all of which must stay silent:
  ///
  ///   * **loading** — saying "no stories yet" before the answer arrives would be a guess,
  ///     and it would flicker into rings a moment later.
  ///   * **unavailable** — no [StoryRepository] is registered in this build. "No stories
  ///     yet" would describe a quiet academy; the truth is a build without the feature.
  ///   * **failed** — the request did not complete, so whether stories exist is unknown.
  ///     Announcing an absence we did not establish is the one thing this feature must not
  ///     do. Retry is the screen's pull-to-refresh, as it has always been.
  hidden,
}

/// Which of the three the rail is in.
final storyRailDisplayProvider = Provider<StoryRailDisplay>((ref) {
  return switch (ref.watch(storiesControllerProvider)) {
    AsyncData(:final value) =>
      value.isEmpty ? StoryRailDisplay.empty : StoryRailDisplay.stories,
    _ => StoryRailDisplay.hidden,
  };
});
