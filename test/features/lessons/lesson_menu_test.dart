import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/lessons/domain/lesson_menu.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';

/// Owner 2026-10-24: the chat's "+" Lesson section listed "I can't teach this lesson"
/// for every upcoming lesson and no report. It now offers THE relevant lesson of each
/// child: the most recent one still owed a report, else the next one.
void main() {
  final now = DateTime(2026, 10, 24, 14, 30);
  LessonTicket t(LessonTicketKind kind, String lessonId, Duration fromNow, {String learner = 'yahya'}) => LessonTicket(
        kind: kind,
        lessonId: lessonId,
        learnerId: learner,
        learnerName: learner,
        startsAt: now.add(fromNow),
        endsAt: now.add(fromNow + const Duration(minutes: 30)),
      );
  String names(LessonMenu m) => m.tickets.map((x) => '${x.kind.name}:${x.lessonId}').join(', ');

  // The server's answer for Yahya in the owner's screenshot: an apology per lesson.
  final upcoming = [
    t(LessonTicketKind.teacherApology, 'oct25', const Duration(days: 1, hours: 4)),
    t(LessonTicketKind.teacherApology, 'oct28', const Duration(days: 4, hours: 4)),
    t(LessonTicketKind.teacherApology, 'nov1', const Duration(days: 8, hours: 4)),
    t(LessonTicketKind.teacherApology, 'nov4', const Duration(days: 11, hours: 4)),
  ];

  test('only upcoming lessons: "I can\'t teach" for the NEXT one only', () {
    final m = lessonMenu(upcoming);
    expect(names(m), 'teacherApology:oct25');
    expect(m.otherUnreported, 0);
    // The later ones are one tap further, soonest first -- never gone.
    expect(m.more.map((x) => x.lessonId), ['oct28', 'nov1', 'nov4']);
  });

  test('past unreported lessons: the most recent report, the others counted, no apology', () {
    final m = lessonMenu([
      t(LessonTicketKind.report, 'oct20', const Duration(days: -4)),
      t(LessonTicketKind.absence, 'oct20', const Duration(days: -4)),
      t(LessonTicketKind.report, 'oct22', const Duration(days: -2, hours: -3)),
      t(LessonTicketKind.absence, 'oct22', const Duration(days: -2, hours: -3)),
      ...upcoming,
    ]);
    expect(names(m), 'report:oct22');
    expect(m.otherUnreported, 1);
  });

  test('a lesson in progress is the one to report', () {
    final m = lessonMenu([
      t(LessonTicketKind.report, 'oct20', const Duration(days: -4)),
      t(LessonTicketKind.report, 'now', const Duration(minutes: -10)),
      t(LessonTicketKind.absence, 'now', const Duration(minutes: -10)),
      t(LessonTicketKind.lateApology, 'now', const Duration(minutes: -10)),
      ...upcoming,
    ]);
    expect(names(m), 'report:now, lateApology:now');
    expect(m.otherUnreported, 1);
  });

  test('nothing offered: nothing shown', () {
    final m = lessonMenu(const []);
    expect(m.tickets, isEmpty);
    expect(m.otherUnreported, 0);
  });

  test('each child of a family group gets its own relevant lesson', () {
    final m = lessonMenu([
      t(LessonTicketKind.report, 'aya-now', const Duration(minutes: -10), learner: 'aya'),
      t(LessonTicketKind.teacherApology, 'aya-next', const Duration(days: 2), learner: 'aya'),
      t(LessonTicketKind.teacherApology, 'nader-next', const Duration(days: 1), learner: 'nader'),
      t(LessonTicketKind.teacherApology, 'nader-later', const Duration(days: 3), learner: 'nader'),
    ]);
    expect(names(m), 'report:aya-now, teacherApology:nader-next');
  });

  // The parent's menu (owner 2026-10-24, parent Tarek in "Adam El-Sayed · Jawwid"):
  // "Apologise for the lesson" four times, "Book the make-up lesson" twice, then
  // "Change lesson time".
  group('a parent', () {
    final apologies = [
      t(LessonTicketKind.apology, 'sat24', const Duration(hours: 3), learner: 'adam'),
      t(LessonTicketKind.apology, 'tue27', const Duration(days: 3), learner: 'adam'),
      t(LessonTicketKind.apology, 'sat31', const Duration(days: 7), learner: 'adam'),
      t(LessonTicketKind.apology, 'nov3', const Duration(days: 10), learner: 'adam'),
    ];
    final makeups = [
      t(LessonTicketKind.bookMakeup, 'oct21-1441', const Duration(days: -3), learner: 'adam'),
      t(LessonTicketKind.bookMakeup, 'oct21-1641', const Duration(days: -3, hours: 2), learner: 'adam'),
    ];
    const change = LessonTicket(kind: LessonTicketKind.changeLessonTime, learnerId: 'adam', learnerName: 'adam');

    test('the next lesson\'s apology, one make-up, one "Change lesson time"; the rest one tap further', () {
      final m = lessonMenu([...apologies, ...makeups, change]);
      expect(names(m), 'apology:sat24, bookMakeup:oct21-1441, changeLessonTime:null');
      expect(m.more.map((x) => '${x.kind.name}:${x.lessonId}'),
          ['bookMakeup:oct21-1641', 'apology:tue27', 'apology:sat31', 'apology:nov3']);
      expect(m.otherUnreported, 0);
    });

    test('the same lesson offered twice is one entry', () {
      final m = lessonMenu([makeups.first, makeups.first, apologies.first, apologies.first]);
      expect(names(m), 'bookMakeup:oct21-1441, apology:sat24');
      expect(m.more, isEmpty);
    });

    test('several children: the next lesson of each', () {
      final m = lessonMenu([
        t(LessonTicketKind.apology, 'aya-1', const Duration(days: 1), learner: 'aya'),
        t(LessonTicketKind.apology, 'nader-1', const Duration(hours: 5), learner: 'nader'),
        t(LessonTicketKind.apology, 'aya-2', const Duration(days: 2), learner: 'aya'),
        t(LessonTicketKind.lateApology, 'aya-0', const Duration(minutes: -20), learner: 'aya'),
      ]);
      expect(names(m), 'apology:aya-1, apology:nader-1, lateApology:aya-0');
      expect(m.more.map((x) => x.lessonId), ['aya-2']);
    });
  });
}
