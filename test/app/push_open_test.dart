// PD-32 amendment (owner, 2026-11-03): a tap on an ordinary push opens what it is about --
// the exact feedback item for a reply -- whether the app was closed, in the background or
// open. Calls keep their own path. The real app router, signed in as a parent.
import 'dart:async';

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
import 'package:jawwid_chat/core/push/push_opens.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/features/conversations/application/realtime_keeper.dart';
import 'package:jawwid_chat/features/notifications/application/push_open_coordinator.dart';
import 'package:jawwid_chat/features/notifications/data/notifications_repository.dart';
import 'package:jawwid_chat/features/notifications/domain/inbox.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/teacher_feedback.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// Taps, injected; records that Dart said it was listening.
class _FakePushOpens implements PushOpens {
  final _c = StreamController<PushOpen>.broadcast();
  int starts = 0;

  void tap(Map<String, Object?> payload) {
    final open = PushOpen.fromPlatform(payload);
    if (open != null) _c.add(open);
  }

  @override
  Future<void> start() async => starts++;

  int clears = 0;

  @override
  Future<void> clearDelivered() async => clears++;

  @override
  Stream<PushOpen> opens() => _c.stream;
}

const _feedbackPush = {
  'eventType': 'feedback_replied',
  'notificationId': 'n-1',
  'actionKind': 'open_feedback',
  'feedbackId': 'fb-1',
};

