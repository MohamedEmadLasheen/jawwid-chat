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
/// * **Stories.** A non-empty list. The rail renders.
/// * **No stories.** An empty list. A real answer; the rail renders nothing and takes no
///   space (§the rail must not become a row of grey circles announcing an absence).
/// * **Not available.** No [StoryRepository] is registered — the development composition root
///   provides none, because there is no fake story backend. Reading the provider throws
///   [UnimplementedError], which is caught here and turned into a specific error rather than
///   an empty list that would read as "the academy has published nothing".
///
/// The rail treats the last two identically on screen, and that is fine: what matters is that
/// the code does not confuse them, so a missing wiring cannot masquerade as a quiet academy.
class StoriesController extends AsyncNotifier<List<Story>> {
  @override
  Future<List<Story>> build() => _load();

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
    // controller keeps them apart; the rail does not need to.
    _ => const <Story>[],
  };
  final ordered = [...stories]..sort((a, b) {
      if (a.isViewed != b.isViewed) return a.isViewed ? 1 : -1;
      return b.publishedAt.compareTo(a.publishedAt);
    });
  return ordered;
});
