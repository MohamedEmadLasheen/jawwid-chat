import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
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

  Future<void> pump(WidgetTester tester, Widget home, {bool needed = true, UserRole role = UserRole.parent, ParentNoticeRepository? repository}) async {
    world = LockWorld(role: role, storedSession: true);
    notices = _FakeNotices(needed: needed);
    container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      parentNoticeRepositoryProvider.overrideWithValue(repository ?? notices),
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

  testWidgets('shown once per account per session, even when the record did not reach the server', (tester) async {
    await pump(tester, gated);
    notices.failAcknowledge = true;
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
    // The server still says "needed": the next sign-in asks again.
    expect(notices.needed, isTrue);
  });

  group('over HTTP: what the server answers decides', () {
    /// The real repository, on an in-memory server answering GET /parent-notices with [notices].
    (HttpParentNoticeRepository, List<RequestOptions>) server(List<Map<String, Object?>> notices) {
      final requests = <RequestOptions>[];
      final dio = Dio(BaseOptions(baseUrl: 'https://api.example/api/v1'));
      dio.httpClientAdapter = _Adapter((options) {
        requests.add(options);
        return _json(options.method == 'GET' ? {'notices': notices} : {'key': 'lesson_audio', 'version': 1, 'acknowledged': true});
      });
      return (HttpParentNoticeRepository(client: ApiClient(dio: dio, tokens: _Tokens())), requests);
    }

    testWidgets('the current version, not acknowledged: the notice, and OK posts that version', (tester) async {
      final (repo, requests) = server([{'key': 'lesson_audio', 'version': kLessonAudioNoticeVersion, 'acknowledged': false}]);
      await pump(tester, gated, repository: repo);
      expect(find.byType(LessonAudioNoticeDialog), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-tick')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('lesson-audio-notice-ok')));
      await tester.pumpAndSettle();
      expect(requests.map((r) => '${r.method} ${r.path} ${r.data ?? ''}'), ['GET /parent-notices ', 'POST /parent-notices/lesson_audio/acknowledge {version: 1}']);
    });

    testWidgets('another version than this app shows: no prompt, nothing posted', (tester) async {
      final (repo, requests) = server([{'key': 'lesson_audio', 'version': kLessonAudioNoticeVersion + 1, 'acknowledged': false}]);
      await pump(tester, gated, repository: repo);
      expect(find.byType(LessonAudioNoticeDialog), findsNothing);
      expect(requests.map((r) => r.method), ['GET']);
    });

    testWidgets('a support session (PD-21): the server lists no notice, so nothing is shown', (tester) async {
      final (repo, requests) = server([]);
      await pump(tester, gated, repository: repo);
      expect(find.byType(LessonAudioNoticeDialog), findsNothing);
      expect(requests.map((r) => r.method), ['GET']);
    });
  });

  testWidgets('an answer that arrives after the account changed is dropped', (tester) async {
    final slow = _SlowNotices();
    await pump(tester, gated, repository: slow);
    await container.read(authControllerProvider.notifier).signOut();
    slow.answer.complete(true);
    await tester.pumpAndSettle();
    expect(find.byType(LessonAudioNoticeDialog), findsNothing);
  });

  testWidgets('a build with no API asks nothing', (tester) async {
    world = LockWorld(role: UserRole.parent, storedSession: true);
    container = ProviderContainer(overrides: [...world.overrides(), themeModeStoreProvider.overrideWithValue(FakeThemeModeStore())]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    await container.read(authControllerProvider.notifier).restore();
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(localizationsDelegates: [L10n.delegate], home: gated),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(LessonAudioNoticeDialog), findsNothing);
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
  bool failAcknowledge = false;
  int asked = 0;
  int acknowledged = 0;

  @override
  Future<bool> needsLessonAudio() async {
    asked++;
    return needed;
  }

  @override
  Future<void> acknowledgeLessonAudio() async {
    if (failAcknowledge) throw StateError('offline');
    acknowledged++;
    needed = false;
  }
}

class _SlowNotices implements ParentNoticeRepository {
  final answer = Completer<bool>();

  @override
  Future<bool> needsLessonAudio() => answer.future;

  @override
  Future<void> acknowledgeLessonAudio() async {}
}

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'a';
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

class _Adapter implements HttpClientAdapter {
  _Adapter(this.handler);
  final ResponseBody Function(RequestOptions options) handler;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (requestStream != null) await requestStream.drain<void>();
    return handler(options);
  }
}

ResponseBody _json(Map<String, Object?> body) =>
    ResponseBody.fromString(jsonEncode(body), 200, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
