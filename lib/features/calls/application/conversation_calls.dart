import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import 'call_controller.dart';

/// The calls that belong to one conversation, for the thread's call cards.
///
/// DERIVED FROM THE AUTHORITATIVE RECORD, which is the whole point of the D2(a)
/// design: `GET /calls/history/:conversationId` is the same endpoint the Calls
/// screen reads, so a card in the thread cannot disagree with call history. The
/// card is NOT a `MessageType.SYSTEM` row and is not persisted as one — see
/// `call_timeline.dart`.
///
/// IT SURVIVES A RELOAD by asking again. There is no local store to go stale, and
/// re-entering the conversation re-derives the same cards from the same record.
///
/// IT REFRESHES WHEN A CALL ENDS. Watching the call controller's phase means that
/// the moment a call reaches a terminal state, this is invalidated and the new
/// card appears — without polling, and without the client inventing the card from
/// the event. The server is still asked; the event is only the cue to ask.
///
/// FAILS QUIETLY. A conversation whose calls cannot be fetched shows no cards
/// rather than an error in the middle of a thread: the messages are what the
/// screen is for, and a missing card is not worth breaking them over.
final conversationCallsProvider =
    FutureProvider.autoDispose.family<List<CallHistoryEntry>, String>((ref, conversationId) async {
  // The cue, not the source. Any transition into or out of a live call is a
  // reason to re-read history; the history endpoint is what actually answers.
  ref.watch(callControllerProvider.select((state) => state.phase));

  final CallRepository calls;
  try {
    calls = ref.watch(callRepositoryProvider);
  } catch (error) {
    final cause = error is ProviderException ? error.exception : error;
    if (cause is UnimplementedError) return const [];
    rethrow;
  }

  try {
    return await calls.callHistory(conversationId: conversationId);
  } catch (_) {
    return const [];
  }
});
