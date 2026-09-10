import '../../../core/data/repositories.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';

/// What a viewer is allowed to see on a profile.
///
/// This exists as a type rather than as `if (role == …)` scattered through widgets so the
/// privacy boundary has exactly one home and can be tested without pumping a screen.
///
/// ## The contact file
///
/// There is no contact file, here or anywhere. `chat.contact` has no phone or email column;
/// `Actor` — the only shape the communication engine can obtain for a person — deliberately
/// has no phone, email or address field, and says so; `ConversationMemberDto` carries
/// `{actorId, actorKind, memberRole, isSilent}` and nothing more. The client mirrors that by
/// modelling no such field, which is what makes "a teacher cannot read a parent's phone
/// number" a property of the system rather than a rule someone has to remember.
///
/// So this type does not carry contact points, not even empty ones. When the backend gains
/// a contact file it must arrive already scoped to its owner (see the report), and *that* is
/// what this type will then expose — never a list the UI is trusted to hide.
enum ProfileAudience {
  /// The viewer is looking at their own account. The only audience that may ever see a
  /// contact file or the family's children.
  owner,

  /// Anyone else: a teacher looking at a parent, a parent looking at a teacher, a member
  /// of the same group. Name, role and avatar only (`student-group.md` §, DQ-04).
  other,
}

/// One person as a profile may show them.
///
/// Three fields, and no fourth. A profile that cannot render a phone number is one that
/// cannot leak one.
class ProfilePerson {
  const ProfilePerson({
    required this.id,
    required this.displayName,
    this.role,
    this.avatarUrl,
  });

  final String id;

  /// May be empty over HTTP: `ConversationMemberDto` has no name field (gap O3). The UI
  /// shows a neutral role word in that case and **never** falls back to the actor id.
  final String displayName;

  final ParticipantRole? role;
  final String? avatarUrl;

  bool get hasResolvedName => displayName.trim().isNotEmpty;
}

/// A child of the signed-in parent, assembled from data that genuinely exists.
///
/// [level], [subscription] and [schedule] are typed but **always null today** — nothing in
/// the published contract carries them. They are not invented, and the UI renders them as
/// explicitly unavailable rather than as a blank that reads like "none".
class ProfileChild {
  const ProfileChild({
    required this.learner,
    required this.conversationId,
    this.groupTitle,
    this.teacherName,
    this.level,
    this.subscription,
    this.schedule,
  });

  final LearnerRef learner;

  /// The child's student group — the one real relationship the client can follow.
  final String conversationId;
  final String? groupTitle;

  /// Resolved from the group's members, where a member carries the teacher role.
  final String? teacherName;

  /// `chat.learner.level` exists in the database and is on no DTO the client can reach.
  final String? level;

  /// No subscription entity exists anywhere in this system.
  final String? subscription;

  /// `chat.learner.next_class_at` exists in the database and is on no DTO.
  final String? schedule;
}

/// Everything a profile screen renders, already filtered for its viewer.
class ProfileView {
  const ProfileView({
    required this.audience,
    required this.subject,
    required this.isGroup,
    this.learner,
    this.members = const [],
    this.children = const [],
    this.handledByLabel,
    this.requiresApproval = false,
  });

  final ProfileAudience audience;

  /// The person or group this profile is about.
  final ProfilePerson subject;

  /// Group info rather than a personal profile.
  final bool isGroup;

  /// The student a group belongs to.
  final LearnerRef? learner;

  final List<ProfilePerson> members;

  /// Only ever populated for [ProfileAudience.owner]. A teacher must not be handed a
  /// family's roster — group membership is not a family directory (§25), and a sibling the
  /// teacher does not teach must not become visible through a profile.
  final List<ProfileChild> children;

  final String? handledByLabel;
  final bool requiresApproval;

  /// Whether a contact file may be shown at all.
  ///
  /// Answers false for every viewer today, because no contact file exists to show. It is
  /// written as a function of the audience rather than as `false` so that wiring real data
  /// in later cannot skip the ownership check.
  bool get maySeeContactFile => audience == ProfileAudience.owner;

  /// Whether a children section belongs on this profile at all.
  ///
  /// Owner **and** parent. Being the owner is not enough: a teacher has no children in this
  /// product, and rendering them an empty "Children" section invents a relationship the
  /// product does not have — it reads as "you have no children linked", which is not a
  /// thing a teacher's account can be missing.
  bool get maySeeChildren =>
      audience == ProfileAudience.owner &&
      subject.role == ParticipantRole.parent;
}

/// Builds the view for a conversation, given who is looking.
abstract final class ProfileViewBuilder {
  /// A conversation's profile, as seen by [viewerRole].
  ///
  /// Note what is *not* a parameter: any contact information. There is nothing to pass.
  static ProfileView forConversation({
    required Conversation conversation,
    required UserRole viewerRole,
    StudentGroup? group,
  }) {
    final isGroup = conversation.kind == ConversationKind.studentGroup;

    return ProfileView(
      // Opening a conversation's profile is always looking at someone else — your own
      // account is reached through Settings, never through a chat row.
      audience: ProfileAudience.other,
      subject: ProfilePerson(
        id: conversation.id,
        displayName: conversation.title,
        avatarUrl: conversation.avatarUrl,
      ),
      isGroup: isGroup,
      learner: conversation.learner ?? group?.learner,
      members: [
        for (final member in group?.members ?? const <GroupMember>[])
          ProfilePerson(
            id: member.id,
            displayName: member.displayName,
            role: member.role,
            avatarUrl: member.avatarUrl,
          ),
      ],
      handledByLabel: conversation.handledByLabel,
      requiresApproval: conversation.requiresApproval || (group?.requiresApproval ?? false),
    );
  }

  /// The signed-in user's own account.
  static ProfileView forOwnAccount({
    required String id,
    required String displayName,
    required UserRole role,
    String? avatarUrl,
    List<ProfileChild> children = const [],
  }) {
    return ProfileView(
      audience: ProfileAudience.owner,
      subject: ProfilePerson(
        id: id,
        displayName: displayName,
        role: role == UserRole.parent
            ? ParticipantRole.parent
            : ParticipantRole.teacher,
        avatarUrl: avatarUrl,
      ),
      isGroup: false,
      // A teacher has no children roster; only a parent's account lists learners.
      children: role == UserRole.parent ? children : const [],
    );
  }
}
