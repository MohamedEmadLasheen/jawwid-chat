import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// A picker that hands back whatever the test says, without a platform channel.
class _FakeMediaPicker implements MediaPicker {
  PendingAttachment? image;
  PendingAttachment? file;
  MediaPickException? failure;

  int imageCalls = 0;
  int fileCalls = 0;

  @override
  Future<PendingAttachment?> pickImage() async {
    imageCalls++;
    if (failure != null) throw failure!;
    return image;
  }

  @override
  Future<PendingAttachment?> pickFile() async {
    fileCalls++;
    if (failure != null) throw failure!;
    return file;
  }
}

/// Records what the app asked the phone to open, without launching anything.
class _FakeAttachmentOpener implements AttachmentOpener {
  final opened = <String>[];
  bool succeeds = true;

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return succeeds;
  }
}

/// The long-press menu, reply, copy, reactions and the attach flow, driven
/// through the real chat screen.
void main() {
  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;
  late _FakeMediaPicker picker;
  late _FakeAttachmentOpener opener;

  /// Everything the app wrote to the system clipboard during a test.
  late List<String> clipboard;

  late Directory scratch;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
    picker = _FakeMediaPicker();
    opener = _FakeAttachmentOpener();
    clipboard = [];
    scratch = Directory.systemTemp.createTempSync('jawwid_chat_widget_test');

    // The clipboard is a platform channel; intercepting it is what lets Copy be
    // asserted rather than assumed.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        clipboard.add((call.arguments as Map)['text'] as String);
      }
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
    recorder.dispose();
    player.dispose();
    backend.dispose();
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  Widget harness({Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        mediaPickerProvider.overrideWithValue(picker),
        attachmentOpenerProvider.overrideWithValue(opener),
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
          title: 'Jawwid',
        ),
      ),
    );
  }

  Future<void> openActions(WidgetTester tester) async {
    await tester.longPress(find.byType(MessageBubble).first);
    await tester.pumpAndSettle();
  }

  group('long press opens the actions people expect', () {
    testWidgets('reply, copy and delete are all reachable', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);

      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('Copy'), findsOneWidget);
      expect(find.text('Delete for me'), findsOneWidget);
    });

    testWidgets('the six reactions are on the sheet, one tap away',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);

      for (final emoji in ['❤️', '👍', '😂', '😢', '😮', '👏']) {
        expect(find.text(emoji), findsOneWidget, reason: emoji);
      }
    });

    testWidgets('no Forward entry is offered, because there is no endpoint '
        'behind it', (tester) async {
      // An action that would always fail must be absent, not present and
      // broken. When the API gains a forward route this expectation is the
      // thing that has to be deleted deliberately.
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      expect(find.text('Forward'), findsNothing);
    });

    testWidgets('delete for everyone is absent on a message from Jawwid',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      expect(find.text('Delete for everyone'), findsNothing);
    });
  });

  group('reply', () {
    testWidgets('choosing Reply puts the quote in the composer', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      await tester.tap(find.text('Reply'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Replying to'), findsOneWidget);
    });

    testWidgets('the quote can be dismissed without sending', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      await tester.tap(find.text('Reply'));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();

      expect(find.textContaining('Replying to'), findsNothing);
    });

    testWidgets('a sent reply renders its quote above the new message',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      await tester.tap(find.text('Reply'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Thank you');
      // The send button replaces the microphone only once the field has text.
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      expect(find.text('Thank you'), findsOneWidget);
      // The original's text now appears twice: once as itself, once quoted.
      expect(find.text('أهلًا بك، كيف يمكننا مساعدتك؟'), findsNWidgets(2));
    });
  });

  group('copy', () {
    testWidgets('puts the message on the clipboard and says so without a dialog',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      await tester.tap(find.text('Copy'));
      await tester.pumpAndSettle();

      expect(clipboard, ['أهلًا بك، كيف يمكننا مساعدتك؟']);
      expect(find.text('Copied'), findsOneWidget);
      expect(
        find.byType(Dialog),
        findsNothing,
        reason: '§11 — a confirmation, never a modal',
      );
    });
  });

  group('reactions', () {
    testWidgets('tapping one leaves it on the bubble', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await openActions(tester);
      await tester.tap(find.text('👍'));
      await tester.pumpAndSettle();

      // Back on the conversation, on the bubble itself.
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('👍'), findsOneWidget);
    });
  });

  group('the attach menu', () {
    testWidgets('offers exactly Photo and File', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();

      expect(find.text('Photo'), findsOneWidget);
      expect(find.text('File'), findsOneWidget);
      expect(find.text('Camera'), findsNothing);
      expect(find.text('Location'), findsNothing);
    });

    testWidgets('a chosen photo is previewed before anything is sent',
        (tester) async {
      picker.image = const PendingAttachment(
        filePath: '/tmp/does-not-exist.jpg',
        kind: MessageKind.image,
        mimeType: 'image/jpeg',
        byteSize: 2048,
        fileName: 'photo.jpg',
      );

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Photo'));
      await tester.pumpAndSettle();

      expect(picker.imageCalls, 1);
      expect(
        find.text('Send this?'),
        findsOneWidget,
        reason: '§16 — a picked photo is never sent on the spot',
      );
    });

    testWidgets('backing out of the picker says nothing at all', (tester) async {
      // Null means the user changed their mind. Nothing went wrong, so nothing
      // is announced.
      picker.image = null;

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Photo'));
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsNothing);
      expect(find.text('Send this?'), findsNothing);
    });

    testWidgets('an over-size file is explained in the parent\'s terms',
        (tester) async {
      picker.failure = const MediaPickException(MediaPickFailure.tooLarge);

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.tap(find.text('File'));
      await tester.pumpAndSettle();

      expect(find.text('That file is too large to send.'), findsOneWidget);
    });

    testWidgets('a refused permission points at Settings, never at a code',
        (tester) async {
      picker.failure =
          const MediaPickException(MediaPickFailure.permissionDenied);

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Photo'));
      await tester.pumpAndSettle();

      expect(find.textContaining('permission'), findsOneWidget);
      expect(find.textContaining('PlatformException'), findsNothing);
      expect(find.textContaining('photo_access_denied'), findsNothing);
    });
  });

  group('files', () {
    testWidgets('a sent file is rendered by name and size, and opening it hands '
        'the phone the signed URL', (tester) async {
      final onDisk = File('${scratch.path}${Platform.pathSeparator}Homework.pdf')
        ..writeAsBytesSync(List<int>.filled(2048, 1));

      picker.file = PendingAttachment(
        filePath: onDisk.path,
        kind: MessageKind.file,
        mimeType: 'application/pdf',
        byteSize: 2048,
        fileName: 'Homework.pdf',
      );

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.tap(find.text('File'));
      await tester.pumpAndSettle();

      // Reviewed before it is sent, like a photo.
      expect(find.text('Send this?'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      // The bubble names it and sizes it, and names nothing else — no object
      // key, no bucket, no MIME type (§17, §25).
      expect(find.text('Homework.pdf'), findsOneWidget);
      expect(find.text('2 KB'), findsOneWidget);
      expect(find.textContaining('conversations/'), findsNothing);
      expect(find.textContaining('application/pdf'), findsNothing);

      await tester.tap(find.text('Homework.pdf'));
      await tester.pumpAndSettle();

      expect(
        opener.opened,
        hasLength(1),
        reason: 'Open must actually open something, not be a dead tap',
      );
    });
  });

  group('Arabic', () {
    testWidgets('the actions sheet reads right-to-left', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('ar')));
      await tester.pumpAndSettle();

      await openActions(tester);

      expect(find.text('رد'), findsOneWidget);
      expect(find.text('نسخ'), findsOneWidget);
      expect(
        Directionality.of(tester.element(find.text('رد'))),
        TextDirection.rtl,
      );
    });

    testWidgets('the attach menu is Arabic too', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('ar')));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();

      expect(find.text('صورة'), findsOneWidget);
      expect(find.text('ملف'), findsOneWidget);
    });
  });
}
