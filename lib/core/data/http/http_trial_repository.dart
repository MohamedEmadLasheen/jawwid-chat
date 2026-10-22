import '../../../shared/models/trial.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `TrialRepository` over the PD-11 T4 endpoints. One request per method; the server
/// decides who may report which trial and refuses the rest with its `COMM.*` code.
class HttpTrialRepository implements TrialRepository {
  HttpTrialRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<TrialTicket>> tickets(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>('/conversations/$conversationId/trial-tickets');
    final out = <TrialTicket>[];
    for (final row in (response.data?['tickets'] as List?) ?? const []) {
      // A ticket this build does not know is not offered.
      if (row is! Map || row['ticket'] != 'trial_report' || row['trialId'] is! String) continue;
      final startsAt = DateTime.tryParse(row['startsAt'] as String? ?? '');
      if (startsAt == null) continue;
      out.add(TrialTicket(
        trialId: row['trialId'] as String,
        prospectName: (row['prospectName'] as String?) ?? '',
        startsAt: startsAt.toLocal(),
        durationMinutes: (row['durationMinutes'] as num?)?.toInt() ?? 0,
      ));
    }
    return out;
  }

  @override
  Future<void> reportAttendance(String trialId, TrialAttendanceDraft draft) async {
    await _client.post<Object?>('/trials/$trialId/attendance', data: {
      'attended': draft.attended,
      'covered': ?draft.covered,
      'rating': ?draft.rating,
      'note': ?draft.note,
    });
  }

  @override
  Future<void> joinGroup(String conversationId) async {
    await _client.post<Object?>('/trials/groups/$conversationId/join');
  }
}
