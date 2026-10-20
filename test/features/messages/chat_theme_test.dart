import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/features/messages/data/chat_theme_repository.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_theme_sheet.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../calls/w7_call_fakes.dart';
import 'fake_voice_devices.dart';

/// Chat themes (owner decisions 2026-10-20): private to the viewer, presets +
/// own photo, saved on the server; only the background behind messages changes.
void main() {
  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;
  late _RecordingThemes themes;
  late _OnePhoto picker;
  late Directory scratch;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
    themes = _RecordingThemes();
    scratch = Directory.systemTemp.createTempSync('jawwid_theme_test');
    final file = File('${scratch.path}/beach.jpg')..writeAsBytesSync(List.filled(1200, 7));
    picker = _OnePhoto(PendingAttachment(filePath: file.path, kind: MessageKind.image, mimeType: 'image/jpeg', byteSize: 1200));
  });
  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  Widget app({ChatThemeRepository? repo, bool canCall = true}) {
    final conversation = backend.listConversations().first;
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        principalIdProvider.overrideWithValue('parent-1'),
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        mediaPickerProvider.overrideWithValue(picker),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCalls(capabilityAnswer: CallCapability(canCall: canCall))),
        chatThemeRepositoryProvider.overrideWithValue(repo ?? themes),
      ],
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
        home: ChatScreen(conversationId: conversation.id, title: conversation.title, conversation: conversation),
      ),
    );
  }

  BoxDecoration? background(WidgetTester tester) {
    final found = find.byKey(const ValueKey('chat-background'));
    if (found.evaluate().isEmpty) return null;
    return tester.widget<DecoratedBox>(found).decoration as BoxDecoration;
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byIcon(Icons.more_vert));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chat theme'));
    await tester.pumpAndSettle();
  }

  testWidgets('a preset is saved for this chat and paints only the background', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    expect(background(tester), isNull); // the default look

    await openSheet(tester);
    expect(find.textContaining('Only you see this'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('theme-sand')));
    await tester.pumpAndSettle();

    final id = backend.listConversations().first.id;
    expect(themes.themes, [(id, 'sand')]);
    final gradient = background(tester)!.gradient! as LinearGradient;
    expect(gradient.colors, ChatThemePalette.stops('sand', Brightness.light));

    await tester.tap(find.byKey(const ValueKey('theme-default')));
    await tester.pumpAndSettle();
    expect(themes.themes.last, (id, null));
    expect(background(tester), isNull);
  });

  testWidgets('a photo is uploaded as this chat\'s wallpaper, shown dimmed, and can be removed', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    await openSheet(tester);

    await tester.tap(find.text('Choose a photo'));
    await tester.pumpAndSettle();
    expect(themes.wallpapers, hasLength(1));
    expect(themes.wallpapers.single.$2.mimeType, 'image/jpeg');
    final image = background(tester)!.image!;
    expect((image.image as NetworkImage).url, 'https://media.example/wall-1');
    expect(image.colorFilter, isNotNull); // dimmed so text stays readable

    await tester.tap(find.text('Remove photo'));
    await tester.pumpAndSettle();
    expect(themes.removed, 1);
    expect(background(tester), isNull);
  });

  testWidgets('no theme server: no Chat theme entry (and no menu at all without a call)', (tester) async {
    await tester.pumpWidget(app(repo: const NoChatThemeRepository(), canCall: false));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.more_vert), findsNothing);
  });

  test("this session's choices are dropped when the signed-in person changes", () {
    final who = NotifierProvider<_Who, String?>(_Who.new);
    final c = ProviderContainer(overrides: [principalIdProvider.overrideWith((ref) => ref.watch(who))]);
    addTearDown(c.dispose);
    c.read(who.notifier).set('parentA');
    c.read(chatAppearanceProvider.notifier).set('conv', (themeKey: 'rose', wallpaperUrl: 'https://x/a'));
    expect(c.read(chatAppearanceProvider)['conv']?.themeKey, 'rose');
    c.read(who.notifier).set('teacherB');
    expect(c.read(chatAppearanceProvider), isEmpty);
  });
}

class _Who extends Notifier<String?> {
  @override
  String? build() => null;
  void set(String? id) => state = id;
}

class _RecordingThemes implements ChatThemeRepository {
  final themes = <(String, String?)>[];
  final wallpapers = <(String, PendingAttachment)>[];
  var removed = 0;

  @override
  bool get isAvailable => true;
  @override
  Future<void> setTheme(String conversationId, String? themeKey) async => themes.add((conversationId, themeKey));
  @override
  Future<String?> setWallpaper(String conversationId, PendingAttachment photo) async {
    wallpapers.add((conversationId, photo));
    return 'https://media.example/wall-${wallpapers.length}';
  }

  @override
  Future<void> removeWallpaper(String conversationId) async => removed++;
}

class _OnePhoto implements MediaPicker {
  _OnePhoto(this.photo);
  final PendingAttachment photo;
  @override
  Future<PendingAttachment?> pickImage() async => photo;
  @override
  Future<PendingAttachment?> captureImage() async => null;
  @override
  Future<PendingAttachment?> pickFile() async => null;
}
