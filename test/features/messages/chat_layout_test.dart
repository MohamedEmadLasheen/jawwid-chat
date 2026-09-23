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
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// Mobile-first layout, at the sizes people actually hold (§23).
///
/// The default test surface is 800×600 — a landscape tablet nobody uses, and
/// wide enough to hide every overflow this product can have. These pump the
/// same screens at real phone dimensions, in both languages, and fail on any
/// overflow.
///
/// Arabic is not a second pass here, it is half the matrix: Arabic sets taller
/// than Latin in IBM Plex Sans Arabic, so a sheet that fits in English can
/// overflow in Arabic — which is exactly what happened to the actions sheet,
/// and is why these exist.
void main() {
  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;

  /// The smallest phone still supported, and a current one.
  const phones = <String, Size>{
    'iPhone SE': Size(375, 667),
    'iPhone 17': Size(393, 852),
  };

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
  });

  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
  });

  Future<void> onPhone(
    WidgetTester tester,
    Size size,
    Future<void> Function() body,
  ) async {
    tester.view.physicalSize = size * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await body();
  }

  Widget harness(Locale locale) {
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider
            .overrideWithValue(FakeMessageRepository(backend)),
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
          conversationId: backend.listConversations().first.id,
          title: 'جَوِّد',
        ),
      ),
    );
  }

  for (final locale in [const Locale('ar'), const Locale('en')]) {
    for (final phone in phones.entries) {
      group('${locale.languageCode} on ${phone.key}', () {
        testWidgets('the conversation lays out with nothing overflowing',
            (tester) async {
          await onPhone(tester, phone.value, () async {
            await tester.pumpWidget(harness(locale));
            await tester.pumpAndSettle();

            expect(find.byType(MessageBubble), findsWidgets);
            expect(tester.takeException(), isNull);
          });
        });

        testWidgets('the actions sheet fits', (tester) async {
          await onPhone(tester, phone.value, () async {
            await tester.pumpWidget(harness(locale));
            await tester.pumpAndSettle();

            await tester.longPress(find.byType(MessageBubble).first);
            await tester.pumpAndSettle();

            // Every reaction is reachable without scrolling the row itself.
            for (final emoji in ['❤️', '👍', '😂', '😢', '😮', '👏']) {
              expect(find.text(emoji), findsOneWidget, reason: emoji);
            }
            expect(tester.takeException(), isNull);
          });
        });

        testWidgets('the attach menu fits', (tester) async {
          await onPhone(tester, phone.value, () async {
            await tester.pumpWidget(harness(locale));
            await tester.pumpAndSettle();

            await tester.tap(find.byIcon(Icons.add));
            await tester.pumpAndSettle();

            expect(tester.takeException(), isNull);
          });
        });

        testWidgets('the composer stays above the keyboard', (tester) async {
          await onPhone(tester, phone.value, () async {
            await tester.pumpWidget(harness(locale));
            await tester.pumpAndSettle();

            final before = tester.getRect(find.byType(TextField));

            // A keyboard, as the platform reports one.
            tester.view.viewInsets = const FakeViewPadding(bottom: 336 * 3);
            addTearDown(tester.view.resetViewInsets);
            await tester.pumpAndSettle();

            final after = tester.getRect(find.byType(TextField));
            expect(
              after.bottom,
              lessThan(before.bottom),
              reason: '§23 — the keyboard must never cover the composer',
            );
            expect(
              after.bottom,
              lessThanOrEqualTo(phone.value.height - 336),
              reason: 'the field sits above the keyboard, not under it',
            );
            expect(tester.takeException(), isNull);
          });
        });

        testWidgets('every touch target clears the 48dp floor', (tester) async {
          await onPhone(tester, phone.value, () async {
            await tester.pumpWidget(harness(locale));
            await tester.pumpAndSettle();

            await tester.longPress(find.byType(MessageBubble).first);
            await tester.pumpAndSettle();

            // The reaction row is the densest thing in the product: six targets
            // across the narrowest phone. §30 sets the floor at 48dp and this is
            // where it is most likely to be missed.
            for (final emoji in ['❤️', '👏']) {
              final size = tester.getSize(
                find.ancestor(
                  of: find.text(emoji),
                  matching: find.byType(Container),
                ).first,
              );
              expect(size.width, greaterThanOrEqualTo(48), reason: emoji);
              expect(size.height, greaterThanOrEqualTo(48), reason: emoji);
            }
          });
        });
      });
    }
  }
}
