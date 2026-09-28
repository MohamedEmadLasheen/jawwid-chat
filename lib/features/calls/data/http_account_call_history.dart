import '../../../core/data/repositories.dart' show CallHistoryEntry, CallOutcome, Page;
import '../../../core/data/wire/wire_vocab.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/api_client.dart';
import 'account_call_history.dart';

/// `GET /calls/history` over the application's shared [ApiClient] (W8-W2).
///
/// ONE CLIENT, NOT A SECOND STACK. It is handed the same `ApiClient` every other
/// repository receives — the one built once in `bootstrap.dart` with the app's
/// interceptors, its `TokenProvider` and its single refresh lifecycle. A second
/// Dio would mean a second refresh path racing the first for the same session,
/// which is the failure W2 and W3 were built to prevent.
///
/// IT FAILS CLOSED, AND MORE STRICTLY THAN THE PER-CONVERSATION PARSER.
/// `HttpCallRepository._historyEntry` DROPS a row it cannot parse, deliberately:
/// in a conversation thread one bad row should not empty a history the user can
/// still see beside it. This screen is different — it IS the record, and a
/// silently shortened list looks exactly like a complete one. So a malformed
/// envelope, a malformed row, or a `nextCursor` that is not a string refuses the
/// whole response rather than rendering a history that is quietly incomplete.
///
/// IT NEVER DECIDES ANYTHING. No `family_id` is sent, read or inferred; no scope
/// is computed here; no ordering or paging is performed on the client. The
/// server answers with what this actor may read, in its own order, and this maps
/// the rows.
class HttpAccountCallHistory implements AccountCallHistoryRepository {
  HttpAccountCallHistory({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<Page<CallHistoryEntry>> page({String? cursor}) async {
    final response = await _client.get<Map<String, Object?>>(
      '/calls/history',
      query: {if (cursor != null && cursor.isNotEmpty) 'cursor': cursor},
    );

    final data = response.data;
    if (data == null) throw _malformed('response had no body');

    final rows = data['items'];
    if (rows is! List) throw _malformed('response carried no items array');

    // `nextCursor` is absent or null on the last page; anything else that is not
    // a string is a contract the client does not recognise.
    final next = data['nextCursor'];
    if (next != null && next is! String) {
      throw _malformed('nextCursor was neither a string nor null');
    }

    final items = <CallHistoryEntry>[];
    for (final row in rows) {
      if (row is! Map) throw _malformed('an item was not an object');
      items.add(_entry(row));
    }

    final nextCursor = next as String?;
    return Page(
      items: items,
      nextCursor: nextCursor,
      hasMore: nextCursor != null && nextCursor.isNotEmpty,
    );
  }

  /// One row, or a refusal. Every required field must be present and the right
  /// type; there is no branch that substitutes a default for something the
  /// server did not send.
  CallHistoryEntry _entry(Map<dynamic, dynamic> row) {
    final id = row['id'];
    final conversationId = row['conversationId'];
    final startedAt = DateTime.tryParse(row['startedAt'] as String? ?? '');
    if (id is! String || conversationId is! String || startedAt == null) {
      throw _malformed('a call row was missing id, conversationId or startedAt');
    }

    final outcome = switch (row['outcome']) {
      Wire.callAnswered => CallOutcome.answered,
      Wire.callMissed => CallOutcome.missed,
      Wire.callDeclined => CallOutcome.declined,
      // A call still ringing or active carries no outcome yet. `missed` is the
      // honest placeholder for a row with no answer recorded, and it is what the
      // server itself writes when such a call is swept — the same choice
      // `HttpCallRepository` makes, so the two surfaces read a row identically.
      _ => CallOutcome.missed,
    };

    final seconds = row['durationSeconds'];
    return CallHistoryEntry(
      id: id,
      conversationId: conversationId,
      // NO DISPLAY NAME EXISTS on a history row — it carries `initiatorId` and
      // no name. Left empty for the interface to treat as unresolved rather than
      // filled with an id a parent would then read (O3 in
      // `docs/mobile/backend-dependencies.md`).
      title: '',
      startedAt: startedAt,
      outcome: outcome,
      isGroup: row['type'] == Wire.callTypeGroup,
      duration: seconds is int ? Duration(seconds: seconds) : null,
    );
  }

  AppError _malformed(String detail) => AppError(
        AppErrorKind.server,
        code: 'malformed_account_call_history',
        debugDetail: detail,
      );
}
