import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_phase5.dart';

/// `StoryRepository` over `/stories`.
///
/// Note what this class cannot express: there is no method that takes a list of
/// recipients, and no method that fetches stories the caller is not in the
/// audience of. `feed()` is already the reader's own feed -- the server filters
/// it -- so there is no unfiltered variant to reach for by mistake and no
/// client-side filtering to get wrong.
class HttpStoryRepository implements StoryRepository {
  HttpStoryRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<Story>> feed() async {
    final response = await _client.get<Map<String, Object?>>('/stories/feed');
    return _stories(response.data);
  }

  @override
  Future<void> markViewed(String storyId) async {
    await _client.post<Map<String, Object?>>('/stories/$storyId/view');
  }

  List<Story> _stories(Map<String, Object?>? data) => [
        for (final row in (data?['stories'] as List?) ?? const [])
          if (row is Map<String, Object?>) WirePhase5.story(row),
      ];
}
