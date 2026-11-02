import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/features/conversations/application/realtime_keeper.dart';
import 'package:jawwid_chat/features/messages/data/message_marks_repository.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Native back navigation (owner, 2026-10-26): "go back to the previous screen by
/// swiping … just like the native back-swipe gesture on iPhones", and the system back
/// gesture on Android.
///
/// Driven through the REAL router and the REAL theme, because that is where the
/// behaviour lives: go_router builds every page from the theme's
/// [PageTransitionsTheme], and a page type, a full-screen dialog or a `PopScope` that
/// refuses is exactly what takes the gesture away.
///
/// The swipe is edge-only, as on an iPhone, and it starts at the LEADING edge: the left
/// in English, the RIGHT in Arabic (the app's default).
void main() {
  late FakeBackend backend;
  late ProviderContainer container;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    final tokens = InMemoryTokenStore();
    final auth = FakeAuthRepository(backend: backend, tokens: tokens);
    container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        realtimeSocketProvider.overrideWithValue(SilentRealtimeSocket()),
        realtimeTokenProvider.overrideWithValue(_NoTokens()),
        chatRealtimeProvider.overrideWithValue(null),
        realtimeKeeperProvider.overrideWithValue(null),
        // Marks routes present, so a long press offers "Select messages".
        messageMarksRepositoryProvider.overrideWithValue(const _Marks()),
        authControllerProvider.overrideWith(
          () => AuthController(repository: auth, tokens: tokens, clearLocalData: () async {}),
        ),
      ],
    );
  });

  tearDown(() {
    container.dispose();
    backend.dispose();
  });

  GoRouter router() => container.read(routerProvider);
  /// The screen on top -- a pushed one included (the configuration's own uri stays at
  /// the base location under an imperative push).
  String location() => router().state.uri.path;

  /// Frames, not `pumpAndSettle`: the shell keeps progress indicators alive while
  /// fixtures load, so the tree never settles by design.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> signIn(WidgetTester tester, {required String language}) async {
    final arabic = language == 'ar';
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          routerConfig: router(),
          // The app's own theme: it carries the page transitions under test.
          theme: JawwidTheme.light(isArabic: arabic),
          locale: Locale(language),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
        ),
      ),
    );
    await settle(tester);
    await container.read(authControllerProvider.notifier).restore();
    await container.read(authControllerProvider.notifier).signIn(username: 'parent', password: 'secret');
    await settle(tester);
    expect(location(), Routes.chats);
  }

  Future<void> push(WidgetTester tester, String to) async {
    unawaited(router().push(to));
    await settle(tester);
    expect(location(), to);
  }

  /// A finger from [x] across the screen, toward the trailing side: rightward in LTR,
  /// leftward in RTL. Moved in steps, as a thumb does, then lifted.
  Future<void> swipe(WidgetTester tester, {required double x, required bool rtl}) async {
    final size = tester.view.physicalSize / tester.view.devicePixelRatio;
    final step = (rtl ? -1 : 1) * size.width / 20;
    final gesture = await tester.startGesture(Offset(x, size.height / 2));
    for (var i = 0; i < 12; i++) {
      await gesture.moveBy(Offset(step, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await gesture.up();
    await settle(tester);
  }

  double width(WidgetTester tester) => tester.view.physicalSize.width / tester.view.devicePixelRatio;

  Future<void> swipeFromLeadingEdge(WidgetTester tester, {required bool rtl}) =>
      swipe(tester, x: rtl ? width(tester) - 4 : 4, rtl: rtl);

  final ios = TargetPlatformVariant.only(TargetPlatform.iOS);

  group('iOS: the edge swipe goes back', () {
    for (final (language, rtl) in [('en', false), ('ar', true)]) {
      final edge = rtl ? 'RIGHT' : 'LEFT';

      testWidgets('[$language] a conversation swipes back to Chats from the $edge edge', (tester) async {
        await signIn(tester, language: language);
        await push(tester, Routes.conversation('c_support'));

        await swipeFromLeadingEdge(tester, rtl: rtl);

        expect(location(), Routes.chats);
        expect(tester.takeException(), isNull);
      }, variant: ios);

      testWidgets('[$language] a conversation\'s info swipes back to the conversation', (tester) async {
        await signIn(tester, language: language);
        await push(tester, Routes.conversation('c_support'));
        await push(tester, Routes.conversationProfile('c_support'));

        await swipeFromLeadingEdge(tester, rtl: rtl);

        expect(location(), Routes.conversation('c_support'));
      }, variant: ios);

      testWidgets('[$language] a tabbed screen (shared media) still swipes back from the edge', (tester) async {
        await signIn(tester, language: language);
        await push(tester, Routes.conversation('c_support'));
        await push(tester, Routes.conversationMedia('c_support'));

        await swipeFromLeadingEdge(tester, rtl: rtl);

        expect(location(), Routes.conversation('c_support'));
      }, variant: ios);

      testWidgets('[$language] a screen pushed from a tab swipes back to that tab', (tester) async {
        await signIn(tester, language: language);
        router().go(Routes.settings);
        await settle(tester);
        await push(tester, Routes.dateTime);

        await swipeFromLeadingEdge(tester, rtl: rtl);

        expect(location(), Routes.settings);
      }, variant: ios);

      testWidgets('[$language] edge-only: a swipe from the middle of the screen stays', (tester) async {
        await signIn(tester, language: language);
        await push(tester, Routes.conversation('c_support'));

        await swipe(tester, x: width(tester) / 2, rtl: rtl);

        expect(location(), Routes.conversation('c_support'));
      }, variant: ios);
    }

    testWidgets('[ar] the LEFT edge is the trailing edge in Arabic: dragging from it does not go back',
        (tester) async {
      await signIn(tester, language: 'ar');
      await push(tester, Routes.conversation('c_support'));

      // From the left edge, toward the right: the English gesture, mirrored wrong.
      await swipe(tester, x: 4, rtl: false);

      expect(location(), Routes.conversation('c_support'));
    }, variant: ios);

    testWidgets('a tab root has nothing beneath it: the swipe leaves the tab where it is', (tester) async {
      await signIn(tester, language: 'en');
      router().go(Routes.calls);
      await settle(tester);

      await swipeFromLeadingEdge(tester, rtl: false);

      expect(location(), Routes.calls);
    }, variant: ios);
  });

  group('Android: the system back', () {
    final android = TargetPlatformVariant.only(TargetPlatform.android);

    /// What the platform sends for the back button or the classic back gesture.
    Future<void> back(WidgetTester tester) async {
      await tester.binding.handlePopRoute();
      await settle(tester);
    }

    testWidgets('leaves a conversation for Chats', (tester) async {
      await signIn(tester, language: 'ar');
      await push(tester, Routes.conversation('c_support'));

      await back(tester);

      expect(location(), Routes.chats);
    }, variant: android);

    testWidgets('in a conversation, Back leaves select mode first, then the conversation', (tester) async {
      await signIn(tester, language: 'en');
      await push(tester, Routes.conversation('c_support'));

      await tester.longPress(find.text('أهلًا بك، كيف يمكننا مساعدتك؟').last);
      await settle(tester);
      await tester.tap(find.text('Select messages'));
      await settle(tester);
      final cancel = find.byTooltip(L10n.of(tester.element(find.byType(Scaffold).last)).cancelSelection);
      expect(cancel, findsOneWidget, reason: 'the selection bar is up');

      await back(tester);
      expect(location(), Routes.conversation('c_support'), reason: 'Back clears the selection; it does not leave');
      expect(cancel, findsNothing, reason: 'and the selection bar is gone');

      await back(tester);
      expect(location(), Routes.chats);
    }, variant: android);

    testWidgets('leaves a screen pushed from a tab for that tab', (tester) async {
      await signIn(tester, language: 'ar');
      router().go(Routes.settings);
      await settle(tester);
      await push(tester, Routes.devices);

      await back(tester);

      expect(location(), Routes.settings);
    }, variant: android);

    testWidgets('on another tab returns to Chats first; on Chats it leaves the app', (tester) async {
      final exits = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'SystemNavigator.pop') exits.add(call);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

      await signIn(tester, language: 'ar');
      router().go(Routes.calls);
      await settle(tester);

      await back(tester);
      expect(location(), Routes.chats, reason: 'Back on a secondary tab goes to the start tab');
      expect(exits, isEmpty);

      await back(tester);
      expect(exits, hasLength(1), reason: 'Back on Chats hands the back to the system: the app closes');
    }, variant: android);

    testWidgets('predictive back (Android 14+): the gesture previews, and committing it goes back',
        (tester) async {
      await signIn(tester, language: 'ar');
      await push(tester, Routes.conversation('c_support'));

      Future<void> send(MethodCall call) async {
        await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
          'flutter/backgesture',
          const StandardMethodCodec().encodeMethodCall(call),
          (_) {},
        );
        await tester.pump(const Duration(milliseconds: 16));
      }

      // In Arabic the back arrow points right; the system gesture can come from either
      // edge, so this one comes from the right.
      await send(const MethodCall('startBackGesture', {
        'touchOffset': [395.0, 300.0],
        'progress': 0.0,
        'swipeEdge': 1,
      }));
      await send(const MethodCall('updateBackGestureProgress', {
        'x': 250.0,
        'y': 300.0,
        'progress': 0.4,
        'swipeEdge': 1,
      }));
      expect(location(), Routes.conversation('c_support'), reason: 'a preview is not a pop');

      await send(const MethodCall('commitBackGesture'));
      await settle(tester);

      expect(location(), Routes.chats);
    }, variant: android);

    testWidgets('a cancelled predictive back stays on the screen', (tester) async {
      await signIn(tester, language: 'ar');
      await push(tester, Routes.conversation('c_support'));

      Future<void> send(MethodCall call) async {
        await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
          'flutter/backgesture',
          const StandardMethodCodec().encodeMethodCall(call),
          (_) {},
        );
        await tester.pump(const Duration(milliseconds: 16));
      }

      await send(const MethodCall('startBackGesture', {
        'touchOffset': [5.0, 300.0],
        'progress': 0.0,
        'swipeEdge': 0,
      }));
      await send(const MethodCall('updateBackGestureProgress', {
        'x': 100.0,
        'y': 300.0,
        'progress': 0.3,
        'swipeEdge': 0,
      }));
      await send(const MethodCall('cancelBackGesture'));
      await settle(tester);

      expect(location(), Routes.conversation('c_support'));
    }, variant: android);
  });

  test('the theme states the native transition for each platform', () {
    for (final theme in [JawwidTheme.light(isArabic: true), JawwidTheme.dark(isArabic: false)]) {
      final builders = theme.pageTransitionsTheme.builders;
      expect(builders[TargetPlatform.iOS], isA<CupertinoPageTransitionsBuilder>());
      expect(builders[TargetPlatform.macOS], isA<CupertinoPageTransitionsBuilder>());
      expect(builders[TargetPlatform.android], isA<PredictiveBackPageTransitionsBuilder>());
    }
  });
}

class _Marks extends NoMessageMarksRepository {
  const _Marks();

  @override
  bool get isAvailable => true;
}

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}
