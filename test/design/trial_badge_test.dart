import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/design/widgets/trial_badge.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../features/messages/fake_voice_devices.dart';

/// PD-32: a trial group carries a "Trial" label wherever it is named -- the chat list,
/// the chat header and Group info -- and a regular student group carries none.
void main() {
  final now = DateTime.utc(2026, 10, 26, 12);

  Conversation conv({required bool trial}) => Conversation(
        id: trial ? 'c_trial' : 'c_group',
        kind: ConversationKind.studentGroup,
        title: trial ? 'خديجة' : 'مجموعة أحمد',
        isTrialGroup: trial,
        namedByServer: true,
        updatedAt: now,
        lastMessageAt: now,
        lastMessagePreview: 'السلام عليكم',
      );

  Widget app(Widget home, {Locale locale = const Locale('ar'), List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: home,
      ),
    );
  }

  group('the chat list row', () {
    testWidgets('a trial group says "تجريبية" beside its name, in its own colours', (tester) async {
      await tester.pumpWidget(app(Scaffold(body: ConversationTile(conversation: conv(trial: true), now: now))));
      await tester.pumpAndSettle();

      expect(find.byType(TrialBadge), findsOneWidget);
      expect(find.text('تجريبية'), findsOneWidget);
      final label = tester.widget<Text>(find.text('تجريبية'));
      expect(label.style?.color, JawwidTokens.light.trialBadgeFg);
      // Read out with the row, not only drawn.
      expect(find.bySemanticsLabel(RegExp('تجريبية')), findsOneWidget);
    });

    testWidgets('in English it reads "Trial"', (tester) async {
      await tester.pumpWidget(app(
        Scaffold(body: ConversationTile(conversation: conv(trial: true), now: now)),
        locale: const Locale('en'),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Trial'), findsOneWidget);
    });

    testWidgets('a regular student group has no label', (tester) async {
      await tester.pumpWidget(app(Scaffold(body: ConversationTile(conversation: conv(trial: false), now: now))));
      await tester.pumpAndSettle();
      expect(find.byType(TrialBadge), findsNothing);
    });
  });

  group('the chat header', () {
    late FakeBackend backend;
    late FakeVoiceRecorder recorder;
    late FakeVoicePlayer player;

    setUp(() {
      backend = FakeBackend(role: UserRole.teacher);
      recorder = FakeVoiceRecorder();
      player = FakeVoicePlayer();
    });
    tearDown(() {
      recorder.dispose();
      player.dispose();
      backend.dispose();
    });

    Widget chat({required bool trial}) => app(
          ChatScreen(
            conversationId: backend.listConversations().first.id,
            title: 'خديجة',
            kind: ConversationKind.studentGroup,
            isTrialGroup: trial,
          ),
          overrides: [
            currentRoleProvider.overrideWithValue(UserRole.teacher),
            voiceRecorderProvider.overrideWithValue(recorder),
            voicePlayerProvider.overrideWithValue(player),
            conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
            messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          ],
        );

    testWidgets('a trial group is labelled in the header', (tester) async {
      await tester.pumpWidget(chat(trial: true));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byType(AppBar), matching: find.byType(TrialBadge)), findsOneWidget);
    });

    testWidgets('a regular group is not', (tester) async {
      await tester.pumpWidget(chat(trial: false));
      await tester.pumpAndSettle();
      expect(find.byType(TrialBadge), findsNothing);
    });
  });

  group('Group info', () {
    for (final trial in [true, false]) {
      testWidgets(trial ? 'a trial group is labelled under its name' : 'a regular group is not labelled', (tester) async {
        final view = ProfileViewBuilder.forConversation(
          conversation: conv(trial: trial),
          viewerRole: UserRole.teacher,
        );
        expect(view.isTrialGroup, trial);
        await tester.pumpWidget(app(Scaffold(body: ProfileHeader(view: view))));
        await tester.pumpAndSettle();
        expect(find.byType(TrialBadge), trial ? findsOneWidget : findsNothing);
      });
    }
  });
}
