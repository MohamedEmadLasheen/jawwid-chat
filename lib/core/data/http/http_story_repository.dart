import '../../../shared/models/story.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `StoryRepository` over the published REST contract.
///
/// Routes consumed (`apps/api/src/communication/api/story.controller.ts`):
///
/// | Method | Path | Response |
/// |---|---|---|
/// | GET | `/stories/feed` | `{ stories: StoryFeedItem[] }` |
/// | POST | `/stories/:id/view` | `{ ok: true }` |
/// | POST | `/stories/:id/cta` | `{ kind, url, conversationId }` |
///
/// Those three are the whole read surface, and nothing here reaches for the others. `GET
/// /stories` is the publisher's list, `GET /stories/:id/viewers` is publisher-only, and
/// `POST /stories`, `/publish`, `/media` and `DELETE` are all publishing — none of which this
/// client may do. Calling any of them would return a permission error, so none is wrapped.
///
/// ## What this does not do
///
/// It does not filter. The feed is already scoped to the caller's own resolved audience and
/// already excludes expired and deleted stories, server-side, on every request. A `where`
/// clause here would be a second, weaker copy of an authorization decision that has already
/// been made correctly.
///
/// It does not touch storage. `mediaUrl` arrives signed and short-lived and is passed
/// through untouched; there is no bucket name, no key and no path construction anywhere in
/// this client.
class HttpStoryRepository implements StoryRepository {
  HttpStoryRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<Story>> feed() async {
    final response = await _client.get<Map<String, Object?>>('/stories/feed');
    final rows = (response.data?['stories'] as List?) ?? const [];

    final stories = <Story>[];
    for (final row in rows) {
      if (row is! Map<String, Object?>) continue;
      final story = WireMappers.story(row);
      // A row with no id or publication time is dropped. A row with no expiry is NOT: that
      // is a story that does not expire.
      if (story != null) stories.add(story);
    }
    return stories;
  }

  @override
  Future<void> markViewed(String storyId) async {
    // Not marked idempotent at the transport layer, and deliberately so. `ApiClient` replays
    // an idempotent POST automatically, and a view is already idempotent ON THE SERVER by
    // composite primary key -- so an automatic replay would add nothing but a second request
    // on a flaky network. A failed view is recoverable by the reader simply being there; it
    // is never worth a retry storm.
    await _client.post<Map<String, Object?>>('/stories/$storyId/view');
  }

  @override
  Future<StoryCtaTap> tapCta(String storyId) async {
    // Not idempotent, deliberately: every tap is a tap, and the transport must not replay one.
    final response = await _client.post<Map<String, Object?>>('/stories/$storyId/cta');
    final tap = WireMappers.storyCtaTap(response.data ?? const {});
    if (tap == null) {
      throw StateError('POST /stories/$storyId/cta answered without a known kind');
    }
    return tap;
  }
}
