// PD-39 PR-4 (design §4.6): a board exported. The portal draws every page
// itself, at the board's own 1920 x 1080. A PDF is made by the server from
// those PNGs: one grant per page, each PUT to its signed URL, then compose.
// Each way it can fail says which. Nothing is exported while a verse or an
// image is still on its way, for up to 10 s.
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/http/attachment_uploader.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_editor_controller.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_export.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_image_import.dart';
import 'package:jawwid_chat/features/whiteboards/data/board_images.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_editor_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

const _shape = ShapeElement(id: 'r1', shape: ShapeKind.rect, rect: Rect.fromLTWH(100, 100, 400, 300), stroke: Color(0xFFC62828), width: 4);

BoardPage _page(String id, int position, [List<BoardElement> elements = const [_shape]]) =>
    BoardPage(id: id, position: position, layout: PageLayout.plain, background: PageBackground.white, elements: elements);

class _Repo implements WhiteboardsRepository {
  Object? error;
  List<int>? askedSizes;
  List<ImageGrant>? composed;

  @override
  Future<BoardDetail> open(String boardId) async => BoardDetail(
    summary: BoardSummary(id: boardId, title: 'Al-Fatihah', state: BoardState.active, revision: 1, pageCount: 2, updatedAt: DateTime(2026)),
    canEdit: true,
    pages: [_page('p1', 0), _page('p2', 1)],
  );

  @override
  Future<List<ImageGrant>> grantExport(String boardId, List<int> pageByteSizes) async {
    if (error != null) throw error!;
    askedSizes = pageByteSizes;
    return [
      for (var i = 0; i < pageByteSizes.length; i++)
        ImageGrant(assetId: 'e$i', objectKey: 'whiteboard-uploads/o/$boardId/e$i/u', uploadUrl: 'https://s.test/e$i', headers: const {'Content-Type': 'image/png'}),
    ];
  }

  @override
  Future<Uint8List> composeExport(String boardId, List<ImageGrant> pages) async {
    composed = pages;
    return Uint8List.fromList('%PDF-1.3 test'.codeUnits);
  }

  @override
  Future<List<BoardAsset>> imageUrls(String boardId) async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _Uploads implements AttachmentUploader {
  final urls = <String>[];

  @override
  Future<void> put(String uploadUrl, {required Uint8List bytes, required Map<String, String> headers}) async => urls.add(uploadUrl);
}

void main() {
  test('a page is drawn at the board\'s own size, 1920 x 1080', () async {
    final png = await renderPagePng(_page('p1', 0), const PageInk());
    final codec = await ui.instantiateImageCodec(png);
    final frame = (await codec.getNextFrame()).image;
    expect([frame.width, frame.height], [1920, 1080]);
    expect(sniffBoardImage(png), 'image/png');
  });

  test('the file is named after the board, safely', () {
    expect(exportName('Al-Fatihah: week 2/3', 'pdf'), 'Al-Fatihah week 2 3.pdf');
    expect(exportName('   ', 'png'), 'board.png');
    expect(exportName('مراجعة الفاتحة', 'pdf'), 'مراجعة الفاتحة.pdf');
  });

  test('a PDF: one grant per page in order, each page PUT to its own URL, then compose', () async {
    final repo = _Repo();
    final uploads = _Uploads();
    final pngs = [Uint8List(10), Uint8List(20), Uint8List(30)];
    final pdf = await exportPdf(repo, uploads, 'b1', pngs);
    expect(String.fromCharCodes(pdf.take(5)), '%PDF-');
    expect(repo.askedSizes, [10, 20, 30]);
    expect(uploads.urls, ['https://s.test/e0', 'https://s.test/e1', 'https://s.test/e2']);
    expect(repo.composed!.map((g) => g.assetId), ['e0', 'e1', 'e2']);
  });

  test('each refusal says which: switched off, busy, too large, anything else', () async {
    Future<ExportOutcome> outcome(Object error) async {
      try {
        await exportPdf(_Repo()..error = error, _Uploads(), 'b1', [Uint8List(1)]);
      } on ExportException catch (e) {
        return e.outcome;
      }
      throw StateError('no refusal');
    }

    expect(await outcome(const AppError(AppErrorKind.server, code: kAssetsOffCode)), ExportOutcome.exportsOff);
    expect(await outcome(const AppError(AppErrorKind.rateLimited, code: 'COMM.WHITEBOARD_LIMIT')), ExportOutcome.busy);
    expect(await outcome(const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_LIMIT')), ExportOutcome.tooLarge);
    expect(await outcome(const AppError(AppErrorKind.network)), ExportOutcome.failed);
    expect(await outcome(StateError('odd')), ExportOutcome.failed);
  });

  test('nothing is exported while an image is on its way; a stuck one is waited for only so long', () async {
    const image = ImageElement(id: 'i1', assetId: 'a1', rect: Rect.fromLTWH(0, 0, 10, 10));
    var status = BoardImageStatus.loading;
    final ink = PageInk(images: (_) => BoardImageLookup(status));
    final page = _page('p1', 0, const [image]);
    expect(stillLoading([page], ink), isTrue);
    Future<void>.delayed(const Duration(milliseconds: 300), () => status = BoardImageStatus.ready);
    final waited = Stopwatch()..start();
    await settleForExport([page], ink);
    expect(waited.elapsedMilliseconds, lessThan(2000));
    status = BoardImageStatus.loading;
    final capped = Stopwatch()..start();
    await settleForExport([page], ink, limit: const Duration(milliseconds: 400));
    expect(capped.elapsedMilliseconds, lessThan(1500));
  });

  testWidgets('the board menu exports the whole board as a PDF and says so', (tester) async {
    final repo = _Repo();
    final uploads = _Uploads();
    final saved = <(int, String, String)>[];
    final container = ProviderContainer(
      overrides: [
        whiteboardsRepositoryProvider.overrideWithValue(repo),
        boardUploaderProvider.overrideWithValue(uploads),
        boardDraftStoreProvider.overrideWithValue(InMemoryBoardDraftStore()),
        principalIdProvider.overrideWithValue('teacher-1'),
        exportSaverProvider.overrideWithValue((bytes, name, mime) async {
          saved.add((bytes.length, name, mime));
          return ExportOutcome.saved;
        }),
      ],
    );
    addTearDown(container.dispose);
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: const BoardEditorScreen(boardId: 'b1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));
    // The board's own menu (the page strip has one too).
    await tester.tap(find.descendant(of: find.byType(AppBar), matching: find.byTooltip(l10n.boardMore)));
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10n.boardExportPdf));
    // Drawing pages and the engine's PNG encoder are real async work: let real
    // time pass, and the frames and microtasks after it, until the export is saved.
    for (var i = 0; i < 40 && saved.isEmpty; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await tester.pump();
    expect(repo.askedSizes, hasLength(2));
    expect(uploads.urls, hasLength(2));
    expect(saved.single.$2, 'Al-Fatihah.pdf');
    expect(saved.single.$3, 'application/pdf');
    expect(find.text(l10n.boardExportSaved), findsOneWidget);
    // Let the autosave timers settle.
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  });
}
