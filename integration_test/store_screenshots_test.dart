/// LR-09j: the store screenshots, taken from the REAL app with no server and no
/// real person.
///
/// The whole app is pumped -- `JawwidApp`, its router, its gates, the call
/// presenter -- exactly as `lib/main.dart` does, on the development fixture
/// composition (`lib/app/bootstrap.dart` `_fakeOverrides`) with the data replaced
/// by `screenshot_fixtures.dart`: synthetic, localized, initials only (LR-10, G-20).
///
/// This is NOT part of `flutter test` (it lives outside `test/`). It runs on a
/// simulator or emulator through `flutter drive`, which saves each screenshot on
/// the host -- see `scripts/store-screenshots/` and
/// `docs/release/store-screenshots.md`.
///
/// Each language is a separate test, so a run starts every language from a clean
/// app: nothing (locale, drafts, call state) carries over from one to the next.
library;

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/call_native/call_native_providers.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_authenticator.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/data/account_call_history.dart';
import 'package:jawwid_chat/features/calls/data/fake_scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/data/scheduled_call_repository.dart';
import 'package:jawwid_chat/features/messages/application/drafts_controller.dart';
import 'package:jawwid_chat/features/messages/data/draft_store.dart';
import 'package:jawwid_chat/features/notifications/data/notifications_repository.dart';
import 'package:jawwid_chat/features/sessions/data/account_sessions_repository.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:jawwid_chat/shared/utils/western_digits.dart';

import 'host_capture.dart';
import 'screenshot_fakes.dart';
import 'screenshot_fixtures.dart';

/// Arabic first: it is the primary language (AGENTS.md) and the primary listing.
const _languages = ['ar', 'en'];

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // DD-09 / RQA-F3, as lib/main.dart: Western digits everywhere.
  useWesternDigits();
  // The host driver captures each screen with the platform tool (status bar
  // included); see host_capture.dart.
  HostCapture.instance.register();

  final platform = Platform.isIOS ? 'ios' : 'android';

  for (final lang in _languages) {
    testWidgets('store screenshots: parent, $lang', (tester) async {
      final run = await _Run.start(tester, binding, platform: platform, lang: lang, role: UserRole.parent);
      final router = run.router;

      // 1. The chat list: the family groups, the supervisor, Jawwid support.
      router.go(Routes.chats);
      await run.shot('01_chats');

      // 2. The family group, as the parent reads it.
      router.push(Routes.conversation(ShotIds.familyGroup));
      await run.shot('02_conversation_parent');

      // 3. The Calls tab: the lesson calls in the group and a call with the supervisor.
      router.go(Routes.calls);
      await run.shot('03_calls');

      // 4. The child's lesson schedule (weekly times and the coming lessons).
      router.go(Routes.chats);
      await run.settle();
      router.push(Routes.childSchedule(ShotIds.childId), extra: run.data.childName);
      await run.shot('04_schedule_parent');

      // 5. Settings (App lock, Language, ...), and 6. Delete account.
      router.go(Routes.settings);
      await run.shot('05_settings');
      router.push(Routes.deleteAccount);
      await run.shot('06_delete_account');

      // 7. The lesson call: the teacher calls the family group, the parent answers.
      // Last, because the call screen stays over everything until it ends.
      router.go(Routes.chats);
      await run.settle();
      await run.answerIncomingLessonCall();
      await run.shot('07_call', settleFor: const Duration(seconds: 4));

      await run.finish();
    });

    testWidgets('store screenshots: teacher, $lang', (tester) async {
      final run = await _Run.start(tester, binding, platform: platform, lang: lang, role: UserRole.teacher);
      final router = run.router;

      // 8. The teacher's chat list.
      router.go(Routes.chats);
      await run.shot('08_chats_teacher');

      // 9. The same family group, as the teacher reads it.
      router.push(Routes.conversation(ShotIds.familyGroup));
      await run.shot('09_conversation_teacher');

      // 10. The teacher's Schedule tab.
      router.go(Routes.schedule);
      await run.shot('10_schedule_teacher');

      await run.finish();
    });
  }
}

/// One signed-in app, in one language, for one role.
class _Run {
  _Run._(this.tester, this.binding, this.container, this.socket, this.data, this.platform, this.lang);

  final WidgetTester tester;
  final IntegrationTestWidgetsFlutterBinding binding;
  final ProviderContainer container;
  final ScriptedSocket socket;
  final ShotData data;
  final String platform;
  final String lang;

  _Nav get router => _Nav(container);

