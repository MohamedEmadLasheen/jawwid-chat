import 'dart:io';

import '../../../shared/models/message.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';
import '../wire/wire_vocab.dart';
import 'attachment_uploader.dart';

/// `MessageRepository` over the published REST contract.
///
/// Routes consumed (`apps/api/src/communication/api/message.controller.ts`), all under
/// `/conversations/:conversationId/messages`:
///
/// | Method | Path | Response |
/// |---|---|---|
/// | GET | `?before=&after=&limit=` | `{ messages: MessageDto[], nextBefore: string \| null }` |
/// | POST | `` | `MessageDto` |
/// | POST | `/attachments/authorize` | `{ objectKey, uploadUrl, method, headers, expiresAt }` |
/// | POST | `/:messageId/reactions` | `{ ok: true }` |
/// | DELETE | `/:messageId/reactions` | `{ ok: true }` |
///
/// ## Pagination semantics, taken from the service rather than assumed
///
/// `message.service.ts#list` orders **descending** by `seq` when paging backwards, and
/// **ascending** when `after` is supplied. `nextBefore` is non-null only when a full page was
/// returned. So:
///
/// * `before` walks back through history — the "load older" path.
/// * `after` catches up from a watermark — the reconnect path.
///
/// Arrival order does not matter to the app: `MessageLog` re-sorts by `seq`.
class HttpMessageRepository implements MessageRepository {
  HttpMessageRepository({
    required ApiClient client,
    required String Function() viewerActorId,
    AttachmentUploader? uploads,
  })  : _client = client,
        _viewerActorId = viewerActorId,
        _uploads = uploads ?? DioAttachmentUploader();

  final ApiClient _client;

  /// Deliberately NOT [ApiClient].
  ///
  /// The upload URL is signed and self-authorizing, and in production it points
  /// at object storage rather than at this API. Sending it through the
  /// authenticated client would attach the user's bearer token to a request
  /// bound for a third-party host — handing a session credential to storage that
  /// has no business holding one.
  final AttachmentUploader _uploads;

  /// Needed to decide `isMine` and which reactions are the viewer's. Ownership is decided by
  /// actor id, never by role.
  final String Function() _viewerActorId;

  String _base(String conversationId) =>
      '/conversations/$conversationId/messages';

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
      // The server returns a cursor only when a full page came back, so its presence is
      // exactly "there may be more".
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
        // The whole basis of the idempotency guarantee: the same value on every retry, so
        // the server returns the original message rather than creating a second one.
        'clientMessageId': message.clientMessageId,
        'replyToMessageId': ?message.replyToMessageId,
        if (message.attachments.isNotEmpty)
          'attachments': [
            for (final a in message.attachments)
              {
                'kind': _wireType(a.kind),
                'objectKey': a.objectKey,
                'mimeType': a.mimeType,
                'byteSize': a.byteSize,
                'durationMs': ?a.durationMs,
              },
          ],
      },
      // Marks the POST replayable, since it carries an idempotency key (§48).
      options: ApiClient.idempotent(message.clientMessageId),
    );

    final data = response.data;
    // A send must come back with a server id. Without one the message has no identity, and
    // mapping it anyway would put a ghost bubble in the log that can never be reconciled or
    // retried — a silent failure is worse here than a visible one.
    if (data == null || (data['id'] as String?)?.isNotEmpty != true) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_message_response',
        debugDetail: 'send response carried no message id',
      );
    }
    final confirmed = WireMappers.message(data, viewerActorId: _viewerActorId());

    // This is the response to *our* POST, so we know which composed message it is even if
    // the server did not echo `clientMessageId` back. Without this the log would key the
    // confirmation by its server id, fail to match the local echo, and show the message
    // twice.
    return confirmed.clientMessageId == message.clientMessageId
        ? confirmed
        : confirmed.withClientMessageId(message.clientMessageId);
  }

  @override
  Future<UploadedAttachment> uploadVoiceNote({
    required String conversationId,
    required PendingVoiceNote note,
  }) async {
    // 1. Authorize. The backend re-checks conversation membership and enforces
    //    the MIME and size limits here, so an over-limit note is refused before
    //    the user spends a single byte of mobile data on it.
    final authorized = await _client.post<Map<String, Object?>>(
      '${_base(conversationId)}/attachments/authorize',
      data: {
        'kind': Wire.messageVoice,
        'mimeType': note.mimeType,
        'byteSize': note.byteSize,
      },
    );

    final grant = authorized.data;
    final objectKey = grant?['objectKey'] as String?;
    final uploadUrl = grant?['uploadUrl'] as String?;
    if (objectKey == null || uploadUrl == null) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_upload_authorization',
        debugDetail: 'authorize response carried no objectKey or uploadUrl',
      );
    }

    final bytes = await File(note.filePath).readAsBytes();
    // The authorization bound the size it signed for. Sending a different length
    // would be refused by storage, so fail here with something diagnosable
    // rather than as an opaque 403.
    if (bytes.length != note.byteSize) {
      throw const AppError(
        AppErrorKind.server,
        code: 'voice_note_size_changed',
        debugDetail: 'the recording changed size between authorization and upload',
      );
    }

    // 2. PUT the bytes to the signed URL.
    await _uploads.put(
      uploadUrl,
      bytes: bytes,
      headers: _stringHeaders(grant?['headers']),
    );

    // 3. The caller sends the message with this reference.
    return UploadedAttachment(
      kind: MessageKind.voice,
      objectKey: objectKey,
      mimeType: note.mimeType,
      byteSize: note.byteSize,
      durationMs: note.duration.inMilliseconds,
    );
  }

  /// The headers the authorization told us to send — chiefly the content type,
  /// which storage signed and therefore verifies.
  static Map<String, String> _stringHeaders(Object? raw) {
    final out = <String, String>{};
    if (raw is! Map) return out;
    raw.forEach((key, value) {
      if (key is String && value is String) out[key] = value;
    });
    return out;
  }

  @override
  Future<void> react(String messageId, String emoji) async {
    // Reactions are per conversation on the wire, but the route only needs the message id
    // under a conversation prefix; the server re-resolves membership from the message.
    await _client.post<Map<String, Object?>>(
      '/messages/$messageId/reactions',
      data: {'emoji': emoji},
    );
  }

  @override
  Future<void> removeReaction(String messageId, String emoji) async {
    await _client.delete<Map<String, Object?>>('/messages/$messageId/reactions');
  }

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {
    // Typing is a realtime-gateway concern, not a REST route, and the gateway is not
    // reachable yet. Silently doing nothing is correct here: a missing typing indicator is
    // cosmetic, and throwing would surface an error for something the user did not ask for.
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
