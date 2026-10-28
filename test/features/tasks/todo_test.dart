import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/work_task.dart';

/// PD-47 PR-5: the teacher's "To do" on the Schedule tab. What a task says, its level
/// and what the teacher may do with it are the server's (tasks-pd047.spec.ts and the
/// sources spec); the phone draws them. Synthetic people only.
void main() {
  Map<String, Object?> wire(String id, {String kind = 'manual', String? source, Map<String, Object?>? params, List<String> actions = const [], Map<String, Object?> extra = const {}}) => {
        'id': id,
        'kind': kind,
        'state': 'open',
        'title': kind == 'manual' ? 'Prepare the Juz Amma revision sheet' : '',
        'effectivePriority': 'medium',
        'priorityReason': 'manual',
        'overdue': false,
        'category': 'operational',
        'dueAt': '2026-11-02T15:00:00Z',
        'createdBy': kind == 'manual' ? {'id': 'tmgr', 'name': 'Teachers Manager'} : null,
        'source': source == null ? null : {'type': source, 'id': 'src-$id'},
        'sourceState': source == null ? null : 'pending',
        'titleParams': params,
        'actions': actions,
        ...extra,
      };

  late _Tasks tasks;
  late _Lessons lessons;

  Future<void> pump(WidgetTester tester, {String locale = 'en'}) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        lessonRepositoryProvider.overrideWithValue(lessons),
        taskRepositoryProvider.overrideWithValue(tasks),
      ],
      child: MaterialApp(
        locale: Locale(locale),
        theme: JawwidTheme.light(isArabic: locale == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const TeacherScheduleScreen(),
      ),
    ));
    await tester.pumpAndSettle();
  }

  setUp(() {
    lessons = _Lessons();
    tasks = _Tasks({
      't-report': wire('t-report', kind: 'system', source: 'lesson_report', params: {'learnerName': 'learner_k', 'startsAt': '2026-10-27T15:00:00Z', 'lessonId': 'lesson-1'},
          actions: ['out_of_scope'], extra: {'effectivePriority': 'high', 'priorityReason': 'overdue', 'overdue': true}),
      't-manual': wire('t-manual', actions: ['complete', 'out_of_scope', 'comment']),
    });
  });

  testWidgets('"To do (N)" sits beside "Needs a report" and lists the tasks, each level as an icon, a word and a reason', (tester) async {
    await pump(tester);
    expect(find.byKey(const ValueKey('schedule-filter-todo')), findsOneWidget);
    expect(find.text('To do (2)'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();

    expect(find.textContaining('Write the lesson report: learner_k'), findsOneWidget);
    expect(find.text('Prepare the Juz Amma revision sheet'), findsOneWidget);
    // A row reads as one (the tile merges its parts); the level is in it as words.
    expect(find.bySemanticsLabel(RegExp('Write the lesson report.*High · Overdue', dotAll: true)), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'Juz Amma revision sheet\nMedium\n')), findsOneWidget);
    // The server's order, never re-sorted here.
    expect(tester.getTopLeft(find.textContaining('Write the lesson report')).dy, lessThan(tester.getTopLeft(find.text('Prepare the Juz Amma revision sheet')).dy));
    // The theme's own measured pairs: danger for High, the strong accent on its subtle ground for Medium.
    final high = tester.widget<Text>(find.descendant(of: find.byKey(const ValueKey('task-level-t-report')), matching: find.byType(Text)));
    expect(high.style?.color, JawwidTokens.light.colorStatusDangerFg);
    final medium = tester.widget<Text>(find.descendant(of: find.byKey(const ValueKey('task-level-t-manual')), matching: find.byType(Text)));
    expect(medium.style?.color, JawwidTokens.light.colorAccentStrong);
  });

  testWidgets('reads in Arabic', (tester) async {
    await pump(tester, locale: 'ar');
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel(RegExp('عالية · متأخرة')), findsOneWidget);
    expect(find.textContaining('اكتب تقرير الحصة: learner_k'), findsOneWidget);
  });

  testWidgets('a task the teacher was given offers exactly the server\'s actions; Mark done completes it', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Prepare the Juz Amma revision sheet'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('task-complete')), findsOneWidget);
    expect(find.byKey(const ValueKey('task-not-mine')), findsOneWidget);
    expect(find.byKey(const ValueKey('task-acknowledge')), findsNothing);
    expect(find.textContaining('Given by Teachers Manager'), findsOneWidget, reason: 'the sheet names who gave it');
    await tester.tap(find.byKey(const ValueKey('task-complete')));
    await tester.pumpAndSettle();
    expect(tasks.calls, ['complete t-manual']);
    expect(find.text('Done.'), findsOneWidget);
  });

  testWidgets('"Not mine" sends the teacher\'s reason to their manager', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Prepare the Juz Amma revision sheet'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('task-not-mine')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('task-not-mine-field')), 'This class is not mine');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('task-not-mine-send')));
    await tester.pumpAndSettle();
    expect(tasks.calls, ['out_of_scope t-manual: This class is not mine']);
    expect(find.text('Sent to your manager.'), findsOneWidget);
  });

  testWidgets('a comment is sent as written', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Prepare the Juz Amma revision sheet'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('task-comment-field')), 'Half done');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('task-comment-send')));
    await tester.pumpAndSettle();
    expect(tasks.calls, ['comment t-manual: Half done']);
  });

  testWidgets('a lesson report task opens the lesson itself', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Write the lesson report'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('task-complete')), findsNothing, reason: 'the report itself completes it');
    await tester.tap(find.byKey(const ValueKey('task-open-lesson')));
    await tester.pumpAndSettle();
    expect(lessons.ticketsAskedFor, ['lesson-1']);
  });

  testWidgets('a task whose work went away says so and is acknowledged', (tester) async {
    tasks = _Tasks({
      't-gone': wire('t-gone', kind: 'system', source: 'lesson_report', params: {'learnerName': 'learner_k', 'startsAt': '2026-10-27T15:00:00Z', 'lessonId': 'lesson-1'},
          actions: ['acknowledge', 'out_of_scope'], extra: {'sourceState': 'withdrawn'}),
    });
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    expect(find.textContaining('No longer needed'), findsOneWidget);
    await tester.tap(find.textContaining('Write the lesson report'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('task-open-lesson')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('task-acknowledge')));
    await tester.pumpAndSettle();
    expect(tasks.calls, ['acknowledge t-gone']);
  });

  testWidgets('overdue is said in a word, not by colour alone -- even on a task a person set High', (tester) async {
    tasks = _Tasks({
      't-high': wire('t-high', actions: ['complete'], extra: {'effectivePriority': 'high', 'priorityReason': 'manual', 'overdue': true}),
    });
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('task-overdue')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('task-overdue')), matching: find.text('Overdue')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'High\n')), findsOneWidget, reason: 'the level itself gives no reason: a person set it');
  });

  testWidgets('"Not mine" cannot be sent without a reason', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Prepare the Juz Amma revision sheet'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('task-not-mine')));
    await tester.pumpAndSettle();
    FilledButton send() => tester.widget<FilledButton>(find.byKey(const ValueKey('task-not-mine-send')));
    expect(send().onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('task-not-mine-field')), '   ');
    await tester.pump();
    expect(send().onPressed, isNull, reason: 'spaces are not a reason');
    expect(tasks.calls, isEmpty);
  });

  testWidgets('"Overdue" is said once: not again beside a level whose reason already says it', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel(RegExp('High · Overdue')), findsOneWidget);
    expect(find.byKey(const ValueKey('task-overdue')), findsNothing);
  });

  testWidgets('a list that stops before the server\'s end says so on its count', (tester) async {
    tasks.more = true;
    await pump(tester);
    expect(find.text('To do (2+)'), findsOneWidget);
  });

  testWidgets('in Arabic the list reads right to left: each title starts at the right', (tester) async {
    await pump(tester, locale: 'ar');
    await tester.tap(find.byKey(const ValueKey('schedule-filter-todo')));
    await tester.pumpAndSettle();
    final title = find.text('Prepare the Juz Amma revision sheet');
    expect(Directionality.of(tester.element(title)), TextDirection.rtl);
    final width = tester.getSize(find.byType(TeacherScheduleScreen)).width;
    expect(tester.getTopRight(title).dx, greaterThan(width * 0.75), reason: 'the title hugs the right edge');
    final chip = find.byKey(const ValueKey('task-level-t-manual'));
    expect(tester.getTopRight(chip).dx, greaterThan(width * 0.6), reason: 'the chips start at the right too');
  });

  test('an action this build does not know is never offered', () {
    final t = WorkTask.fromJson(wire('t', actions: ['complete', 'reassign', 'remove', 'something_new']))!;
    expect(t.actions, {TaskAction.complete});
    expect(TaskLevel.parse('weird'), TaskLevel.medium);
  });
}

class _Tasks implements TaskRepository {
  _Tasks(this.rows);

  final Map<String, Map<String, Object?>> rows;
  final calls = <String>[];

  @override
  Future<TaskList> myTasks() async => TaskList([for (final r in rows.values) WorkTask.fromJson(r)!], more: more);

  bool more = false;

  @override
  Future<WorkTask> task(String id) async => WorkTask.fromJson(rows[id])!;

  @override
  Future<void> complete(String id) async => calls.add('complete $id');

  @override
  Future<void> acknowledge(String id) async => calls.add('acknowledge $id');

  @override
  Future<void> outOfScope(String id, String comment) async => calls.add('out_of_scope $id: $comment');

  @override
  Future<void> comment(String id, String body) async => calls.add('comment $id: $body');
}

class _Lessons implements LessonRepository {
  final ticketsAskedFor = <String>[];

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => const [];

  @override
  Future<TeacherWorkload> myWorkload() async => const TeacherWorkload(heldLessons: 0, heldMinutes: 0, unreported: 0);

  @override
  Future<List<LessonTicket>> lessonTickets(String lessonId) async {
    ticketsAskedFor.add(lessonId);
    return const [];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