  static Future<_Run> start(
    WidgetTester tester,
    IntegrationTestWidgetsFlutterBinding binding, {
    required String platform,
    required String lang,
    required UserRole role,
  }) async {
    final data = ShotData(arabic: lang == 'ar', role: role);
    final backend = shotBackend(data);
    final tokens = await signedInTokenStore();
    final auth = ShotAuthRepository(backend: backend, tokens: tokens, data: data);
    final socket = ScriptedSocket();
    final drafts = InMemoryDraftStore();
    final calls = ShotCallRepository();

    final container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        localeOverrideProvider.overrideWith(() => FixedLocale(Locale(lang))),
        themeModeProvider.overrideWith(LightThemeMode.new),
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        conversationRepositoryProvider.overrideWithValue(ShotConversationRepository(backend, data)),
        messageRepositoryProvider.overrideWithValue(ShotMessageRepository(backend, data)),
        groupRepositoryProvider.overrideWithValue(ShotGroupRepository(backend, data)),
        lessonRepositoryProvider.overrideWithValue(ShotLessonRepository(data)),
        profileRepositoryProvider.overrideWithValue(FakeProfileRepository(initial: data.parentProfile)),
        // Calls: answered locally, a silent room, a granted microphone, no CallKit /
        // ConnectionService screen (it would cover the in-app call screen).
        callRepositoryProvider.overrideWithValue(calls),
        accountCallHistoryProvider.overrideWithValue(ShotCallHistory(data)),
        scheduledCallRepositoryProvider.overrideWithValue(
          FakeScheduledCallRepository(
            startCall: (conversationId) async => (await calls.start(conversationId: conversationId)).callId,
          ),
        ),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(const ShotTokens()),
        mediaRoomFactoryProvider.overrideWithValue(SilentRoom.new),
        microphonePermissionProvider.overrideWithValue(GrantedMicrophone()),
        audioRouteProvider.overrideWithValue(ShotAudioRoute()),
        callPresentationProvider.overrideWithValue(null),
        // App lock: offered as a normal option in Settings, never locking.
        appLockAuthenticatorProvider.overrideWithValue(AvailableAuthenticator()),
        appLockStoreProvider.overrideWithValue(InMemoryAppLockStore()),
        // The rest as the development fixture root has them, emptied where the
        // fixture would show its own placeholder text.
        accountSessionsRepositoryProvider.overrideWithValue(FakeAccountSessionsRepository()),
        notificationsRepositoryProvider.overrideWithValue(FakeNotificationsRepository(entries: const [])),
        billingRepositoryProvider.overrideWithValue(const FakeBillingRepository()),
        feedbackRepositoryProvider.overrideWithValue(FakeFeedbackRepository()),
        moderationRepositoryProvider.overrideWithValue(FakeModerationRepository()),
        blockRepositoryProvider.overrideWithValue(FakeBlockRepository()),
        whiteboardsRepositoryProvider.overrideWithValue(FakeWhiteboardsRepository()),
        draftStoreProvider.overrideWithValue(drafts),
        authControllerProvider.overrideWith(
          () => AuthController(repository: auth, tokens: tokens, clearLocalData: drafts.clearAll),
        ),
      ],
    );

    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const JawwidApp()));
    // A returning user: the stored session is restored, as lib/main.dart does at launch.
    await container.read(authControllerProvider.notifier).restore();

    final run = _Run._(tester, binding, container, socket, data, platform, lang);
    // Android renders to a surface the screenshot cannot read until it is an image.
    // Reverted by the binding when the test ends.
    if (Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
    await run.settle(const Duration(seconds: 3));
    return run;
  }

  /// Lets real time pass while frames are drawn: loads resolve, routes finish
  /// their transitions. Not `pumpAndSettle`: a live call's timer never settles.
  Future<void> settle([Duration time = const Duration(seconds: 2)]) async {
    final end = DateTime.now().add(time);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  /// Saved by the driver as `<platform>/<lang>/<name>.png`: captured on the host
  /// by the platform tool (the whole screen, status bar included) while the test
  /// waits here; the in-app screenshot (the app's view only, no status bar) only
  /// if that capture fails. The driver records which one was used.
  Future<void> shot(String name, {Duration settleFor = const Duration(seconds: 2)}) async {
    // No caret and no keyboard in a store screenshot.
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(settleFor);
    final id = '$platform/$lang/$name';
    if (await HostCapture.instance.capture(id)) return;
    await binding.takeScreenshot(id);
  }

  /// The frame the server sends when the teacher starts the lesson call in the
  /// family group, then the parent's Accept.
  Future<void> answerIncomingLessonCall() async {
    socket.emit(CallEventNames.incoming, {
      'callId': ShotIds.callId,
      'conversationId': ShotIds.familyGroup,
      'type': 'group',
      'initiatorId': ShotIds.teacherId,
      'initiatorName': data.callerName,
    });
    await settle();
    await container.read(callControllerProvider.notifier).accept();
  }

  Future<void> finish() async {
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
    await socket.close();
  }
}

/// The app's own router, read from the container the app runs in.
class _Nav {
  _Nav(this._container);

  final ProviderContainer _container;

  void go(String location) => _container.read(routerProvider).go(location);

  /// Pushed without waiting for the route's result: it is never popped here.
  void push(String location, {Object? extra}) =>
      _container.read(routerProvider).push<Object?>(location, extra: extra).ignore();
}
