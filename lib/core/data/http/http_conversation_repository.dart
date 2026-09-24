import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `ConversationRepository` over the published REST contract.
///
/// Routes consumed (`apps/api/src/communication/api/conversation.controller.ts`):
///
/// | Method | Path | Response |
/// |---|---|---|
/// | GET | `/conversations` | `{ conversations: ConversationDto[] }` |
/// | GET | `/conversations/:id` | `ConversationDto` |
/// | POST | `/conversations/:id/preferences` | `{ ok: true }` |
///
/// Nothing here invents an endpoint. Where the contract has no route for something the app
/// needs — search, and the display names behind a conversation title — the method says so
/// rather than approximating it locally.
///
/// `ConversationDto` now carries the learner and the caller's unread count, so
/// the chat list's child sections and its badges come from the server. Neither
/// is derived here: see `WireMappers.conversation`.
class HttpConversationRepository implements ConversationRepository {
  HttpConversationRepository({
    required ApiClient client,
    required UserRole Function() viewerRole,
  })  : _client = client,
        _viewerRole = viewerRole;

  final ApiClient _client;

  /// The signed-in role, read per call. Approval policy is per role, so the same DTO maps
  /// differently for a parent and a teacher (§26).
  final UserRole Function() _viewerRole;

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async {
    final response = await _client.get<Map<String, Object?>>('/conversations');
    final rows = (response.data?['conversations'] as List?) ?? const [];

    final conversations = <Conversation>[];
    for (final row in rows) {
      if (row is! Map<String, Object?>) continue;
      conversations.add(
        WireMappers.conversation(row, viewerRole: _viewerRole()),
      );
    }

    // The server has no `includeArchived` parameter, so the filter is applied here. This is
    // presentation, not authorization — the server already decided which conversations this
    // actor may see at all.
    if (includeArchived) return conversations;
    return conversations.where((c) => !c.isArchived).toList(growable: false);
  }

  @override
  Future<Conversation> byId(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId',
    );
    final data = response.data;
    if (data == null || (data['id'] as String?)?.isNotEmpty != true) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_conversation_response',
        debugDetail: 'conversation response carried no id',
      );
    }
    return WireMappers.conversation(data, viewerRole: _viewerRole());
  }

  @override
  Future<void> setPinned(String conversationId, bool pinned) =>
      _preferences(conversationId, {'pinned': pinned});

  @override
  Future<void> setArchived(String conversationId, bool archived) =>
      _preferences(conversationId, {'archived': archived});

  @override
  Future<void> setMuted(String conversationId, bool muted) {
    // The contract models muting as an expiry (`mutedUntil`), not a boolean: null unmutes.
    // A far-future timestamp is the contract's own way of expressing an indefinite mute,
    // and it keeps the client from inventing a second representation.
    final until = muted
        ? DateTime.now().toUtc().add(const Duration(days: 3650)).toIso8601String()
        : null;
    return _preferences(conversationId, {'mutedUntil': until});
  }

  @override
  Future<void> markRead(
    String conversationId, {
    required int throughSequence,
  }) async {
    // `upToSeq` is a string on the wire: seq is 64-bit and JSON numbers are not safe at that
    // width, so it must not be sent as a number.
    await _client.post<Map<String, Object?>>(
      '/conversations/$conversationId/messages/read',
      data: {'upToSeq': throughSequence.toString()},
    );
  }

  /// Per-conversation unread count.
  ///
  /// `GET /conversations/:id/messages/unread`. Deliberately **not** called from [list]: doing
  /// so would be one round trip per row, which is the cost the low-end/slow-network target
  /// cannot absorb. Recorded as O1 in `docs/mobile/backend-dependencies.md` — the count
  /// belongs on `ConversationDto`.
  Future<int> unreadCount(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/messages/unread',
    );
    return (response.data?['unread'] as num?)?.toInt() ?? 0;
  }

  @override
  Future<List<Conversation>> search(String query) async {
    // The contract has no search route. Filtering the already-fetched list locally would
    // look like search while silently only covering what happens to be cached, so this
    // fails honestly instead. Recorded as a backend dependency.
    throw const AppError(
      AppErrorKind.notFound,
      code: 'search_not_supported',
      debugDetail: 'No search endpoint exists in the published contract.',
    );
  }

  Future<void> _preferences(
    String conversationId,
    Map<String, Object?> body,
  ) async {
    await _client.post<Map<String, Object?>>(
      '/conversations/$conversationId/preferences',
      data: body,
    );
  }
}
