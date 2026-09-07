import '../../../shared/models/message.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `MessageRepository` over the published REST contract.
///
/// Routes consumed (`apps/api/src/communication/api/message.controller.ts`),
/// all under `/conversations/:conversationId/messages`:
///
/// | Method | Path | Response |
/// |---|---|---|
/// | GET | `?before=&after=&limit=` | `{ messages: MessageDto[], nextBefore }` |
/// | GET | `/search?q=&authorId=&from=&to=` | `{ hits, nextCursor }` |
/// | POST | `` | `MessageDto` |
/// | PATCH | `/:messageId` | `MessageDto` |
/// | POST | `/:messageId/forward` | `{ messages: MessageDto[] }` |
/// | POST | `/:messageId/delivered` | `{ updated }` |
/// | POST/DELETE | `/:messageId/reactions` | `{ ok: true }` |
/// | DELETE | `/:messageId/me` | `{ ok: true }` |
/// | DELETE | `/:messageId?reason=` | `{ ok: true }` |
///
/// ## Pagination semantics, taken from the service rather than assumed
///
/// `message.service.ts#list` orders **descending** by `seq` when paging
/// backwards, and **ascending** when `after` is supplied. `nextBefore` is
/// non-null only when a full page was returned. So:
///
/// * `before` walks back through history — the "load older" path.
/// * `after` catches up from a watermark — the reconnect path.
///
/// Arrival order does not matter to the app: `MessageLog` re-sorts by `seq`.
///
/// ## Every message route names its conversation
///
/// Even the ones that only need a message id. The server asserts the message
/// really is in that conversation and reports NOT FOUND otherwise, so a client
/// that got the pairing wrong finds out rather than silently acting on a
/// message in another thread.
class HttpMessageRepository implements MessageRepository {
  HttpMessageRepository({
    required ApiClient client,
    required String Function() viewerActorId,
  })  : _client = client,
        _viewerActorId = viewerActorId;

  final ApiClient _client;

  /// Needed to decide `isMine` and which reactions are the viewer's. Ownership
  /// is decided by actor id, never by role.
  final String Function() _viewerActorId;

  String _base(String conversationId) => '/conversations/$conversationId/messages';

