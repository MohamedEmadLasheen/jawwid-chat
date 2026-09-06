import '../../../shared/models/conversation.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `GroupRepository` over `GET /conversations/:id`, whose `ConversationDto` carries
/// `members: ConversationMemberDto[]`.
///
/// **Members arrive without display names.** `ConversationMemberDto` is
/// `{ actorId, actorKind, memberRole, isSilent }` — there is no name and no avatar. The
/// member sheet must show a name and must never fall back to showing an id, so this maps
/// what exists and leaves the name empty for the UI to treat as unresolved. Recorded as O3
/// in `docs/mobile/backend-dependencies.md`.
///
/// Note what is deliberately *not* here: no membership mutation. `POST /conversations/:id/members`
/// exists but is staff-only and always carries a reason; a parent or teacher may not change
/// membership (§24), so this client has no method that could attempt it.
class HttpGroupRepository implements GroupRepository {
  HttpGroupRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<StudentGroup> group(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId',
    );

    final data = response.data;
    if (data == null || (data['id'] as String?)?.isNotEmpty != true) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_conversation_response',
        debugDetail: 'group response carried no conversation id',
      );
    }

    final members = <GroupMember>[];
    for (final row in (data['members'] as List?) ?? const []) {
      if (row is! Map<String, Object?>) continue;
      members.add(WireMappers.groupMember(row));
    }

    final learnerId = data['learnerId'] as String?;

    return StudentGroup(
      conversationId: conversationId,
      // The learner's display name is not on the DTO either; the title is the closest the
      // contract offers. O7.
      learner: LearnerRef(
        id: learnerId ?? '',
        displayName: (data['title'] as String?) ?? '',
      ),
      members: members,
      requiresApproval: data['teacherRequiresApproval'] == true ||
          data['parentRequiresApproval'] == true,
    );
  }
}
