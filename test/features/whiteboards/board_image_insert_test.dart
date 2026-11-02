// PD-39 PR-4 (design §4.4), review of #328: adding a picture from the editor.
// The button is offered only where the server knows images, and goes when it
// says they are switched off. Every failure says which one it is: the
// picker's reason, the switch, the upload. Leaving mid-upload breaks
// nothing, and the picture lands on the page its upload started on.
import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/http/attachment_uploader.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_editor_controller.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_image_import.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_editor_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

class _Boards implements WhiteboardsRepository {
  bool imagesSupported = true;
  Object? grantError;

  /// When set, the grant waits for it (an upload still on its way).
  Completer<void>? hold;
  final saved = <BoardPage>[];
  int revision = 1;

  @override
  Future<BoardDetail> open(String boardId) async => BoardDetail(
    summary: BoardSummary(id: boardId, title: 'Al-Fatihah', state: BoardState.active, revision: revision, pageCount: 2, updatedAt: DateTime(2026)),
    canEdit: true,
    imagesSupported: imagesSupported,
    pages: const [
      BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: []),
      BoardPage(id: 'p2', position: 1, layout: PageLayout.plain, background: PageBackground.white, elements: []),
    ],
  );

  @override
  Future<ImageGrant> grantImage(String boardId, {required String contentType, required int byteSize}) async {
    await hold?.future;
    if (grantError != null) throw grantError!;
    return const ImageGrant(assetId: 'a1', objectKey: 'whiteboard-uploads/o/b1/a1/u', uploadUrl: 'https://s.test/up', headers: {});
  }

  @override
  Future<BoardAsset> confirmImage(String boardId, String assetId, String objectKey) async =>
      BoardAsset(id: assetId, url: 'https://s.test/a1', expiresAt: DateTime.now().add(const Duration(minutes: 15)), width: 40, height: 30);

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    saved.add(page);
    return PageSaved(revision: ++this.revision, updatedAt: DateTime(2026));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _Picker implements MediaPicker {
  Object? error;

  @override
  Future<PendingAttachment?> pickImage() async {
    if (error != null) throw error!;
    return const PendingAttachment(filePath: '/picked/photo.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 100);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _Uploads implements AttachmentUploader {
  Object? error;
  int puts = 0;

  @override
  Future<void> put(String uploadUrl, {required Uint8List bytes, required Map<String, String> headers}) async {
    puts++;
    if (error != null) throw error!;
  }
}

Future<Uint8List> _png(int w, int h) async {
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawRect(ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), ui.Paint()..color = const ui.Color(0xFF2E7D32));
  final image = await recorder.endRecording().toImage(w, h);
  return (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
}

void main() {
  late _Boards repo;
  late _Picker picker;
  late _Uploads uploads;
  late ProviderContainer container;
  late Uint8List png;

  setUp(() {
    repo = _Boards();
    picker = _Picker();
    uploads = _Uploads();
    container = ProviderContainer(
      overrides: [
        whiteboardsRepositoryProvider.overrideWithValue(repo),
        boardDraftStoreProvider.overrideWithValue(InMemoryBoardDraftStore()),
        principalIdProvider.overrideWithValue('teacher-1'),
        mediaPickerProvider.overrideWithValue(picker),
        boardUploaderProvider.overrideWithValue(uploads),
        boardImageBytesProvider.overrideWithValue((_) async => png),
      ],
    );
  });
  tearDown(() => container.dispose());

  Future<L10n> pump(WidgetTester tester) async {
    png = (await tester.runAsync(() => _png(40, 30)))!;
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      UncontrolledProviderScope(
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
          home: const BoardEditorScreen(boardId: 'b1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return L10n.delegate.load(const Locale('en'));
  }

  EditorState state() => container.read(boardEditorProvider('b1')).value!;

  /// Lets the real decoding and the fakes' futures run, a little at a time.
  Future<void> work(WidgetTester tester, {bool Function()? until}) async {
    for (var i = 0; i < 100 && !(until?.call() ?? false); i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  /// The image button may sit past the end of the tool rail.
  Future<void> tapImage(WidgetTester tester, L10n l10n) async {
    final button = find.byTooltip(l10n.boardToolImage);
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
  }

  /// Lets the autosave run, so no timer outlives the test.
  Future<void> drain(WidgetTester tester) async {
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  }

  testWidgets('no image button where the server has no images', (tester) async {
    repo.imagesSupported = false;
    final l10n = await pump(tester);
    expect(find.byTooltip(l10n.boardToolImage), findsNothing);
    expect(find.byTooltip(l10n.boardToolPen), findsOneWidget);
  });

  testWidgets('added: on the page its upload started on, though the teacher moved on', (tester) async {
    final l10n = await pump(tester);
    repo.hold = Completer<void>();
    await tapImage(tester, l10n);
    await work(tester, until: () => find.text(l10n.boardImageAdding).evaluate().isNotEmpty);
    expect(find.text(l10n.boardImageAdding), findsOneWidget);
    container.read(boardEditorProvider('b1').notifier).goTo(1);
    repo.hold!.complete();
    await work(tester, until: () => state().pages[0].elements.isNotEmpty);
    expect(state().current, 1);
    expect((state().pages[0].elements.single as ImageElement).assetId, 'a1');
    expect(state().pages[1].elements, isEmpty);
    expect(uploads.puts, 1);
    await drain(tester);
    expect(repo.saved.single.id, 'p1');
  });

  testWidgets('switched off here: says so, and the button goes', (tester) async {
    final l10n = await pump(tester);
    repo.grantError = const AppError(AppErrorKind.server, code: kAssetsOffCode);
    await tapImage(tester, l10n);
    await work(tester, until: () => find.text(l10n.boardImageOff).evaluate().isNotEmpty);
    expect(find.text(l10n.boardImageOff), findsOneWidget);
    expect(find.byTooltip(l10n.boardToolImage), findsNothing);
    expect(state().page.elements, isEmpty);
  });

  testWidgets('a server from before images (404, no code) is the same as switched off', (tester) async {
    final l10n = await pump(tester);
    repo.grantError = const AppError(AppErrorKind.notFound);
    await tapImage(tester, l10n);
    await work(tester, until: () => find.text(l10n.boardImageOff).evaluate().isNotEmpty);
    expect(find.text(l10n.boardImageOff), findsOneWidget);
    expect(find.byTooltip(l10n.boardToolImage), findsNothing);
  });

  testWidgets('the picker\'s reason is said: no permission, too large, not a picture', (tester) async {
    final l10n = await pump(tester);
    for (final (reason, text) in [
      (MediaPickFailure.permissionDenied, l10n.attachmentPermissionDenied),
      (MediaPickFailure.tooLarge, l10n.boardImageTooLarge),
      (MediaPickFailure.typeNotAllowed, l10n.boardImageNotImage),
    ]) {
      picker.error = MediaPickException(reason);
      await tapImage(tester, l10n);
      await work(tester, until: () => find.text(text).evaluate().isNotEmpty);
      expect(find.text(text), findsOneWidget, reason: '$reason');
    }
    expect(uploads.puts, 0);
  });

  testWidgets('the PUT failing says the picture could not be added; nothing is placed', (tester) async {
    final l10n = await pump(tester);
    uploads.error = Exception('connection reset');
    await tapImage(tester, l10n);
    await work(tester, until: () => find.text(l10n.boardImageFailed).evaluate().isNotEmpty);
    expect(find.text(l10n.boardImageFailed), findsOneWidget);
    expect(state().page.elements, isEmpty);
    expect(find.byTooltip(l10n.boardToolImage), findsOneWidget);
  });

  testWidgets('leaving mid-upload: nothing breaks and nothing is placed', (tester) async {
    final l10n = await pump(tester);
    repo.hold = Completer<void>();
    await tapImage(tester, l10n);
    await work(tester, until: () => find.text(l10n.boardImageAdding).evaluate().isNotEmpty);
    await tester.pumpWidget(const SizedBox());
    repo.hold!.complete();
    await work(tester);
    expect(tester.takeException(), isNull);
    expect(uploads.puts, 1);
    expect(repo.saved, isEmpty);
  });
}
