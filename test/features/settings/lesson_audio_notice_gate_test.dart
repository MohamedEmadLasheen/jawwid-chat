import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/features/settings/data/parent_notice_repository.dart';
import 'package:jawwid_chat/features/settings/presentation/lesson_audio_notice_gate.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

/// PD-48: a family already enrolled is asked ONCE, at its next sign-in, and only while the
/// server holds no acknowledgement of the current notice version (owner 2026-10-29).
void main() {
  late LockWorld world;
  late ProviderContainer container;
  late _FakeNotices notices;

  Future<void> pump(WidgetTester tester, Widget home, {bool needed = true, UserRole role = UserRole.parent}) async {
    world = LockWorld(role: role, storedSession: true);
    notices = _FakeNotices(needed: needed);
    container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      parentNoticeRepositoryProvider.overrideWithValue(notices),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    await container.read(authControllerProvider.notifier).restore();
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
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
        home: home,
      ),
    ));
    await tester.pumpAndSettle();
  }

  const gated = LessonAudioNoticeGate(child: Scaffold(body: Text('home')));

  testWidgets('not yet acknowledged: the notice; OK only once the line is ticked; then it is recorded', (tester) async {
    await pump(tester, gated);
    final dialog = find.byType(LessonAudioNoticeDialog);
    expect(dialog, findsOneWidget);
    expect(find.text('I understand that lesson pronunciation audio is computer-generated and checked by the academy\'s teachers before use.'), findsOneWidget);
    FilledButton ok() => tester.widget<FilledButton>(find.byKey(const ValueKey('lesson-audio-notice-ok')));
    expect(ok().onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-tick')));
    await tester.pump();
    expect(ok().onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-ok')));
    await tester.pumpAndSettle();
    expect(dialog, findsNothing);
    expect(notices.acknowledged, 1);
  });

  testWidgets('the full terms are one tap away from the notice', (tester) async {
    await pump(tester, gated);
    await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-terms')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('lesson-audio-terms')), findsOneWidget);
  });

  testWidgets('already acknowledged: nothing is shown', (tester) async {
    await pump(tester, gated, needed: false);
    expect(find.byType(LessonAudioNoticeDialog), findsNothing);
    expect(notices.asked, 1);
    expect(notices.acknowledged, 0);
  });

  testWidgets('asked once per account per session: the shell built again asks nothing', (tester) async {
    await pump(tester, gated);
    await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-tick')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-ok')));
    await tester.pumpAndSettle();

    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const SizedBox()));
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(localizationsDelegates: [L10n.delegate], home: gated),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(LessonAudioNoticeDialog), findsNothing);
    expect(notices.asked, 1);
  });

  testWidgets('a parent finds About lesson audio in Settings, with its terms', (tester) async {
    await pump(tester, const SettingsScreen(), needed: false);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('settings-lesson-audio')), 200);
    await tester.tap(find.byKey(const ValueKey('settings-lesson-audio')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('lesson-audio-about-body')), findsOneWidget);
    expect(find.text('Terms and privacy'), findsOneWidget);
  });

  testWidgets('a teacher has no About lesson audio row', (tester) async {
    await pump(tester, const SettingsScreen(), needed: false, role: UserRole.teacher);
    // The list is lazy: walk it to the end, looking at every stretch.
    final list = find.byType(Scrollable).first;
    for (var i = 0; i < 30; i++) {
      expect(find.byKey(const ValueKey('settings-lesson-audio'), skipOffstage: false), findsNothing);
      await tester.drag(list, const Offset(0, -300));
      await tester.pumpAndSettle();
    }
    expect(find.text('Sign out', skipOffstage: false), findsWidgets);
  });
}

class _FakeNotices implements ParentNoticeRepository {
  _FakeNotices({required this.needed});

  bool needed;
  int asked = 0;
  int acknowledged = 0;

  @override
  Future<bool> needsLessonAudio() async {
    asked++;
    return needed;
  }

  @override
  Future<void> acknowledgeLessonAudio() async {
    acknowledged++;
    needed = false;
  }
}
