import '../../../shared/models/supervision.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `SupervisionRepository` over the PD-12 S1 endpoints.
///
/// Every method is one request. Nothing is decided here: the server answers which
/// tickets exist, refuses what it would not allow (with its `COMM.*` code intact,
/// via [ApiClient]) and computes every number the leave screen shows.
class HttpSupervisionRepository implements SupervisionRepository {
  HttpSupervisionRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<SupervisionTickets> tickets(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/supervision-tickets',
    );
    final kinds = <SupervisionTicketKind>[];
    for (final row in (response.data?['tickets'] as List?) ?? const []) {
      // A ticket this build does not know is not offered.
      final kind = row is Map ? SupervisionTicketKind.parse(row['ticket'] as String?) : null;
      if (kind != null) kinds.add(kind);
    }
    final learners = <SupervisionLearner>[];
    for (final row in (response.data?['learners'] as List?) ?? const []) {
      if (row is! Map || row['id'] is! String || row['name'] is! String) continue;
      learners.add(SupervisionLearner(id: row['id'] as String, name: row['name'] as String));
    }
    return SupervisionTickets(kinds: kinds, learners: learners);
  }

  @override
  Future<void> requestCertificate(CertificateDraft draft) async {
    await _client.post<Object?>('/learner-certificates', data: {
      'learnerId': draft.learnerId,
      'title': draft.title,
      'achievement': draft.achievement,
      'achievedOn': calendarDay(draft.achievedOn),
      'printedName': draft.printedName,
      'grade': ?draft.grade,
      'note': ?draft.note,
    });
  }

  @override
  Future<void> requestLeave({required DateTime firstDay, required DateTime lastDay, required String reason}) async {
    await _client.post<Object?>('/me/leave-requests', data: {
      'firstDay': calendarDay(firstDay),
      'lastDay': calendarDay(lastDay),
      'reason': reason,
    });
  }

  @override
  Future<void> withdrawLeave(String requestId) async {
    await _client.post<Object?>('/me/leave-requests/$requestId/withdraw');
  }

  @override
  Future<LeaveSummary> myLeave({int? year}) async {
    final response = await _client.get<Map<String, Object?>>(
      '/me/leave',
      query: {'year': ?year?.toString()},
    );
    final data = response.data ?? const <String, Object?>{};
    final requests = <LeaveRequest>[];
    for (final row in (data['requests'] as List?) ?? const []) {
      if (row is! Map || row['id'] is! String) continue;
      final first = parseCalendarDay(row['firstDay']);
      final last = parseCalendarDay(row['lastDay']);
      if (first == null || last == null) continue;
      requests.add(LeaveRequest(
        id: row['id'] as String,
        firstDay: first,
        lastDay: last,
        days: (row['days'] as num?)?.toInt() ?? 0,
        reason: (row['reason'] as String?) ?? '',
        state: LeaveState.parse(row['state'] as String?),
        decisionNote: row['decisionNote'] as String?,
      ));
    }
    return LeaveSummary(
      year: (data['year'] as num?)?.toInt() ?? DateTime.now().year,
      allowance: (data['allowance'] as num?)?.toInt(),
      used: (data['used'] as num?)?.toInt() ?? 0,
      balance: (data['balance'] as num?)?.toInt(),
      requests: requests,
    );
  }

  @override
  Future<String> openOwnConversation() async {
    final response = await _client.post<Map<String, Object?>>('/me/supervision-conversation');
    final id = response.data?['conversationId'];
    if (id is! String) throw StateError('the server did not name the conversation');
    return id;
  }
}
