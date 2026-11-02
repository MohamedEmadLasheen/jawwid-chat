// CHATSCHED-010 (P2): a video sent in a chat showed as a "File" tile, and
// tapping it handed the signed media URL to Safari, which could not play it
// (the media route's `default-src 'none'` CSP governs a browser's media page)
// and put the URL in its address bar. A video is now a video tile, and it
// plays IN the app -- the platform player, which the CSP does not govern and
// which asks the media route for byte ranges as it seeks -- with a seek bar.
// Nothing is launched outside the app.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_video_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

import '../stories/fake_story_video_player.dart';

const _url = 'https://api.test/api/v1/media/attachments/a1?sig=secret';

Message _videoMessage() => WireMappers.message({
      'id': 'srv_1',
      'conversationId': 'c1',
      'seq': '5',
      'authorId': 'teacher-1',
      'authorKind': 'teacher',
      'authorDisplayName': 'Teacher T',
      'type': 'video',
      'body': '',
      'moderation': 'published',
      'createdAt': '2026-11-01T12:00:00.000Z',
      'receipts': const [],
      'reactions': const [],
      'attachments': [
        {'id': 'a1', 'kind': 'video', 'mimeType': 'video/mp4', 'byteSize': 9000, 'url': _url, 'durationMs': 95000},
      ],
    }, viewerActorId: 'me');

class _NoOpener implements AttachmentOpener {
  final opened = <String>[];

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return true;
  }
}

void main() {
  late FakeStoryVideoPlayer player;
  late _NoOpener opener;

  setUp(() {
    player = FakeStoryVideoPlayer(duration: const Duration(seconds: 95));
    opener = _NoOpener();
  });

  Widget app(Widget home) => ProviderScope(
        overrides: [
          storyVideoPlayerFactoryProvider.overrideWithValue(() => player),
          attachmentOpenerProvider.overrideWithValue(opener),
        ],
        child: MaterialApp(
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
      );

  testWidgets('a video attachment is a video tile (with its length), not a file tile', (tester) async {
    final l10n = await L10n.delegate.load(const Locale('en'));
    await tester.pumpWidget(app(Scaffold(body: MessageBubble(message: _videoMessage(), showAuthor: true))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('video-attachment')), findsOneWidget);
    expect(find.text('${l10n.attachmentVideoLabel} · 1:35'), findsOneWidget);
    expect(find.text(l10n.attachmentFileLabel), findsNothing);
  });

  testWidgets('tapping it plays IN the app: the player loads the media URL; nothing is launched outside and the URL is not shown', (tester) async {
    await tester.pumpWidget(app(Builder(
      builder: (context) => Scaffold(
        body: MessageBubble(
          message: _videoMessage(),
          showAuthor: true,
          onOpenAttachment: (a) => showChatVideo(context, url: a.url!),
        ),
      ),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('video-attachment')));
    await tester.pumpAndSettle();

    expect(find.byType(ChatVideoScreen), findsOneWidget);
    expect(player.loaded, [_url]);
    expect(player.playCalls, greaterThan(0));
    expect(opener.opened, isEmpty, reason: 'no Safari, no external launch');
    expect(find.textContaining('sig=secret'), findsNothing);
    expect(find.textContaining('api.test'), findsNothing);
  });

  testWidgets('the seek bar moves the player to where it is let go', (tester) async {
    await tester.pumpWidget(app(const ChatVideoScreen(url: _url)));
    await tester.pumpAndSettle();
    expect(find.text('1:35'), findsOneWidget, reason: 'the video\'s length, once loaded');

    final bar = find.byKey(const ValueKey('chat-video-seek'));
    final box = tester.getRect(bar);
    // Let go at about the middle of the track.
    await tester.tapAt(Offset(box.left + box.width / 2, box.center.dy));
    await tester.pumpAndSettle();
    expect(player.seeks, hasLength(1));
    final at = player.seeks.single.inMilliseconds / 95000;
    expect(at, closeTo(0.5, 0.1));

    await tester.tap(find.byKey(const ValueKey('chat-video-play')));
    await tester.pump();
    expect(player.pauseCalls, 1);
  });

  testWidgets('a video that cannot be played says so', (tester) async {
    player = FakeStoryVideoPlayer(failOnLoad: true);
    final l10n = await L10n.delegate.load(const Locale('en'));
    await tester.pumpWidget(app(const ChatVideoScreen(url: _url)));
    await tester.pumpAndSettle();
    expect(find.text(l10n.storyVideoFailed), findsOneWidget);
  });
}
