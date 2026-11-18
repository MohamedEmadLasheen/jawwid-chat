/// LR-09j: the synthetic people, chats, calls and lessons the store screenshots show.
///
/// EVERYTHING HERE IS INVENTED (LR-10, G-20):
///  * every name is a made-up placeholder chosen for these shots: no member of
///    staff, no family, no child of the academy. None is on the G-20 list
///    (`scripts/qa/guards.sh`), which the CI guard scans this folder for;
///  * no photo of anybody: every avatar is initials (no `avatarUrl` anywhere);
///  * no Quran text, no lesson content, no prices: the messages are everyday
///    academy talk, like the review cohort's (`docs/release/review-accounts.md`);
///  * the sign-in identity is on `example.com`, a domain reserved for examples.
///
/// Arabic and English are written separately rather than translated on the fly,
/// so each language reads as a real chat in that language.
library;

import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/parent_profile.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Ids the run navigates by.
abstract final class ShotIds {
  static const parentId = 'u_parent';
  static const teacherId = 'u_teacher';
  static const supervisorId = 'u_supervisor';

  /// The child whose group chat, lesson call and schedule are shown.
  static const childId = 'l_shot_1';
  static const secondChildId = 'l_shot_2';
  static const thirdChildId = 'l_shot_3';

  /// The family group: the conversation both the parent and the teacher shots open.
  static const familyGroup = 'c_group_1';
  static const secondGroup = 'c_group_2';
  static const teacherSecondGroup = 'c_group_3';
  static const supervisor = 'c_supervisor';
  static const support = 'c_support';

  static const callId = 'call_shot_1';
}

/// One language's copy of every name and line.
class _Copy {
  const _Copy({
    required this.parent,
    required this.relationship,
    required this.child,
    required this.secondChild,
    required this.thirdChild,
    required this.teacher,
    required this.supervisor,
    required this.jawwid,
    required this.dutySupervisor,
    required this.group,
    required this.welcome,
    required this.teacherHello,
    required this.parentThanks,
    required this.teacherUpdate,
    required this.parentReply,
    required this.secondGroupPreview,
    required this.teacherSecondGroupPreview,
    required this.supervisorPreviewParent,
    required this.supervisorPreviewTeacher,
    required this.supportPreview,
    required this.supervisorThread,
    required this.childLevel,
    required this.secondChildLevel,
  });

  final String parent;
  final String relationship;
  final String child;
  final String secondChild;
  final String thirdChild;
  final String teacher;
  final String supervisor;
  final String jawwid;
  final String dutySupervisor;
  final String Function(String child) group;
  final String welcome;
  final String teacherHello;
  final String parentThanks;
  final String teacherUpdate;
  final String parentReply;
  final String secondGroupPreview;
  final String teacherSecondGroupPreview;
  final String supervisorPreviewParent;
  final String supervisorPreviewTeacher;
  final String supportPreview;
  final List<String> supervisorThread;
  final String childLevel;
  final String secondChildLevel;
}

const _ar = _Copy(
  parent: 'هدى سالم',
  relationship: 'الأم',
  child: 'يحيى',
  secondChild: 'سلمى',
  thirdChild: 'عمر',
  teacher: 'حسن مراد',
  supervisor: 'ندى فوزي',
  jawwid: 'جَوِّد',
  dutySupervisor: 'المشرفة المناوبة',
  group: _arGroup,
  welcome: 'أهلًا بكم في مجموعة يحيى. أنا مشرفته، ومعنا معلمه الأستاذ حسن.',
  teacherHello: 'مرحبًا! سعيد بالانضمام، وأتطلع إلى دروسنا معًا.',
  parentThanks: 'شكرًا لكما. يحيى متحمس جدًا للبدء.',
  teacherUpdate: 'كانت حصة اليوم رائعة، وتحسنت قراءة يحيى كثيرًا. برجاء مراجعة الواجب معه عشر دقائق يوميًا.',
  parentReply: 'حاضر، شكرًا يا أستاذ. نراكم يوم الأربعاء.',
  secondGroupPreview: 'نلتقي يوم الخميس في الموعد نفسه.',
  teacherSecondGroupPreview: 'شكرًا يا أستاذ.',
  supervisorPreviewParent: 'جدول هذا الأسبوع كما هو دون تغيير.',
  supervisorPreviewTeacher: 'جدولك للأسبوع القادم جاهز.',
  supportPreview: 'أهلًا بك، كيف يمكننا مساعدتك؟',
  supervisorThread: [
    'السلام عليكم، هل يمكن معرفة مواعيد هذا الأسبوع؟',
    'وعليكم السلام. بالتأكيد، الحصص يوم الاثنين والأربعاء والجمعة الساعة الرابعة عصرًا.',
    'جدول هذا الأسبوع كما هو دون تغيير.',
  ],
  childLevel: 'الصف الرابع',
  secondChildLevel: 'الصف الثاني',
);

