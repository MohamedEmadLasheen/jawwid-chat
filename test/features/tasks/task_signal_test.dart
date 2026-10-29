import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/features/notifications/domain/inbox.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_center_screen.dart';
import 'package:jawwid_chat/features/tasks/application/task_signal_channel.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:jawwid_chat/shared/models/work_task.dart';

/// PD-47 PR-4: `task.changed` refreshes the teacher's To do, and a task's
/// notification opens it. Signals only: the list is re-read through its own route.
void main() {
  test('only a task.changed frame naming a task is a task signal', () {
    expect(decodeTaskSignal('task.changed', {'taskId': 't-1', 'revision': 2, 'change': 'reassigned'}), 't-1');
    expect(decodeTaskSignal('task.changed', {'revision': 2}), isNull);
    expect(decodeTaskSignal('task.changed', 'garbage'), isNull);
    expect(decodeTaskSignal('message.created', {'taskId': 't-1'}), isNull);
  });

  test('a task notification opens the teacher\'s Schedule, and nothing for a role with no Tasks screen', () {
    const action = InboxAction(InboxActionKind.openTask, taskId: 't-1');
    expect(InboxActionKind.tryParse('open_task'), InboxActionKind.openTask);
    expect(routeFor(action, UserRole.teacher), Routes.schedule);
    expect(routeFor(action, UserRole.parent), isNull);
  });

  testWidgets('a task.changed frame makes the To do read the list again', (tester) async {
    final socket = _Socket();
    final tasks = _Tasks();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        lessonRepositoryProvider.overrideWithValue(_Lessons()),
        taskRepositoryProvider.overrideWithValue(tasks),
        taskSignalChannelProvider.overrideWith((ref) {
          final channel = TaskSignalChannel(socket);
          ref.onDispose(channel.dispose);
          return channel;
        }),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const TeacherScheduleScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('To do (0)'), findsOneWidget);
    tasks.rows = [WorkTask.fromJson({'id': 't-1', 'kind': 'manual', 'title': 'Prepare the revision sheet', 'effectivePriority': 'medium'})!];
    socket.frames$.add(const RealtimeFrame('task.changed', {'taskId': 't-1', 'revision': 1, 'change': 'created'}));
    await tester.pumpAndSettle();
    expect(find.text('To do (1)'), findsOneWidget);
    expect(tasks.reads, 2);
    // Any other frame changes nothing.
    socket.frames$.add(const RealtimeFrame('typing.started', {'conversationId': 'c-1'}));
    await tester.pumpAndSettle();
    expect(tasks.reads, 2);
  });
}

class _Socket implements RealtimeSocket {
  final frames$ = StreamController<RealtimeFrame>.broadcast();

  @override
  Stream<RealtimeFrame> get frames => frames$.stream;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class _Tasks implements TaskRepository {
  List<WorkTask> rows = const [];
  int reads = 0;

  @override
  Future<TaskList> myTasks() async {
    reads += 1;
    return TaskList(rows);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class _Lessons implements LessonRepository {
  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => const [];

  @override
  Future<TeacherWorkload> myWorkload() async => const TeacherWorkload(heldLessons: 0, heldMinutes: 0, unreported: 0);

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
