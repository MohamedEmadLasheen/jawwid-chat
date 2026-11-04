/// RQA-F5 (= CHATSCHED-006, PARENT-019): a card Jawwid posts -- the "New
/// teacher" card of a transfer, authorKind `system` -- has no sender. It used to
/// be drawn with the sender line "Member" and a grey "M" avatar in a group,
/// where every other message shows who wrote it.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

void main() {
  late FakeBackend backend;
  setUp(() => backend = FakeBackend(role: UserRole.parent));
  tearDown(() => backend.dispose());

  Widget harness(String conversationId, {Locale locale = const Locale('en')}) => ProviderScope(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        ],
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
          home: ChatScreen(conversationId: conversationId, title: 'Group', kind: ConversationKind.studentGroup),
        ),
      );

  for (final locale in const [Locale('en'), Locale('ar')]) {
    testWidgets('a system card in a group has no sender line and no avatar (${locale.languageCode})', (tester) async {
      final group = backend.listConversations().firstWhere((c) => c.kind == ConversationKind.studentGroup);
      // A named member writes first, so the card is not a continuation of the
      // same sender: exactly where the "Member" line used to appear.
      backend.appendIncoming(group.id, 'See you on Tuesday', authorId: 'teacher_1', authorName: 'Karim', authorRole: ParticipantRole.teacher);
      backend.appendSystemCard(group.id, 'The new teacher of Lina is Rania');
      await tester.pumpWidget(harness(group.id, locale: locale));
      await tester.pumpAndSettle();

      expect(find.textContaining('The new teacher of Lina is Rania'), findsOneWidget);
      final l10n = L10n.of(tester.element(find.byType(ChatScreen)));
      expect(find.text(l10n.groupMemberUnresolved), findsNothing, reason: 'never "Member" for a card Jawwid posted');
      expect(find.text('Karim'), findsWidgets, reason: 'a person who wrote still shows as the sender');
    });
  }
}
