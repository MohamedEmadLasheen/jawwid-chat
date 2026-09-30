import '../../../core/data/repositories.dart';
import '../../../shared/models/message.dart';

/// One thing in a conversation's timeline: a message, or a call.
///
/// WHY A CALL IS NOT A MESSAGE HERE. `screens/call.md` §3 wants an ended or
/// missed call to appear in the thread, and the obvious way to get that would be
/// for the server to write a `MessageType.SYSTEM` row. **It does not, and W7 does
/// not make it.** `chat.message` has no call rows, `CallService` writes none, and
/// adding that is backend work inside a CLOSED workstream.
///
/// So this is the approved W7 design (D2a), and it is a deliberate architectural
/// decision rather than an unfinished one:
///
///   **Call cards are derived from authoritative call history and are not
///   persisted as chat `MessageType.SYSTEM` records.**
///
/// What that buys: the card is always consistent with `GET /calls/history/:id`,
/// which is the same record the Calls screen shows, so the thread cannot disagree
/// with history. What it costs: the card is not a message, so it cannot be
/// replied to, reacted to, forwarded or searched — none of which a call card
/// should support anyway.
sealed class ThreadItem {
  const ThreadItem();

  /// When it happened. The only thing the merge orders on.
  DateTime get at;

  /// A stable tiebreak, so two things at the same instant do not swap places
  /// between rebuilds.
  String get tiebreak;
}

final class MessageItem extends ThreadItem {
  const MessageItem(this.message);

  final Message message;

  @override
  DateTime get at => message.createdAt;

  @override
  String get tiebreak => message.id ?? message.clientMessageId;
}

final class CallItem extends ThreadItem {
  const CallItem(this.call);

  final CallHistoryEntry call;

  @override
  DateTime get at => call.startedAt;

  @override
  String get tiebreak => call.id;
}

/// Merge a conversation's messages and its calls into one ordered timeline.
///
/// OLDEST FIRST, matching `MessageLog`'s own order — the thread widget reverses
/// it for display, and doing that here would make this function's contract depend
/// on a rendering decision.
///
/// DETERMINISTIC, which matters more than it looks. A call and a message can
/// share a timestamp to the millisecond, and `List.sort` is not stable in Dart:
/// without a tiebreak the two could swap on every rebuild and the thread would
/// visibly shuffle. So equal instants are ordered messages-then-calls, and equal
/// instants within a kind are ordered by id.
///
/// ONLY TERMINAL CALLS. A call that is ringing or active has not happened yet —
/// it is on screen as a call, not in the thread as history — and `outcome` is null
/// until the server sets it, so there is nothing truthful to render. The history
/// endpoint only returns what it returns; this filters nothing else.
List<ThreadItem> mergeThread({
  required List<Message> messages,
  required List<CallHistoryEntry> calls,
}) {
  final items = <ThreadItem>[
    ...messages.map(MessageItem.new),
    ...calls.map(CallItem.new),
  ];

  items.sort((a, b) {
    final byTime = a.at.compareTo(b.at);
    if (byTime != 0) return byTime;
    // A message and a call at the same instant: the message first, always.
    final aIsCall = a is CallItem;
    final bIsCall = b is CallItem;
    if (aIsCall != bIsCall) return aIsCall ? 1 : -1;
    return a.tiebreak.compareTo(b.tiebreak);
  });

  return items;
}
