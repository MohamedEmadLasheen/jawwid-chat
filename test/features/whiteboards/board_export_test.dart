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
  int grants = 0;

  /// Each compose takes the next of these, if any, as its failure.
  final composeErrors = <Object>[];
  int composes = 0;

  @override
  Future<BoardDetail> open(String boardId) async => BoardDetail(
    summary: BoardSummary(id: boardId, title: 'Al-Fatihah', state: BoardState.active, revision: 1, pageCount: 2, updatedAt: DateTime(2026)),
    canEdit: true,
    pages: [_page('p1', 0), _page('p2', 1)],
  );

  @override
  Future<List<ImageGrant>> grantExport(String boardId, List<int> pageByteSizes) async {
    if (error != null) throw error!;
    grants++;
    askedSizes = pageByteSizes;
    return [
      for (var i = 0; i < pageByteSizes.length; i++)
        ImageGrant(assetId: 'e$i', objectKey: 'whiteboard-uploads/o/$boardId/e$i/u', uploadUrl: 'https://s.test/e$i', headers: const {'Content-Type': 'image/png'}),
    ];
  }

  @override
  Future<Uint8List> composeExport(String boardId, List<ImageGrant> pages) async {
    composes++;
    if (composeErrors.isNotEmpty) throw composeErrors.removeAt(0);
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

  test('each refusal says which, as #325 sends it (review of #335)', () async {
    Future<ExportOutcome> outcome({Object? grant, Object? compose}) async {
      final repo = _Repo()..error = grant;
      if (compose != null) repo.composeErrors.addAll(List.filled(10, compose));
      try {
        await exportPdf(repo, _Uploads(), 'b1', [Uint8List(1)], wait: (_) async {});
      } on ExportException catch (e) {
        return e.outcome;
      }
      throw StateError('no refusal');
    }

    // The grant: switched off; five already in flight (409 {limit: 'exports'}); a board too big (422); busy.
    expect(await outcome(grant: const AppError(AppErrorKind.server, code: kAssetsOffCode)), ExportOutcome.exportsOff);
    expect(await outcome(grant: const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_LIMIT')), ExportOutcome.inProgress);
    expect(await outcome(grant: const AppError(AppErrorKind.validation, code: 'COMM.WHITEBOARD_INVALID')), ExportOutcome.tooLarge);
    expect(await outcome(grant: const AppError(AppErrorKind.rateLimited)), ExportOutcome.busy);
    // Compose: busy after every try; ran out ("export again"); already being made; switched off meanwhile.
    expect(await outcome(compose: const AppError(AppErrorKind.rateLimited, code: 'COMM.WHITEBOARD_LIMIT')), ExportOutcome.busy);
    expect(await outcome(compose: const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_STATE')), ExportOutcome.expired);
    expect(await outcome(compose: const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_CONFLICT')), ExportOutcome.inProgress);
    expect(await outcome(compose: const AppError(AppErrorKind.server, code: kAssetsOffCode)), ExportOutcome.exportsOff);
    expect(await outcome(grant: const AppError(AppErrorKind.network)), ExportOutcome.failed);
    expect(await outcome(grant: StateError('odd')), ExportOutcome.failed);
  });

  test('a busy compose (429) is waited out with the SAME grants, never new ones (review of #335)', () async {
    final repo = _Repo()..composeErrors.addAll([const AppError(AppErrorKind.rateLimited, retryAfter: Duration(seconds: 3)), const AppError(AppErrorKind.rateLimited)]);
    final waits = <Duration>[];
    final pdf = await exportPdf(repo, _Uploads(), 'b1', [Uint8List(1), Uint8List(2)], wait: (d) async => waits.add(d));
    expect(String.fromCharCodes(pdf.take(5)), '%PDF-');
    expect([repo.grants, repo.composes], [1, 3]);
    expect(waits.first, const Duration(seconds: 3)); // the server's Retry-After, when it gives one
    expect(waits, hasLength(2));
    // Still busy after every try: said so, and still one grant only.
    final busy = _Repo()..composeErrors.addAll(List.filled(10, const AppError(AppErrorKind.rateLimited)));
    await expectLater(
      exportPdf(busy, _Uploads(), 'b1', [Uint8List(1)], wait: (_) async {}),
      throwsA(isA<ExportException>().having((e) => e.outcome, 'outcome', ExportOutcome.busy)),
    );
    expect([busy.grants, busy.composes], [1, kComposeTries]);
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

  Future<L10n> pumpEditor(WidgetTester tester, _Repo repo, _Uploads uploads, List<(int, String, String)> saved, {bool here = true}) async {
    final container = ProviderContainer(
      overrides: [
        whiteboardsRepositoryProvider.overrideWithValue(repo),
        boardUploaderProvider.overrideWithValue(uploads),
        boardDraftStoreProvider.overrideWithValue(InMemoryBoardDraftStore()),
        principalIdProvider.overrideWithValue('teacher-1'),
        exportHereProvider.overrideWithValue(here),
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
    return L10n.delegate.load(const Locale('en'));
  }

  /// The board's own menu (the page strip has one too), then one of its items.
  Future<void> choose(WidgetTester tester, L10n l10n, String item) async {
    await tester.tap(find.descendant(of: find.byType(AppBar), matching: find.byTooltip(l10n.boardMore)));
    await tester.pumpAndSettle();
    await tester.tap(find.text(item));
  }

  /// Drawing pages and the engine's PNG encoder are real async work: let real
  /// time pass, and the frames and microtasks after it, until [done].
  Future<void> work(WidgetTester tester, bool Function() done) async {
    for (var i = 0; i < 40 && !done(); i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await tester.pump();
  }

  /// Lets the autosave timers settle.
  Future<void> drain(WidgetTester tester) async {
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  }

  testWidgets('the board menu exports the whole board as a PDF and says so', (tester) async {
    final repo = _Repo();
    final uploads = _Uploads();
    final saved = <(int, String, String)>[];
    final l10n = await pumpEditor(tester, repo, uploads, saved);
    await choose(tester, l10n, l10n.boardExportPdf);
    await work(tester, () => saved.isNotEmpty);
    expect(repo.askedSizes, hasLength(2));
    expect(uploads.urls, hasLength(2));
    expect(saved.single.$2, 'Al-Fatihah.pdf');
    expect(saved.single.$3, 'application/pdf');
    expect(find.text(l10n.boardExportSaved), findsOneWidget);
    await drain(tester);
  });

  testWidgets('a second export while one is being made is not started (review of #335)', (tester) async {
    final repo = _Repo();
    final saved = <(int, String, String)>[];
    final l10n = await pumpEditor(tester, repo, _Uploads(), saved);
    await choose(tester, l10n, l10n.boardExportPdf);
    await tester.pump();
    await choose(tester, l10n, l10n.boardExportPdf);
    await tester.pump();
    await choose(tester, l10n, l10n.boardExportPng);
    await work(tester, () => saved.isNotEmpty);
    await work(tester, () => false);
    expect(repo.grants, 1);
    expect(saved.map((x) => x.$3), ['application/pdf']);
    await drain(tester);
  });

  testWidgets('where there is nowhere to save, it says so before drawing or asking the server (review of #335)', (tester) async {
    final repo = _Repo();
    final saved = <(int, String, String)>[];
    final l10n = await pumpEditor(tester, repo, _Uploads(), saved, here: false);
    await choose(tester, l10n, l10n.boardExportPdf);
    await tester.pumpAndSettle();
    expect(find.text(l10n.boardExportNotHere), findsOneWidget);
    expect(find.text(l10n.boardExporting), findsNothing);
    expect([repo.grants, saved.length], [0, 0]);
    await drain(tester);
  });
}
