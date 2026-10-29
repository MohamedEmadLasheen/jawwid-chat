// PD-39: the Boards tab and the editor, as a teacher sees them (design §10 5a,
// 5b): Deleted boards says how long a board can come back and that it is
// deleted for good within 60 days; deleting says until when it can be
// restored; there is no "delete forever"; a pen stroke on the page is saved.
import 'dart:ui';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_editor_controller.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_canvas.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_editor_screen.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/boards_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

class _Boards implements WhiteboardsRepository {
  int revision = 1;
  final saved = <BoardPage>[];

  BoardSummary summary(String id, String title, {BoardState state = BoardState.active}) => BoardSummary(
        id: id,
        title: title,
        state: state,
        revision: revision,
        pageCount: 1,
        updatedAt: DateTime(2026, 10, 29),
        trashedAt: state == BoardState.trashed ? DateTime(2026, 10, 20) : null,
        purgeAfter: state == BoardState.trashed ? DateTime(2026, 11, 19) : null,
      );

  @override
  Future<List<BoardSummary>> list() async => [summary('b1', 'Al-Fatihah')];

  @override
  Future<List<BoardSummary>> trash() async => [summary('b2', 'Old lesson', state: BoardState.trashed)];

  @override
  Future<BoardDetail> open(String boardId) async => BoardDetail(
        summary: summary(boardId, 'Al-Fatihah'),
        canEdit: true,
        pages: const [BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: [])],
      );

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    saved.add(page);
    return PageSaved(revision: ++this.revision, updatedAt: DateTime(2026));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

void main() {
  late _Boards repo;
  late ProviderContainer container;

  setUp(() {
    repo = _Boards();
    container = ProviderContainer(overrides: [
      whiteboardsRepositoryProvider.overrideWithValue(repo),
      boardDraftStoreProvider.overrideWithValue(InMemoryBoardDraftStore()),
      principalIdProvider.overrideWithValue('teacher-1'),
    ]);
  });
  tearDown(() => container.dispose());

  Future<L10n> pump(WidgetTester tester, Widget home, {Locale locale = const Locale('en'), Size size = const Size(1280, 800)}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: home,
      ),
    ));
    await tester.pumpAndSettle();
    return L10n.delegate.load(locale);
  }

  testWidgets('Deleted boards: when each can come back, and "deleted for good within 60 days"', (tester) async {
    final l10n = await pump(tester, const BoardsScreen());
    expect(find.text('Al-Fatihah'), findsOneWidget);
    await tester.tap(find.text(l10n.boardsDeleted));
    await tester.pumpAndSettle();
    expect(find.text('Old lesson'), findsOneWidget);
    expect(find.textContaining('Restorable until'), findsOneWidget);
    expect(find.text(l10n.boardsDeletedFooter), findsOneWidget);
    expect(find.text(l10n.boardsRestore), findsOneWidget);
    // There is no permanent delete anywhere (§10 5b).
    expect(find.textContaining(RegExp('forever|permanent', caseSensitive: false)), findsNothing);
  });

  testWidgets('deleting a board says where it goes and until when it can be restored', (tester) async {
    final l10n = await pump(tester, const BoardsScreen());
    await tester.tap(find.byTooltip(l10n.boardMore));
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10n.boardsDelete).last);
    await tester.pumpAndSettle();
    expect(find.text(l10n.boardsDeleteTitle('Al-Fatihah')), findsOneWidget);
    expect(find.textContaining('You can restore it until'), findsOneWidget);
    await tester.tap(find.text(l10n.boardsCancel));
    await tester.pumpAndSettle();
  });

  testWidgets('Arabic: the tab reads right to left and the footer is the owner\'s wording', (tester) async {
    final l10n = await pump(tester, const BoardsScreen(), locale: const Locale('ar'));
    await tester.tap(find.text(l10n.boardsDeleted));
    await tester.pumpAndSettle();
    expect(find.text('يمكن استعادة السبورات المحذوفة خلال 30 يومًا، ثم تُحذف نهائيًا خلال 60 يومًا.'), findsOneWidget);
    expect(Directionality.of(tester.element(find.byType(BoardsScreen))), TextDirection.rtl);
  });

  testWidgets('a pen stroke drawn with the mouse becomes one element and is saved', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    expect(find.text(l10n.boardSaved), findsOneWidget);
    final canvas = find.byType(BoardCanvas);
    final centre = tester.getCenter(canvas);
    final gesture = await tester.startGesture(centre, kind: PointerDeviceKind.mouse);
    for (var i = 1; i <= 10; i++) {
      await gesture.moveTo(centre + Offset(i * 8.0, i * 3.0));
    }
    await gesture.up();
    await tester.pump();
    final state = container.read(boardEditorProvider('b1')).value!;
    expect(state.page.elements.single, isA<InkElement>());
    expect(find.text(l10n.boardUnsaved), findsOneWidget);
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
    expect(repo.saved.single.elements.single, isA<InkElement>());
    expect(find.text(l10n.boardSaved), findsOneWidget);
  });

  testWidgets('a Tajweed highlighter colour stays with the highlighter: the next pen stroke is ink', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    await tester.tap(find.byTooltip(l10n.boardToolHighlighter));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip(l10n.boardTajweedMadd));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip(l10n.boardToolPen));
    await tester.pumpAndSettle();
    final centre = tester.getCenter(find.byType(BoardCanvas));
    final gesture = await tester.startGesture(centre, kind: PointerDeviceKind.mouse);
    await gesture.moveTo(centre + const Offset(60, 20));
    await gesture.up();
    await tester.pump();
    final ink = container.read(boardEditorProvider('b1')).value!.page.elements.single as InkElement;
    expect(ink.highlight, isFalse);
    expect(ink.color, BoardPalette.ink);
    // Let the autosave run, so no timer outlives the test.
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  });

  testWidgets('on a phone-sized screen the gate is report-only: editing stays on', (tester) async {
    expect(kBoardEditGateEnforced, isFalse);
    expect(boardEditGate(const Size(390, 844)), EditGate.screenTooSmall);
    expect(boardEditGate(const Size(1024, 768)), EditGate.allowed);
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'), size: const Size(390, 844));
    expect(find.text(l10n.boardEditNeedsLargerScreen), findsNothing);
    expect(find.byTooltip(l10n.boardToolPen), findsOneWidget);
  });
}
