import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
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
import 'package:jawwid_chat/features/messages/presentation/swipe_to_reply.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

Widget _app(Widget home, {bool rtl = false, TargetPlatform? platform}) => MaterialApp(
      locale: Locale(rtl ? 'ar' : 'en'),
      theme: JawwidTheme.light(isArabic: rtl).copyWith(platform: platform),
      supportedLocales: JawwidApp.supportedLocales,
      localizationsDelegates: const [
        L10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: home,
    );

/// A full-width row, as a message is.
Widget _row({required VoidCallback onReply, bool enabled = true}) => SwipeToReply(
      enabled: enabled,
      onReply: onReply,
      child: const SizedBox(height: 80, width: double.infinity, child: ColoredBox(color: Colors.blue)),
    );

double _width(WidgetTester tester) => tester.view.physicalSize.width / tester.view.devicePixelRatio;

/// A thumb from [x], [by] pixels toward the right (negative: the left), in steps.
Future<void> _drag(WidgetTester tester, {required double x, required double by, double y = 40}) async {
  final gesture = await tester.startGesture(Offset(x, y));
  for (var i = 0; i < 10; i++) {
    await gesture.moveBy(Offset(by / 10, 0));
    await tester.pump(const Duration(milliseconds: 16));
  }
  await gesture.up();
  await tester.pumpAndSettle();
}

void main() {
  group('PD-37 SwipeToReply', () {
    for (final rtl in [false, true]) {
      final lang = rtl ? 'ar' : 'en';
      final toward = rtl ? -1.0 : 1.0; // the trailing side

      testWidgets('[$lang] past the threshold toward the trailing side: a reply, once', (tester) async {
        var replies = 0;
        await tester.pumpWidget(_app(Scaffold(body: Align(alignment: Alignment.topCenter, child: _row(onReply: () => replies++))), rtl: rtl));
        await _drag(tester, x: _width(tester) / 2, by: toward * 90);
        expect(replies, 1);
      });

      testWidgets('[$lang] short of the threshold, or toward the leading side: nothing', (tester) async {
        var replies = 0;
        await tester.pumpWidget(_app(Scaffold(body: Align(alignment: Alignment.topCenter, child: _row(onReply: () => replies++))), rtl: rtl));
        await _drag(tester, x: _width(tester) / 2, by: toward * (SwipeToReply.threshold - 20));
        await _drag(tester, x: _width(tester) / 2, by: -toward * 90);
        expect(replies, 0);
      });

      testWidgets('[$lang] a touch in the leading ${SwipeToReply.backGestureEdge.toInt()}pt is left to the back gesture: '
          'not claimed, no reply', (tester) async {
        var replies = 0;
        var parentDrags = 0;
        await tester.pumpWidget(_app(
          Scaffold(
            body: Align(
              alignment: Alignment.topCenter,
              // Stands in for the route's back-swipe detector above the list.
              child: GestureDetector(
                onHorizontalDragEnd: (_) => parentDrags++,
                child: _row(onReply: () => replies++),
              ),
            ),
          ),
          rtl: rtl,
        ));
        final leadingEdge = rtl ? _width(tester) - 6 : 6.0;
        await _drag(tester, x: leadingEdge, by: toward * 120);
        expect(replies, 0);
        expect(parentDrags, 1, reason: 'the drag went to the back gesture, not to the message');
      });

      testWidgets('[$lang] the back gesture is the only one left out: a swipe just past the strip replies', (tester) async {
        var replies = 0;
        await tester.pumpWidget(_app(Scaffold(body: Align(alignment: Alignment.topCenter, child: _row(onReply: () => replies++))), rtl: rtl));
        final justInside = rtl ? _width(tester) - SwipeToReply.backGestureEdge - 6 : SwipeToReply.backGestureEdge + 6;
        await _drag(tester, x: justInside, by: toward * 90);
        expect(replies, 1);
      });
    }

    testWidgets('disabled: no swipe, no reply action for screen readers', (tester) async {
      var replies = 0;
      await tester.pumpWidget(_app(Scaffold(body: Align(alignment: Alignment.topCenter, child: _row(onReply: () => replies++, enabled: false)))));
      await _drag(tester, x: _width(tester) / 2, by: 90);
      expect(replies, 0);
    });

    testWidgets('one haptic tick when the reply is armed, not one per frame', (tester) async {
      final haptics = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') haptics.add(call.arguments as String);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await tester.pumpWidget(_app(Scaffold(body: Align(alignment: Alignment.topCenter, child: _row(onReply: () {})))));
      await _drag(tester, x: _width(tester) / 2, by: 120);
      expect(haptics, ['HapticFeedbackType.selectionClick']);
    });

    testWidgets('screen readers get a Reply action', (tester) async {
      final semantics = tester.ensureSemantics();
      var replies = 0;
      await tester.pumpWidget(_app(Scaffold(body: Align(alignment: Alignment.topCenter, child: _row(onReply: () => replies++)))));
      final node = tester.getSemantics(find.byType(SwipeToReply));
      final action = node.getSemanticsData().customSemanticsActionIds!.single;
      tester.binding.performSemanticsAction(SemanticsActionEvent(
        type: SemanticsAction.customAction,
        viewId: tester.view.viewId,
        nodeId: node.id,
        arguments: action,
      ));
      expect(replies, 1);
      semantics.dispose();
    });
  });

  group('PD-37 swipe-to-reply never takes the iOS back swipe (#141)', () {
    for (final rtl in [false, true]) {
      final lang = rtl ? 'ar' : 'en';
      testWidgets('[$lang] from the leading edge, ON a message: the page goes back; from the middle: a reply', (tester) async {
        var replies = 0;
        await tester.pumpWidget(_app(
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                    builder: (_) => Scaffold(
                      appBar: AppBar(title: const Text('conversation')),
                      body: ListView(children: [for (var i = 0; i < 8; i++) _row(onReply: () => replies++)]),
                    ),
                  )),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
          rtl: rtl,
          platform: TargetPlatform.iOS,
        ));
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        expect(find.text('conversation'), findsOneWidget);

        final toward = rtl ? -1.0 : 1.0;
        await _drag(tester, x: _width(tester) / 2, by: toward * 90, y: 200);
        expect(replies, 1);
        expect(find.text('conversation'), findsOneWidget, reason: 'a reply, not a back');

        await _drag(tester, x: rtl ? _width(tester) - 4 : 4, by: toward * _width(tester) * 0.6, y: 200);
        expect(find.text('conversation'), findsNothing, reason: 'the edge swipe went back');
        expect(replies, 1);
      });
    }
  });

  group('PD-37 the chat screen', () {
    testWidgets('swiping a message makes it the one being replied to', (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      final recorder = FakeVoiceRecorder();
      final player = FakeVoicePlayer();
      final conversationId = backend.listConversations().first.id;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          voiceRecorderProvider.overrideWithValue(recorder),
          voicePlayerProvider.overrideWithValue(player),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        ],
        child: _app(ChatScreen(conversationId: conversationId, title: 'Jawwid')),
      ));
      await tester.pumpAndSettle();
      final l10n = lookupL10n(const Locale('en'));

      final bubble = find.byType(MessageBubble).last;
      final message = tester.widget<MessageBubble>(bubble).message;
      expect(find.text(l10n.replyingTo(message.authorName)), findsNothing);

      final at = tester.getCenter(bubble);
      await _drag(tester, x: _width(tester) / 2, by: 90, y: at.dy);
      expect(find.text(l10n.replyingTo(message.authorName)), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      unawaited(recorder.dispose());
      unawaited(player.dispose());
      backend.dispose();
    }, timeout: const Timeout(Duration(seconds: 60)));
  });
}
