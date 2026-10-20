import '../../../core/data/wire/wire_mappers.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/models/message.dart';

/// One page of matches inside a chat, newest first.
class MessageSearchPage {
  const MessageSearchPage({this.hits = const [], this.nextBefore});

  final List<Message> hits;

  /// Pass back as `before` for older matches; null when there are none.
  final String? nextBefore;
}

/// A match across chats: the message and the chat it is in.
class MessageSearchHit {
  const MessageSearchHit({required this.conversationId, required this.message});

  final String conversationId;
  final Message message;
}

/// Message search (owner decision 2026-10-20): inside one chat, and across all
/// of the viewer's chats. The server decides what matches and answers only
/// from messages this viewer may read.
///
/// A separate seam, like [MessageMarksRepository], so a build -- or a test
/// fake -- without the routes keeps working and simply offers no search.
abstract interface class MessageSearchRepository {
  bool get isAvailable;

  Future<MessageSearchPage> searchIn(String conversationId, String query, {String? before});

  Future<List<MessageSearchHit>> searchAll(String query);
}

class NoMessageSearchRepository implements MessageSearchRepository {
  const NoMessageSearchRepository();

  @override
  bool get isAvailable => false;
  @override
  Future<MessageSearchPage> searchIn(String conversationId, String query, {String? before}) async =>
      const MessageSearchPage();
  @override
  Future<List<MessageSearchHit>> searchAll(String query) async => const [];
}

class HttpMessageSearchRepository implements MessageSearchRepository {
  HttpMessageSearchRepository({required ApiClient client, required String Function() viewerActorId})
      : _client = client,
        _viewerActorId = viewerActorId;

  final ApiClient _client;
  final String Function() _viewerActorId;

  @override
  bool get isAvailable => true;

  @override
  Future<MessageSearchPage> searchIn(String conversationId, String query, {String? before}) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/messages/search',
      query: {'q': query, 'before': ?before},
    );
    final data = response.data ?? const {};
    return MessageSearchPage(
      hits: [
        for (final row in (data['hits'] as List?) ?? const [])
          if (row is Map<String, Object?>) WireMappers.message(row, viewerActorId: _viewerActorId()),
      ],
      nextBefore: data['nextBefore'] is String ? data['nextBefore']! as String : null,
    );
  }

  @override
  Future<List<MessageSearchHit>> searchAll(String query) async {
    final response = await _client.get<Map<String, Object?>>('/me/search', query: {'q': query});
    return [
      for (final row in (response.data?['hits'] as List?) ?? const [])
        if (row is Map && row['message'] is Map<String, Object?> && row['conversationId'] is String)
          MessageSearchHit(
            conversationId: row['conversationId']! as String,
            message: WireMappers.message(row['message']! as Map<String, Object?>, viewerActorId: _viewerActorId()),
          ),
    ];
  }
}