const _en = _Copy(
  parent: 'Huda Salem',
  relationship: 'Mother',
  child: 'Yahya',
  secondChild: 'Salma',
  thirdChild: 'Omar',
  teacher: 'Hassan Mourad',
  supervisor: 'Nada Fawzi',
  jawwid: 'Jawwid',
  dutySupervisor: 'Duty supervisor',
  group: _enGroup,
  welcome: "Welcome to Yahya's group. I am his supervisor, and his teacher Mr. Hassan is here with us.",
  teacherHello: 'Hello! Glad to join, and I look forward to our lessons together.',
  parentThanks: 'Thank you both. Yahya is very excited to start.',
  teacherUpdate: "Today's lesson went really well, and Yahya's reading has improved a lot. "
      'Please review the homework with him for ten minutes a day.',
  parentReply: 'We will, thank you. See you on Wednesday.',
  secondGroupPreview: 'See you on Thursday at the usual time.',
  teacherSecondGroupPreview: 'Thank you, teacher.',
  supervisorPreviewParent: "This week's schedule is unchanged.",
  supervisorPreviewTeacher: 'Your schedule for next week is ready.',
  supportPreview: 'Welcome! How can we help you?',
  supervisorThread: [
    "Hello, could you share this week's lesson times?",
    'Of course. Lessons are on Monday, Wednesday and Friday at 4 pm.',
    "This week's schedule is unchanged.",
  ],
  childLevel: 'Grade 4',
  secondChildLevel: 'Grade 2',
);

String _arGroup(String child) => '$child · جَوِّد';
String _enGroup(String child) => '$child · Jawwid';

/// Everything one run shows, for one language and one signed-in role.
class ShotData {
  ShotData._({
    required this.anchor,
    required this.viewer,
    required this.conversations,
    required this.messages,
    required this.groups,
    required this.teacherLessons,
    required this.childSchedule,
    required this.workload,
    required this.callHistory,
    required this.parentProfile,
    required this.childName,
    required this.callerName,
  });

  /// "Now" for the chats: today at 09:41 on the device, the time the status bar
  /// is also set to. Lessons are in the days after today, so they are upcoming
  /// whenever the run happens.
  final DateTime anchor;
  final AuthUser viewer;
  final List<Conversation> conversations;
  final Map<String, List<Message>> messages;
  final Map<String, StudentGroup> groups;
  final List<ScheduledLesson> teacherLessons;
  final ChildSchedule childSchedule;
  final TeacherWorkload workload;
  final List<CallHistoryEntry> callHistory;
  final ParentProfile parentProfile;

  /// The child the parent's schedule shot shows.
  final String childName;

  /// Who rings in the call shot: the teacher, calling the family group for the lesson.
  final String callerName;

