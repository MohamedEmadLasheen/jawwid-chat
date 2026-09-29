import '../../../shared/models/conversation.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `GroupRepository` over `GET /conversations/:id`, whose `ConversationDto` carries
/// `members: ConversationMemberDto[]`.
///
/// **Members now arrive named.** The route did not return a `members` array at
/// all, so this mapped an absent list and Group Info rendered an empty section
/// under a heading — the client was written against a payload that was never
/// sent. The route now returns every live member with a `displayName`, resolved
/// server-side in one batch (backend gap O3), behind the same authorization
/// that gates the rest of the conversation.
///
/// A name that is still null means the backend could not resolve the
/// principal. It is left empty here and the UI says so in words; the actor id
/// is never a fallback (§25).
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
      // Server-derived, for THIS viewer. The OR of the two stored flags used to
      // stand in for it, which told a parent their messages were reviewed
      // whenever the teacher's were.
      requiresApproval: data['viewerRequiresApproval'] == true,
    );
  }
}