void main() {
  group('PushOpen.fromPlatform: only the known keys, only id-shaped values', () {
    test('a feedback reply push', () {
      final o = PushOpen.fromPlatform(_feedbackPush)!;
      expect(o.eventType, 'feedback_replied');
      expect(o.actionKind, 'open_feedback');
      expect(o.feedbackId, 'fb-1');
      expect(o.notificationId, 'n-1');
      expect(o.isCall, isFalse);
    });

    test('a path, a query or a non-string is dropped, never passed to the router', () {
      final o = PushOpen.fromPlatform({
        'eventType': 'feedback_replied',
        'actionKind': 'open_feedback',
        'feedbackId': '../settings/delete-account',
        'conversationId': 'c1?x=1',
        'taskId': 7,
        'title': 'whatever',
      })!;
      expect(o.feedbackId, isNull);
      expect(o.conversationId, isNull);
      expect(o.taskId, isNull);
      expect(PushOpen.fromPlatform({'feedbackId': 'fb-1'}), isNull, reason: 'no event type: not ours');
      expect(PushOpen.fromPlatform('open_feedback'), isNull);
      expect(PushOpen.fromPlatform({'eventType': 'Feedback Replied!'}), isNull);
    });

    test('routes: the entry\'s button for this role, else the conversation, else the Center; a call goes nowhere', () {
      expect(routeForPushOpen(PushOpen.fromPlatform(_feedbackPush)!, UserRole.parent), Routes.feedbackItem('fb-1'));
      // A feedback item is a parent's only: anyone else lands on their Center.
      expect(routeForPushOpen(PushOpen.fromPlatform(_feedbackPush)!, UserRole.teacher), Routes.notifications);
      expect(
        routeForPushOpen(PushOpen.fromPlatform({'eventType': 'message_published', 'conversationId': 'c1'})!, UserRole.parent),
        Routes.conversation('c1'),
      );
      expect(routeForPushOpen(PushOpen.fromPlatform({'eventType': 'payment_d3'})!, UserRole.parent), Routes.notifications);
      expect(
        routeForPushOpen(PushOpen.fromPlatform({'eventType': 'call_started', 'conversationId': 'c1', 'callId': 'k'})!, UserRole.parent),
        isNull,
      );
    });
  });

  group('PlatformPushOpens over its channel', () {
    TestWidgetsFlutterBinding.ensureInitialized();
    const channel = MethodChannel(PlatformPushOpens.channelName);

    test('listens, then delivers each tap the native side hands over', () async {
      final calls = <String>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return null;
      });
      final opens = PlatformPushOpens();
      final got = <PushOpen>[];
      final sub = opens.opens().listen(got.add);
      await opens.start();
      expect(calls, ['listen']);

      Future<void> fromNative(Object? args) => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.handlePlatformMessage(
            PlatformPushOpens.channelName,
            const StandardMethodCodec().encodeMethodCall(MethodCall('onOpen', args)),
            (_) {},
          );
      await fromNative(_feedbackPush);
      await fromNative('garbage');
      await Future<void>.delayed(Duration.zero);
      expect(got.map((o) => o.feedbackId), ['fb-1']);
      await sub.cancel();
      opens.dispose();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('a platform without the native side is not an error', () async {
      final opens = PlatformPushOpens(channel: const MethodChannel('jawwid/push_opens_absent'));
      await opens.start();
      await opens.clearDelivered();
      opens.dispose();
    });
  });

  group('the app opens what was tapped', () {
    late FakeBackend backend;
    late ProviderContainer container;
    late _FakePushOpens taps;
    late FakeFeedbackRepository feedback;
    late FakeNotificationsRepository inbox;

    setUp(() {
      backend = FakeBackend(role: UserRole.parent);
      taps = _FakePushOpens();
      feedback = FakeFeedbackRepository(
        children: const [FeedbackChild(learnerId: 'child-1', name: 'Ahmad', teacherName: 'Ustadh Yusuf')],
        items: [
          FeedbackItem(
            id: 'fb-1',
            learnerId: 'child-1',
            childName: 'Ahmad',
            category: FeedbackCategory.complaint,
            body: 'The lesson was cut short.',
            status: FeedbackStatus.inReview,
            response: 'We spoke with the teacher.',
            respondedAt: DateTime.utc(2026, 11, 2),
            replyUnread: true,
            createdAt: DateTime.utc(2026, 11, 1),
          ),
        ],
      );
      inbox = FakeNotificationsRepository(entries: const [], tabs: const [InboxTab.all]);
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
          feedbackRepositoryProvider.overrideWithValue(feedback),
          notificationsRepositoryProvider.overrideWithValue(inbox),
          pushOpensProvider.overrideWithValue(taps),
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
    String location() => router().routerDelegate.currentConfiguration.last.matchedLocation;

    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 30));
      }
    }

    Future<void> pumpApp(WidgetTester tester) async {
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            routerConfig: router(),
            locale: const Locale('en'),
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
    }

    Future<void> signIn() => container.read(authControllerProvider.notifier).signIn(username: 'parent', password: 'secret');

    testWidgets('closed: the tap that launched the app waits for the stored session, then opens the exact item', (tester) async {
      // A session stored on this phone by an earlier run; this run starts with it unknown.
      await signIn();
      container.invalidate(authControllerProvider);
      expect(container.read(authControllerProvider), isA<AuthUnknown>());

      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      expect(taps.starts, 1, reason: 'Dart says it is listening, so the native side hands over the launch tap');
      // The launch tap arrives while the stored session is still being restored.
      taps.tap(_feedbackPush);
      await pumpApp(tester);
      expect(feedback.seenReplies, isEmpty);

      await container.read(authControllerProvider.notifier).restore();
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(location(), Routes.feedbackItem('fb-1'));
      expect(find.text('We spoke with the teacher.'), findsOneWidget);
      expect(feedback.seenReplies, ['fb-1']);
      expect(inbox.openedPushes, ['n-1']);
    });

    testWidgets('a tap while someone signs in by hand is not theirs: dropped', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await pumpApp(tester);
      taps.tap(_feedbackPush);
      await signIn();
      await settle(tester);
      expect(location(), isNot(Routes.feedbackItem('fb-1')));
      expect(feedback.seenReplies, isEmpty);
    });

    testWidgets('closed, and the session did not come back: the tap is dropped, never carried into the next sign-in', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      taps.tap(_feedbackPush);
      await pumpApp(tester);
      await container.read(authControllerProvider.notifier).restore();
      await settle(tester);

      await signIn();
      await settle(tester);
      expect(location(), isNot(Routes.feedbackItem('fb-1')));
      expect(feedback.seenReplies, isEmpty);
      expect(inbox.openedPushes, isEmpty);
    });

    testWidgets('in the background or open: the tap opens the exact item over where the app was, with a Back', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await signIn();
      await pumpApp(tester);
      router().go(Routes.chats);
      await settle(tester);

      taps.tap(_feedbackPush);
      await settle(tester);
      expect(location(), Routes.feedbackItem('fb-1'));
      expect(router().canPop(), isTrue);
      expect(feedback.seenReplies, ['fb-1']);

      // A second tap while the first item is open opens it again, harmlessly.
      taps.tap(_feedbackPush);
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(location(), Routes.feedbackItem('fb-1'));
    });

    testWidgets('a call push is never routed here: the call path is untouched', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await signIn();
      await pumpApp(tester);
      router().go(Routes.chats);
      await settle(tester);

      taps.tap({'eventType': 'call_started', 'notificationId': 'n-9', 'conversationId': 'c-1', 'callId': 'call-1'});
      await settle(tester);
      expect(location(), Routes.chats);
      expect(inbox.openedPushes, isEmpty);
    });

    testWidgets('another family\'s feedback id opens nothing of theirs: "no longer available", and nothing is marked seen', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await signIn();
      await pumpApp(tester);
      router().go(Routes.chats);
      await settle(tester);

      taps.tap({..._feedbackPush, 'feedbackId': 'someone-elses-item'});
      await settle(tester);
      expect(location(), Routes.feedbackItem('someone-elses-item'));
      expect(find.text('This feedback is no longer available.'), findsOneWidget);
      expect(find.text('We spoke with the teacher.'), findsNothing);
      expect(feedback.seenReplies, isEmpty);
    });

    testWidgets('signing out clears this account\'s notifications from the tray; nothing else does', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await signIn();
      await pumpApp(tester);
      expect(taps.clears, 0);
      await container.read(authControllerProvider.notifier).signOut();
      await settle(tester);
      expect(taps.clears, 1);
    });

    testWidgets('a session found ended at launch (it expired or was revoked while the app was closed) clears the tray too; a failed sign-in does not', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await pumpApp(tester);
      expect(taps.clears, 0);
      await container.read(authControllerProvider.notifier).restore();
      await settle(tester);
      expect(taps.clears, 1);

      await container.read(authControllerProvider.notifier).signIn(username: 'parent', password: '');
      await settle(tester);
      expect(container.read(authControllerProvider), isA<AuthSignedOut>());
      expect(taps.clears, 1);
    });

    testWidgets('a tab is gone to, not pushed (a payment reminder opens the Center\'s own target)', (tester) async {
      final coordinator = startPushOpens(container);
      addTearDown(coordinator.dispose);
      await signIn();
      await pumpApp(tester);
      router().go(Routes.chats);
      await settle(tester);

      taps.tap({'eventType': 'payment_d3', 'notificationId': 'n-2', 'actionKind': 'view_payments'});
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(location(), Routes.subscriptions);
    });
  });
}
