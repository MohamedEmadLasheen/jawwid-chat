import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart' show CallHistoryEntry, Page;

/// THIS ACCOUNT'S call history, and nothing else (W8-W2).
///
/// WHY IT IS NOT A METHOD ON `CallRepository`. It would naturally live there,
/// and that was the first design. `CallRepository` is W3/W6-closed and has four
/// implementers — the HTTP one, the fake build, and two test doubles — so adding
/// a method to it would have forced edits into three files belonging to closed
/// workstreams. The product owner chose the bounded alternative: one small
/// W8-owned contract with a single responsibility.
///
/// THE SPLIT, STATED SO IT IS NOT MISREAD AS DRIFT:
///
///   `CallRepository`               start · accept · decline · end · capability
///                                  · media token · PER-CONVERSATION history
///   `AccountCallHistoryRepository` the Calls tab's ACCOUNT-scoped history
///
/// That is the whole of it. This must not grow into a second call repository: it
/// takes no part in the lifecycle, issues no media token, and has no opinion
/// about a call in progress.
///
/// IT DECIDES NOTHING. Authorization, account scope, ordering, paging and the
/// privacy-safe field mapping are all the server's — `GET /calls/history`
/// derives its scope from the conversations the actor may read and never from
/// `family_id`. This is a transport, and the one client-side rule it enforces is
/// that a response it cannot fully trust is refused rather than half-rendered.
abstract interface class AccountCallHistoryRepository {
  /// One page of this account's calls, newest first.
  ///
  /// [cursor] is the opaque `nextCursor` from the previous page. It is not a
  /// capability: the server re-derives the authorized scope on every request, so
  /// a cursor naming a call this actor may not read simply yields their own
  /// first page.
  Future<Page<CallHistoryEntry>> page({String? cursor});
}

/// The account-history repository for this build.
///
/// Overridden in `bootstrap.dart` with the implementation that holds the
/// application's single shared `ApiClient`. Unoverridden it throws, exactly as
/// every other repository provider in this app does, so a container that forgot
/// to register it fails loudly instead of returning an empty history that would
/// read as "you have no calls".
final accountCallHistoryProvider = Provider<AccountCallHistoryRepository>((ref) {
  throw UnimplementedError('accountCallHistoryProvider must be overridden');
});
