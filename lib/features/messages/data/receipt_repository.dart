import '../../../core/data/wire/wire_mappers.dart';
import '../../../core/network/api_client.dart';

/// PD-37: one person in Message info.
class MessageInfoEntry {
  const MessageInfoEntry({required this.actorId, required this.displayName, this.avatarUrl, this.at});

  final String actorId;
  final String displayName;
  final String? avatarUrl;

  /// When they read it (read by), when it reached them (delivered to); null while pending.
  final DateTime? at;
}

/// PD-37: who read a message, who has it, who does not yet -- seated members
/// only, as the server answers it. Asked only for one's own message: the server
/// answers the author (and staff) and refuses everyone else.
class MessageInfo {
  const MessageInfo({this.readBy = const [], this.deliveredTo = const [], this.pending = const []});

  final List<MessageInfoEntry> readBy;
  final List<MessageInfoEntry> deliveredTo;
  final List<MessageInfoEntry> pending;
}

/// PD-37: read receipts beyond the message page -- Message info, and the
/// delivery cursor ("this device has the conversation up to seq N").
abstract interface class ReceiptRepository {
  bool get isAvailable;

  Future<MessageInfo> info(String conversationId, String messageId);

  /// Forward-only on the server; a late or repeated one changes nothing.
  Future<void> delivered(String conversationId, int upToSeq);
}

/// A harmless default: a build without the routes offers no Message info and
/// reports no delivery.
class NoReceiptRepository implements ReceiptRepository {
  const NoReceiptRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<MessageInfo> info(String conversationId, String messageId) async => const MessageInfo();

  @override
  Future<void> delivered(String conversationId, int upToSeq) async {}
}

class HttpReceiptRepository implements ReceiptRepository {
  HttpReceiptRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  bool get isAvailable => true;

  @override
  Future<void> delivered(String conversationId, int upToSeq) =>
      _client.post<Object?>('/conversations/$conversationId/messages/delivered', data: {'upToSeq': '$upToSeq'});

  @override
  Future<MessageInfo> info(String conversationId, String messageId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/messages/$messageId/info',
    );
    final data = response.data ?? const <String, Object?>{};
    List<MessageInfoEntry> people(Object? raw) => [
          for (final row in (raw as List?) ?? const [])
            if (row is Map && row['actorId'] is String)
              MessageInfoEntry(
                actorId: row['actorId'] as String,
                displayName: row['displayName'] is String ? row['displayName'] as String : '',
                avatarUrl: row['avatarUrl'] is String ? row['avatarUrl'] as String : null,
                at: WireMappers.parseTime(row['at']),
              ),
        ];
    return MessageInfo(
      readBy: people(data['readBy']),
      deliveredTo: people(data['deliveredTo']),
      pending: people(data['pending']),
    );
  }
}
