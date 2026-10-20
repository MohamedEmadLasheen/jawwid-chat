import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/data/scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';
import 'package:jawwid_chat/features/calls/presentation/schedule_call_sheet.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../calls/calls_page_fakes.dart';
import '../calls/w7_call_fakes.dart';
import 'fake_voice_devices.dart';

/// Schedule call from inside a chat (owner request 2026-10-20): the chat's
/// "more" menu, under the same server answer as the call button.
void main() {
  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;
  late RecordingScheduled scheduled;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
    scheduled = RecordingScheduled();
  });
  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
  });

  Widget app({required bool canCall}) {
    final conversation = backend.listConversations().first;
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        callRepositoryProvider.overrideWithValue(
          FakeCalls(capabilityAnswer: CallCapability(canCall: canCall, code: canCall ? null : 'COMM.PARENT_CANNOT_START_GROUP_CALL')),
        ),
        scheduledCallRepositoryProvider.overrideWithValue(scheduled),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: ChatScreen(conversationId: conversation.id, title: conversation.title, conversation: conversation),
      ),
    );
  }

  testWidgets('the menu schedules a call in THIS chat; the server posts the card', (tester) async {
    await tester.pumpWidget(app(canCall: true));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.more_vert));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Schedule call'));
    await tester.pumpAndSettle();
    expect(find.byType(ScheduleCallSheet), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(scheduled.creates, hasLength(1));
    expect(scheduled.creates.single.conversationId, backend.listConversations().first.id);
    expect(scheduled.creates.single.kind, ScheduledCallKind.scheduled);
    expect(find.byType(ScheduleCallSheet), findsNothing);
  });

  testWidgets('absent, not disabled, when the server says this viewer may not call here', (tester) async {
    await tester.pumpWidget(app(canCall: false));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.more_vert), findsNothing);
    expect(find.text('Schedule call'), findsNothing);
  });
}
