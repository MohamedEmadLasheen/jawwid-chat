import '../../../core/data/wire/wire_mappers.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/models/message.dart';

/// A message pinned for everyone in its conversation.
class PinnedMessage {
  const PinnedMessage({required this.message, required this.pinnedAt});

  final Message message;
  final DateTime pinnedAt;
}

/// One of the viewer's starred messages, with the conversation it is in.
class StarredMessage {
  const StarredMessage({required this.message, required this.conversationId, required this.starredAt});

  final Message message;
  final String conversationId;
  final DateTime starredAt;
}

class StarredPage {
  const StarredPage({this.items = const [], this.nextBefore});

  final List<StarredMessage> items;

  /// Pass back as `before` for the next (older) page; null at the end.
  final String? nextBefore;
}

/// Star (a private bookmark) and pin (shared with everyone in the
/// conversation; anyone who may write there may pin, at most three).
///
/// A separate seam from MessageRepository so a build -- or a test fake --
/// without these routes keeps working and simply offers neither.
abstract interface class MessageMarksRepository {
  bool get isAvailable;

  Future<void> star(String conversationId, String messageId);
  Future<void> unstar(String conversationId, String messageId);
  Future<void> pin(String conversationId, String messageId);
  Future<void> unpin(String conversationId, String messageId);

  /// The conversation's pins this viewer may see, oldest first.
  Future<List<PinnedMessage>> pins(String conversationId);

  /// The viewer's starred messages, newest star first.
  Future<StarredPage> starred({String? before});

  /// Forward messages of [conversationId] into up to ten conversations. The
  /// server checks each source is readable and each destination writable, and
  /// copies media. Returns how many copies were sent.
  Future<int> forward(String conversationId, List<String> messageIds, List<String> toConversationIds);
}

class NoMessageMarksRepository implements MessageMarksRepository {
  const NoMessageMarksRepository();

  @override
  bool get isAvailable => false;
  @override
  Future<void> star(String conversationId, String messageId) async {}
  @override
  Future<void> unstar(String conversationId, String messageId) async {}
  @override
  Future<void> pin(String conversationId, String messageId) async {}
  @override
  Future<void> unpin(String conversationId, String messageId) async {}
  @override
  Future<List<PinnedMessage>> pins(String conversationId) async => const [];
  @override
  Future<StarredPage> starred({String? before}) async => const StarredPage();
  @override
  Future<int> forward(String conversationId, List<String> messageIds, List<String> toConversationIds) async => 0;
}

class HttpMessageMarksRepository implements MessageMarksRepository {
  HttpMessageMarksRepository({required ApiClient client, required String Function() viewerActorId})
      : _client = client,
        _viewerActorId = viewerActorId;

  final ApiClient _client;
  final String Function() _viewerActorId;

  @override
  bool get isAvailable => true;

  String _message(String conversationId, String messageId) =>
      '/conversations/$conversationId/messages/$messageId';

  @override
  Future<void> star(String conversationId, String messageId) =>
      _client.post<Object?>('${_message(conversationId, messageId)}/star');

  @override
  Future<void> unstar(String conversationId, String messageId) =>
      _client.delete<Object?>('${_message(conversationId, messageId)}/star');

  @override
  Future<void> pin(String conversationId, String messageId) =>
      _client.post<Object?>('${_message(conversationId, messageId)}/pin');

  @override
  Future<void> unpin(String conversationId, String messageId) =>
      _client.delete<Object?>('${_message(conversationId, messageId)}/pin');

  @override
  Future<List<PinnedMessage>> pins(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>('/conversations/$conversationId/messages/pins');
    return [
      for (final row in (response.data?['pins'] as List?) ?? const [])
        if (row is Map && row['message'] is Map<String, Object?>)
          PinnedMessage(
            message: WireMappers.message(row['message']! as Map<String, Object?>, viewerActorId: _viewerActorId()),
            pinnedAt: WireMappers.parseTime(row['pinnedAt']) ?? DateTime.now(),
          ),
    ];
  }

  @override
  Future<int> forward(String conversationId, List<String> messageIds, List<String> toConversationIds) async {
    final response = await _client.post<Map<String, Object?>>(
      '/conversations/$conversationId/messages/forward',
      data: {'messageIds': messageIds, 'toConversationIds': toConversationIds},
    );
    return ((response.data?['sent'] as List?) ?? const []).length;
  }

  @override
  Future<StarredPage> starred({String? before}) async {
    final response = await _client.get<Map<String, Object?>>(
      '/me/starred',
      query: before == null ? null : {'before': before},
    );
    final data = response.data ?? const {};
    return StarredPage(
      items: [
        for (final row in (data['items'] as List?) ?? const [])
          if (row is Map && row['message'] is Map<String, Object?> && row['conversationId'] is String)
            StarredMessage(
              message: WireMappers.message(row['message']! as Map<String, Object?>, viewerActorId: _viewerActorId()),
              conversationId: row['conversationId']! as String,
              starredAt: WireMappers.parseTime(row['starredAt']) ?? DateTime.now(),
            ),
      ],
      nextBefore: data['nextBefore'] is String ? data['nextBefore']! as String : null,
    );
  }
}
