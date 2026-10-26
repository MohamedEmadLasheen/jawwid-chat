import '../../../shared/models/conversation.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `GroupRepository` over `GET /conversations/:id`, whose `ConversationDto` carries
/// `members: ConversationMemberDto[]`.
///
/// **Members now arrive with display names (gap O3 closed).** `ConversationMemberDto` is
/// `{ actorId, actorKind, memberRole, isSilent, displayName }`, and `GET /conversations/:id`
/// populates `members` — it previously returned none at all, so the member sheet was empty
/// rather than merely nameless.
///
/// There is still no avatar, and an empty `displayName` is still possible: the server sends
/// `''` for a member whose actor no longer resolves, because a membership row outlives the
/// actor it names (BR-5). The sheet must never fall back to showing an id, so the UI treats
/// an empty name as unresolved and renders `groupMemberUnresolved`.
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
      summoned: [
        for (final row in (data['summoned'] as List?) ?? const [])
          if (row is Map<String, Object?> &&
              row['actorId'] is String &&
              row['displayName'] is String &&
              WireMappers.parseTime(row['at']) != null)
            SummonedPerson(
              id: row['actorId']! as String,
              displayName: row['displayName']! as String,
              staffRole: row['staffRole'] as String? ?? '',
              at: WireMappers.parseTime(row['at'])!,
              steppedIn: row['state'] == 'stepped_in',
              mentionedByName: row['mentionedByName'] as String?,
            ),
      ],
    );
  }
}