  factory ShotData({required bool arabic, required UserRole role, DateTime? today}) {
    final c = arabic ? _ar : _en;
    final now = today ?? DateTime.now();
    final anchor = DateTime(now.year, now.month, now.day, 9, 41);
    final isTeacher = role == UserRole.teacher;
    final viewerId = isTeacher ? ShotIds.teacherId : ShotIds.parentId;

    // --- The family group, as both the parent and the teacher see it --------
    var seq = 0;
    Message line(String conversationId, String authorId, String name, ParticipantRole r, String body, Duration ago) {
      seq++;
      final mine = authorId == viewerId;
      return Message(
        id: 'shot_m_$seq',
        clientMessageId: 'shot_c_$seq',
        conversationId: conversationId,
        sequence: seq,
        authorId: authorId,
        authorName: name,
        authorRole: r,
        kind: MessageKind.text,
        body: body,
        createdAt: anchor.subtract(ago).toUtc(),
        deliveryState: mine ? DeliveryState.read : DeliveryState.delivered,
        isMine: mine,
      );
    }

    final family = <Message>[
      line(ShotIds.familyGroup, ShotIds.supervisorId, c.supervisor, ParticipantRole.admin, c.welcome,
          const Duration(hours: 24, minutes: 30)),
      line(ShotIds.familyGroup, ShotIds.teacherId, c.teacher, ParticipantRole.teacher, c.teacherHello,
          const Duration(hours: 24, minutes: 20)),
      line(ShotIds.familyGroup, ShotIds.parentId, c.parent, ParticipantRole.parent, c.parentThanks,
          const Duration(hours: 24, minutes: 10)),
      line(ShotIds.familyGroup, ShotIds.teacherId, c.teacher, ParticipantRole.teacher, c.teacherUpdate,
          const Duration(minutes: 60)),
      line(ShotIds.familyGroup, ShotIds.parentId, c.parent, ParticipantRole.parent, c.parentReply,
          const Duration(minutes: 45)),
    ];

    final supervisorThread = <Message>[
      line(ShotIds.supervisor, viewerId, isTeacher ? c.teacher : c.parent,
          isTeacher ? ParticipantRole.teacher : ParticipantRole.parent, c.supervisorThread[0],
          const Duration(days: 1, hours: 2)),
      line(ShotIds.supervisor, ShotIds.supervisorId, c.supervisor, ParticipantRole.admin, c.supervisorThread[1],
          const Duration(days: 1, hours: 1, minutes: 50)),
      line(ShotIds.supervisor, ShotIds.supervisorId, c.supervisor, ParticipantRole.admin,
          isTeacher ? c.supervisorPreviewTeacher : c.supervisorThread[2], const Duration(days: 1)),
    ];

    final child = LearnerRef(id: ShotIds.childId, displayName: c.child);
    final familyGroup = Conversation(
      id: ShotIds.familyGroup,
      kind: ConversationKind.studentGroup,
      title: c.group(c.child),
      learner: child,
      updatedAt: family.last.createdAt,
      lastMessageAt: family.last.createdAt,
      lastMessagePreview: family.last.body,
      isPinned: true,
    );
    final supervisorChat = Conversation(
      id: ShotIds.supervisor,
      kind: ConversationKind.adminDirect,
      title: c.supervisor,
      updatedAt: supervisorThread.last.createdAt,
      lastMessageAt: supervisorThread.last.createdAt,
      lastMessagePreview: supervisorThread.last.body,
    );

    final List<Conversation> conversations;
    if (isTeacher) {
      final at = anchor.subtract(const Duration(hours: 2)).toUtc();
      conversations = [
        familyGroup,
        Conversation(
          id: ShotIds.teacherSecondGroup,
          kind: ConversationKind.studentGroup,
          title: c.group(c.thirdChild),
          learner: LearnerRef(id: ShotIds.thirdChildId, displayName: c.thirdChild),
          updatedAt: at,
          lastMessageAt: at,
          lastMessagePreview: c.teacherSecondGroupPreview,
          unreadCount: 1,
        ),
        supervisorChat,
      ];
    } else {
      final second = anchor.subtract(const Duration(hours: 3)).toUtc();
      final support = anchor.subtract(const Duration(days: 3)).toUtc();
      conversations = [
        familyGroup,
        Conversation(
          id: ShotIds.secondGroup,
          kind: ConversationKind.studentGroup,
          title: c.group(c.secondChild),
          learner: LearnerRef(id: ShotIds.secondChildId, displayName: c.secondChild),
          updatedAt: second,
          lastMessageAt: second,
          lastMessagePreview: c.secondGroupPreview,
          unreadCount: 1,
        ),
        supervisorChat,
        Conversation(
          id: ShotIds.support,
          kind: ConversationKind.jawwidSupport,
          title: c.jawwid,
          updatedAt: support,
          lastMessageAt: support,
          lastMessagePreview: c.supportPreview,
          handledByLabel: c.dutySupervisor,
        ),
      ];
    }

    final groups = <String, StudentGroup>{
      ShotIds.familyGroup: StudentGroup(
        conversationId: ShotIds.familyGroup,
        learner: child,
        members: [
          GroupMember(id: ShotIds.parentId, displayName: c.parent, role: ParticipantRole.parent, actorKind: 'contact'),
          GroupMember(id: ShotIds.teacherId, displayName: c.teacher, role: ParticipantRole.teacher, actorKind: 'teacher'),
          GroupMember(id: ShotIds.supervisorId, displayName: c.supervisor, role: ParticipantRole.admin, actorKind: 'staff'),
        ],
      ),
    };

    // --- Lessons: the next seven days, never today (so always upcoming) -------
    final lessons = <ScheduledLesson>[];
    final weekly = <GroupChildSlot>[];
    for (var d = 1; d <= 7; d++) {
      final day = DateTime(anchor.year, anchor.month, anchor.day + d);
      // Yahya: Monday, Wednesday, Friday at 16:00. Omar: Sunday, Tuesday, Thursday at 17:00.
      if (day.weekday == DateTime.monday || day.weekday == DateTime.wednesday || day.weekday == DateTime.friday) {
        final start = DateTime(day.year, day.month, day.day, 16);
        lessons.add(_lesson('shot_l_${lessons.length + 1}', ShotIds.childId, c.child, c.teacher, start));
        weekly.add(GroupChildSlot(weekday: day.weekday, start: '16:00', durationMinutes: 30, nextStartsAt: start));
      }
      if (isTeacher &&
          (day.weekday == DateTime.sunday || day.weekday == DateTime.tuesday || day.weekday == DateTime.thursday)) {
        final start = DateTime(day.year, day.month, day.day, 17);
        lessons.add(_lesson('shot_l_${lessons.length + 1}', ShotIds.thirdChildId, c.thirdChild, c.teacher, start));
      }
    }

    // --- Calls: the lesson calls in the group, and a call with the supervisor --
    DateTime daysAgo(int days, int hour, [int minute = 0]) =>
        DateTime(anchor.year, anchor.month, anchor.day - days, hour, minute).toUtc();
    final history = <CallHistoryEntry>[
      CallHistoryEntry(
        id: 'shot_call_1',
        conversationId: ShotIds.familyGroup,
        title: familyGroup.title,
        startedAt: daysAgo(1, 16),
        outcome: CallOutcome.answered,
        isGroup: true,
        duration: const Duration(minutes: 30),
        direction: isTeacher ? CallHistoryDirection.outgoing : CallHistoryDirection.incoming,
      ),
      CallHistoryEntry(
        id: 'shot_call_2',
        conversationId: ShotIds.supervisor,
        title: c.supervisor,
        startedAt: daysAgo(2, 11, 20),
        outcome: CallOutcome.answered,
        isGroup: false,
        duration: const Duration(minutes: 6, seconds: 12),
        direction: CallHistoryDirection.outgoing,
      ),
      CallHistoryEntry(
        id: 'shot_call_3',
        conversationId: ShotIds.familyGroup,
        title: familyGroup.title,
        startedAt: daysAgo(3, 16),
        outcome: CallOutcome.answered,
        isGroup: true,
        duration: const Duration(minutes: 29, seconds: 40),
        direction: isTeacher ? CallHistoryDirection.outgoing : CallHistoryDirection.incoming,
      ),
      CallHistoryEntry(
        id: 'shot_call_4',
        conversationId: ShotIds.supervisor,
        title: c.supervisor,
        startedAt: daysAgo(4, 13, 5),
        outcome: CallOutcome.missed,
        isGroup: false,
        direction: CallHistoryDirection.incoming,
      ),
    ];

    return ShotData._(
      anchor: anchor,
      viewer: AuthUser(
        id: viewerId,
        displayName: isTeacher ? c.teacher : c.parent,
        role: role,
        timeZone: 'Africa/Cairo',
      ),
      conversations: conversations,
      messages: {
        ShotIds.familyGroup: family,
        ShotIds.supervisor: supervisorThread,
      },
      groups: groups,
      teacherLessons: lessons,
      childSchedule: ChildSchedule(slots: weekly, teacherName: c.teacher),
      workload: const TeacherWorkload(heldLessons: 24, heldMinutes: 720, unreported: 0, reportsOnTimeRate: 1),
      callHistory: history,
      parentProfile: ParentProfile(
        displayName: c.parent,
        relationship: c.relationship,
        signInIdentity: 'parent@example.com',
        children: [
          ChildProfile(id: ShotIds.childId, displayName: c.child, level: c.childLevel),
          ChildProfile(id: ShotIds.secondChildId, displayName: c.secondChild, level: c.secondChildLevel),
        ],
      ),
      childName: c.child,
      callerName: c.teacher,
    );
  }
}

ScheduledLesson _lesson(String id, String learnerId, String learner, String teacher, DateTime start) => ScheduledLesson(
      id: id,
      learnerId: learnerId,
      learnerName: learner,
      teacherName: teacher,
      startsAt: start,
      endsAt: start.add(const Duration(minutes: 30)),
      kind: 'regular',
      phase: 'upcoming',
    );
