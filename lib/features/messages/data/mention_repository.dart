import '../../../core/network/api_client.dart';

/// One person the @ list offers.
class MentionCandidate {
  const MentionCandidate({
    required this.actorId,
    required this.actorKind,
    required this.displayName,
    this.staffRole,
    required this.isMember,
  });

  final String actorId;

  /// 'staff' | 'teacher' | 'contact'.
  final String actorKind;
  final String displayName;

  /// For staff: 'super_admin' | 'manager' | 'admin' | 'coverage'.
  final String? staffRole;

  /// False: they are not in this chat and will be asked to join.
  final bool isMember;
}

/// Who the @ list offers here -- exactly who a send would accept (the server decides).
class MentionCandidates {
  const MentionCandidates({this.people = const [], this.roles = const []});

  final List<MentionCandidate> people;

  /// Parents only: 'supervisor' and 'admin' (the supervisor and the operations manager).
  final List<String> roles;
}

/// PD-36 @mentions: the picker and "I have seen it". Sending a mention rides on the message
/// send; a summons is answered in Admin Web, where the people it asks in work.
///
/// A separate seam, like [MessageSearchRepository], so a build -- or a test fake -- without
/// the routes keeps working and simply offers no @ list.
abstract interface class MentionRepository {
  bool get isAvailable;

  Future<MentionCandidates> candidates(String conversationId, String query);

  /// The viewer opened the chat: its "@" marker on their list goes.
  Future<void> markSeen(String conversationId);
}

class NoMentionRepository implements MentionRepository {
  const NoMentionRepository();

  @override
  bool get isAvailable => false;
  @override
  Future<MentionCandidates> candidates(String conversationId, String query) async => const MentionCandidates();
  @override
  Future<void> markSeen(String conversationId) async {}
}

class HttpMentionRepository implements MentionRepository {
  HttpMentionRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  bool get isAvailable => true;

  @override
  Future<MentionCandidates> candidates(String conversationId, String query) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/mention-candidates',
      query: {if (query.isNotEmpty) 'q': query},
    );
    final data = response.data ?? const {};
    return MentionCandidates(
      people: [
        for (final row in (data['people'] as List?) ?? const [])
          if (row is Map<String, Object?> && row['actorId'] is String && row['displayName'] is String)
            MentionCandidate(
              actorId: row['actorId']! as String,
              actorKind: row['actorKind'] as String? ?? '',
              displayName: row['displayName']! as String,
              staffRole: row['staffRole'] as String?,
              isMember: row['isMember'] == true,
            ),
      ],
      roles: [
        for (final r in (data['roles'] as List?) ?? const [])
          if (r == 'supervisor' || r == 'admin') r as String,
      ],
    );
  }

  @override
  Future<void> markSeen(String conversationId) async {
    await _client.post<void>('/conversations/$conversationId/mentions/seen');
  }
}
