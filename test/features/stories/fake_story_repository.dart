import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/shared/models/story.dart';

/// A [StoryRepository] standing in for the network, and nothing more.
///
/// This is the only fake in the Stories feature and it lives in `test/`, never in `lib/`: the
/// app has no fake story backend, because a fixture story is indistinguishable on screen from
/// a real publication and the whole contract of the feature is that what a reader sees was
/// genuinely published to them.
///
/// It fakes the transport. It does not reimplement the server: there is no audience
/// resolution here, no expiry filtering, no view authorization. Those are the server's, are
/// tested against a real database in `apps/api/test/integration/stories*.spec.ts`, and a
/// second copy here would only be able to agree with itself.
class FakeStoryRepository implements StoryRepository {
  FakeStoryRepository({
    List<Story> stories = const [],
    this.feedError,
    this.viewError,
    this.feedDelay = Duration.zero,
  }) : _stories = [...stories];

  List<Story> _stories;

  /// Thrown by [feed] when set, to exercise the failure path.
  AppError? feedError;

  /// Thrown by [markViewed] when set. Typed as Object so a test can also throw something
  /// that is NOT an AppError -- the viewer must survive an unclassified failure too.
  Object? viewError;

  /// Held for this long before [feed] answers, so a test can observe the loading frame.
  /// Without it the future completes inside the first `pump` and loading is unobservable.
  Duration feedDelay;

  /// Every id [markViewed] was called with, in order — duplicates included, so a test can
  /// prove the client does not re-post a view it already recorded.
  final List<String> viewed = [];

  int feedCalls = 0;

  /// Replace what the next [feed] returns, standing in for a story expiring or being removed
  /// between one fetch and the next.
  void setStories(List<Story> stories) => _stories = [...stories];

  @override
  Future<List<Story>> feed() async {
    feedCalls += 1;
    if (feedDelay > Duration.zero) await Future<void>.delayed(feedDelay);
    final error = feedError;
    if (error != null) throw error;
    return List.unmodifiable(_stories);
  }

  @override
  Future<void> markViewed(String storyId) async {
    viewed.add(storyId);
    final error = viewError;
    if (error != null) throw error;
  }
}

/// A story with sensible defaults, so each test states only what it is about.
Story story({
  String id = 'story-1',
  String? title = 'Term starts Sunday',
  String? body = 'Classes resume this Sunday.',
  StoryMediaKind? mediaKind,
  String? mediaUrl,
  DateTime? publishedAt,
  DateTime? expiresAt,
  bool isViewed = false,
}) {
  final now = DateTime.now();
  return Story(
    id: id,
    title: title,
    body: body,
    mediaKind: mediaKind,
    mediaUrl: mediaUrl,
    publishedAt: publishedAt ?? now.subtract(const Duration(hours: 1)),
    expiresAt: expiresAt ?? now.add(const Duration(hours: 23)),
    isViewed: isViewed,
  );
}

/// The error the server returns for a story that is over.
AppError storyGoneError([String code = WireErrors.storyExpired]) =>
    AppError(AppErrorKind.notFound, code: code);
