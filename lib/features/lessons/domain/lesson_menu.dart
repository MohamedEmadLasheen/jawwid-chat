import '../../../shared/models/lesson.dart';

/// What the "+" menu's Lesson section shows in one chat (owner 2026-10-24).
///
/// The server offers every ticket the clock allows -- a teacher apology for each of a
/// child's lessons in the next two weeks, a report for each lesson still open. Listing
/// them all made the section a list of "I can't teach this lesson" for every date, so
/// the menu shows THE relevant lesson of each child here:
///
/// * a lesson that started (in progress or ended) and has no report: "Write lesson
///   report" for it -- the most recent one when several are owed; the rest are counted
///   in [otherUnreported] and reached from the Schedule;
/// * otherwise "I can't teach this lesson" for the NEXT upcoming lesson only.
///
/// Nothing else is filtered: a make-up to book, a parent's tickets and a regular-time
/// change pass through as offered. This decides what is drawn, never what is allowed --
/// the server decides each ticket again on submit.
class LessonMenu {
  const LessonMenu({this.tickets = const [], this.otherUnreported = 0});

  final List<LessonTicket> tickets;

  /// Lessons still owed a report beyond the one offered, across the children here.
  final int otherUnreported;
}

LessonMenu lessonMenu(List<LessonTicket> offered) {
  final reports = <String, List<LessonTicket>>{};
  final apologies = <String, List<LessonTicket>>{};
  for (final t in offered) {
    if (t.kind == LessonTicketKind.report) (reports[t.learnerId] ??= []).add(t);
    if (t.kind == LessonTicketKind.teacherApology) (apologies[t.learnerId] ??= []).add(t);
  }
  int byStart(LessonTicket a, LessonTicket b) =>
      (a.startsAt ?? DateTime(0)).compareTo(b.startsAt ?? DateTime(0));

  final keep = <LessonTicket>{};
  var other = 0;
  for (final MapEntry(key: learner, value: owed) in reports.entries) {
    owed.sort(byStart);
    keep.add(owed.last);
    other += owed.length - 1;
    apologies.remove(learner);
  }
  for (final upcoming in apologies.values) {
    upcoming.sort(byStart);
    keep.add(upcoming.first);
  }

  return LessonMenu(
    otherUnreported: other,
    tickets: [
      for (final t in offered)
        if (switch (t.kind) {
          LessonTicketKind.report || LessonTicketKind.teacherApology => keep.contains(t),
          // PD-15: an absence is reached from inside its lesson's report entry; a teacher
          // is offered one only together with that report.
          LessonTicketKind.absence => !reports.containsKey(t.learnerId),
          _ => true,
        })
          t,
    ],
  );
}