  @override
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  }) async {
    final response = await _client.get<Map<String, Object?>>(
      _base(conversationId),
      query: {'before': ?beforeCursor, 'limit': '$limit'},
    );

    final messages = _parseMessages(response.data?['messages']);
    final nextBefore = response.data?['nextBefore'] as String?;

    return Page(
      items: messages,
      nextCursor: nextBefore,
      // The server returns a cursor only when a full page came back, so its
      // presence is exactly "there may be more".
      hasMore: nextBefore != null,
    );
  }

  @override
  Future<List<Message>> since(
    String conversationId, {
    required int afterSequence,
  }) async {
    final response = await _client.get<Map<String, Object?>>(
      _base(conversationId),
      // Stringified: seq is 64-bit and must not cross the wire as a JSON number.
      query: {'after': afterSequence.toString()},
    );
    return _parseMessages(response.data?['messages']);
  }

  @override
  Future<Message> send(OutgoingMessage message) async {
    final response = await _client.post<Map<String, Object?>>(
      _base(message.conversationId),
      data: {
        'type': _wireType(message.kind),
        'body': message.body,
        // The whole basis of the idempotency guarantee: the same value on every
        // retry, so the server returns the original message rather than
        // creating a second one.
        'clientMessageId': message.clientMessageId,
        'replyToMessageId': ?message.replyToMessageId,
      },
      // Marks the POST replayable, since it carries an idempotency key (§48).
      options: ApiClient.idempotent(message.clientMessageId),
    );

    final data = response.data;
    // A send must come back with a server id. Without one the message has no
    // identity, and mapping it anyway would put a ghost bubble in the log that
    // can never be reconciled or retried — a silent failure is worse here than
    // a visible one.
    if (data == null || (data['id'] as String?)?.isNotEmpty != true) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_message_response',
        debugDetail: 'send response carried no message id',
      );
    }
    final confirmed = WireMappers.message(data, viewerActorId: _viewerActorId());

    // This is the response to *our* POST, so we know which composed message it
    // is even if the server did not echo `clientMessageId` back. Without this
    // the log would key the confirmation by its server id, fail to match the
    // local echo, and show the message twice.
    return confirmed.clientMessageId == message.clientMessageId
        ? confirmed
        : confirmed.withClientMessageId(message.clientMessageId);
  }

  @override
  Future<Message> edit({
    required String conversationId,
    required String messageId,
    required String body,
  }) async {
    final response = await _client.patch<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId',
      data: {'body': body},
    );
    final data = response.data;
    if (data == null || (data['id'] as String?)?.isNotEmpty != true) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_message_response',
        debugDetail: 'edit response carried no message id',
      );
    }
    return WireMappers.message(data, viewerActorId: _viewerActorId());
  }

  @override
  Future<void> deleteForMe({
    required String conversationId,
    required String messageId,
  }) async {
    await _client.delete<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId/me',
    );
  }

  @override
  Future<void> deleteForEveryone({
    required String conversationId,
    required String messageId,
    required String reason,
  }) async {
    await _client.delete<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId',
      query: {'reason': reason},
    );
  }

  @override
  Future<List<Message>> forward({
    required String conversationId,
    required String messageId,
    required List<String> toConversationIds,
  }) async {
    final response = await _client.post<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId/forward',
      data: {'toConversationIds': toConversationIds},
    );
    return _parseMessages(response.data?['messages']);
  }

  @override
  Future<void> react(String conversationId, String messageId, String emoji) async {
    await _client.post<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId/reactions',
      data: {'emoji': emoji},
    );
  }

  @override
  Future<void> removeReaction(String conversationId, String messageId) async {
    await _client.delete<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId/reactions',
    );
  }

  @override
  Future<void> markDelivered({
    required String conversationId,
    required String messageId,
  }) async {
    // The HTTP fallback. When a socket is up the acknowledgement rides on it
    // instead, which is cheaper and needs no round trip per message.
    await _client.post<Map<String, Object?>>(
      '${_base(conversationId)}/$messageId/delivered',
    );
  }

  @override
  Future<List<MessageSearchHit>> search(MessageSearchQuery query) async {
    if (query.isEmpty) return const [];

    final params = <String, Object?>{
      'q': query.text.trim(),
      'authorId': ?query.authorId,
      'from': ?query.from?.toUtc().toIso8601String(),
      'to': ?query.to?.toUtc().toIso8601String(),
    };

    // Scoped to one conversation, or across every conversation this actor may
    // read. Both are authorized server-side; neither is a directory.
    final response = query.conversationId == null
        ? await _client.get<Map<String, Object?>>('/search/messages', query: params)
        : await _client.get<Map<String, Object?>>(
            '${_base(query.conversationId!)}/search',
            query: params,
          );

    final rows = (response.data?['hits'] as List?) ?? const [];
    final viewer = _viewerActorId();

    return [
      for (final row in rows)
        if (row is Map<String, Object?> && row['message'] is Map<String, Object?>)
          MessageSearchHit(
            message: WireMappers.message(
              row['message']! as Map<String, Object?>,
              viewerActorId: viewer,
            ),
            conversationId: (row['conversationId'] as String?) ?? '',
            conversationTitle: (row['conversationTitle'] as String?) ?? '',
          ),
    ];
  }

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {
    // Typing is a realtime-gateway concern and has no REST route by design: a
    // transient indicator is not a business record, and giving it an endpoint
    // would invite persisting it. `RealtimeMessagingService` sends the socket
    // frame; when there is no socket there is simply no indicator, which is
    // cosmetic and must not surface as an error the user did not ask for.
  }

  List<Message> _parseMessages(Object? raw) {
    final rows = (raw as List?) ?? const [];
    final viewer = _viewerActorId();

    final messages = <Message>[];
    for (final row in rows) {
      // A single malformed row must not blank the conversation.
      if (row is! Map<String, Object?>) continue;
      messages.add(WireMappers.message(row, viewerActorId: viewer));
    }
    return messages;
  }

  static String _wireType(MessageKind kind) => switch (kind) {
        MessageKind.image => 'image',
        MessageKind.video => 'video',
        MessageKind.voice => 'voice',
        MessageKind.file => 'file',
        MessageKind.system => 'system',
        MessageKind.text => 'text',
      };
}
