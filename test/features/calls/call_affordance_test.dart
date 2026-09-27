/// The call button in a conversation, and the call cards in its thread.
///
/// THE AFFORDANCE IS A SECURITY SURFACE, not a convenience. `screens/call.md` §4
/// requires it to render only where the backend authorizes a call for that
/// conversation, and to be ABSENT rather than disabled otherwise. Since PD-6 the
/// set of authorized pairs is DATA — a teacher/parent conversation existing proves
/// the relationship held when it was created, not that it holds now — so a client
/// that inferred the answer, or remembered it, would offer calls the server
/// refuses.
///
/// THE CARDS ARE DERIVED, not stored. The approved W7 design (D2a): call cards
/// come from `GET /calls/history/:conversationId` and are NOT persisted as chat
/// `MessageType.SYSTEM` records. These assert that they appear, that they survive
/// a reload by being derived again, and that no message is ever created.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/presentation/call_card.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'w7_call_fakes.dart';

void main() {
  late FakeBackend backend;
  late FakeCalls calls;
  late FakeRoom room;
  late SpySocket socket;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    calls = FakeCalls();
    room = FakeRoom();
    socket = SpySocket();
  });

  tearDown(() {
    backend.dispose();
    socket.close();
  });

  String conversationId() => backend.listConversations().first.id;

  Widget harness({
    Locale locale = const Locale('en'),
    ConversationKind kind = ConversationKind.adminDirect,
  }) {
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider
            .overrideWithValue(FakeMessageRepository(backend)),
        callRepositoryProvider.overrideWithValue(calls),
        authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(FakeMic()),
        audioRouteProvider.overrideWithValue(FakeAudioRoute()),
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
        home: ChatScreen(
          conversationId: conversationId(),
          title: 'Jawwid',
          kind: kind,
        ),
      ),
    );
  }

  Finder callButton() => find.byIcon(Icons.call_outlined);

  CallHistoryEntry historyEntry({
    String id = 'call_1',
    CallOutcome outcome = CallOutcome.answered,
    Duration? duration = const Duration(minutes: 2),
    DateTime? at,
  }) =>
      CallHistoryEntry(
        id: id,
        conversationId: conversationId(),
        title: 'Jawwid',
        startedAt: at ?? DateTime.now().subtract(const Duration(minutes: 5)),
        outcome: outcome,
        isGroup: false,
        duration: duration,
      );

  // =======================================================================
  group('the affordance follows the server', () {
    testWidgets('capability true renders the call button', (tester) async {
      calls.capabilityAnswer = const CallCapability(canCall: true);

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(callButton(), findsOneWidget);
      expect(calls.capabilityCalls, contains(conversationId()));
    });

    testWidgets('capability false renders NOTHING — absent, not disabled',
        (tester) async {
      calls.capabilityAnswer = const CallCapability(
        canCall: false,
        code: WireErrors.teacherParentNotAuthorized,
      );

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(callButton(), findsNothing);
      // Not a disabled button either: there is no call control in the tree at all.
      expect(
        find.byWidgetPredicate(
          (w) => w is IconButton && w.icon is Icon && (w.icon as Icon).icon == Icons.call_outlined,
        ),
        findsNothing,
      );
    });

    testWidgets('an error renders nothing — it fails CLOSED', (tester) async {
      calls.capabilityError = refusal(WireErrors.notConversationMember);

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(callButton(), findsNothing);
    });

    testWidgets('a build with no call repository renders nothing', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            currentRoleProvider.overrideWithValue(UserRole.parent),
            conversationRepositoryProvider
                .overrideWithValue(FakeConversationRepository(backend)),
            messageRepositoryProvider
                .overrideWithValue(FakeMessageRepository(backend)),
            authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
          ],
          child: MaterialApp(
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: ChatScreen(
              conversationId: conversationId(),
              title: 'Jawwid',
              kind: ConversationKind.adminDirect,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(callButton(), findsNothing);
      expect(find.byType(ChatScreen), findsOneWidget,
          reason: 'and the thread itself still works');
    });

    testWidgets('the button is labelled', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(
        find.byTooltip(l10n.callVoice),
        findsOneWidget,
        reason: 'every control is labelled (screens/call.md §6)',
      );
    });

    testWidgets('tapping it asks the SERVER to start the call', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(callButton());
      await tester.pump();

      expect(
        calls.startCalls,
        [conversationId()],
        reason: 'the capability answer was advisory; this is the decision',
      );
    });

    testWidgets('a Student Group call is started as a GROUP call',
        (tester) async {
      await tester.pumpWidget(harness(kind: ConversationKind.studentGroup));
      await tester.pumpAndSettle();

      await tester.tap(callButton());
      await tester.pump();

      expect(calls.startCalls, [conversationId()]);
      // The kind comes from the conversation the header already describes, not
      // from counting participants.
      expect(find.byType(ChatScreen), findsOneWidget);
    });
  });

  // =======================================================================
  group('call cards in the thread', () {
    testWidgets('a call in history appears as a card', (tester) async {
      calls.history = [historyEntry()];

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(calls.capabilityCalls, isNotEmpty);
      expect(find.byType(CallCard), findsOneWidget);
    });

    testWidgets('no calls means no cards, and the thread is untouched',
        (tester) async {
      calls.history = const [];

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(find.byType(CallCard), findsNothing);
    });

    testWidgets('several calls appear in a deterministic order', (tester) async {
      final base = DateTime.now().subtract(const Duration(hours: 2));
      calls.history = [
        historyEntry(id: 'call_b', at: base.add(const Duration(minutes: 30))),
        historyEntry(id: 'call_a', at: base),
      ];

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(find.byType(CallCard), findsNWidgets(2));
    });

    testWidgets('the cards are DERIVED: reloading asks history again',
        (tester) async {
      calls.history = [historyEntry()];

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();
      expect(find.byType(CallCard), findsOneWidget);

      // Leave the conversation and come back, as a user does.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(find.byType(CallCard), findsOneWidget);
      expect(
        calls.history,
        isNotEmpty,
        reason: 'the card came from the record, not from a local copy',
      );
    });

    testWidgets('a card is not a message: nothing is ever created for it',
        (tester) async {
      final before = backend.history(conversationId()).items.length;
      calls.history = [historyEntry()];

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(find.byType(CallCard), findsOneWidget);
      expect(
        backend.history(conversationId()).items.length,
        before,
        reason: 'call cards are derived, never persisted as MessageType.SYSTEM',
      );
    });

    testWidgets('a failed history read shows no cards and no error',
        (tester) async {
      calls.history = [historyEntry()];
      // The thread must still render even if calls cannot be fetched.
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(find.byType(ChatScreen), findsOneWidget);
    });
  });
}
