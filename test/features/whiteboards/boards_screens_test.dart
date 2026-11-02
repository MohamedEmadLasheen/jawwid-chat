// PD-39: the Boards tab and the editor, as a teacher sees them (design §10 5a,
// 5b): Deleted boards says how long a board can come back and that it is
// deleted for good within 60 days; deleting says until when it can be
// restored; there is no "delete forever"; a pen stroke on the page is saved.
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'package:jawwid_chat/features/whiteboards/presentation/board_painter.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/boards_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

class _Boards implements WhiteboardsRepository {
  int revision = 1;
  final saved = <BoardPage>[];
  /// The board's pages when opened; one blank page unless a test says otherwise.
  List<BoardPage> pages = const [BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: [])];

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
    pages: pages,
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
    container = ProviderContainer(
      overrides: [
        whiteboardsRepositoryProvider.overrideWithValue(repo),
        boardDraftStoreProvider.overrideWithValue(InMemoryBoardDraftStore()),
        principalIdProvider.overrideWithValue('teacher-1'),
      ],
    );
  });
  tearDown(() => container.dispose());

  Future<L10n> pump(WidgetTester tester, Widget home, {Locale locale = const Locale('en'), Size size = const Size(1280, 800)}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
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
          home: home,
        ),
      ),
    );
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

  testWidgets('PD-55: the editor\'s Text tool types on the page -- no dialog -- and Backspace edits the words, never the selection', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    await tester.tap(find.byTooltip(l10n.boardToolText));
    await tester.pump();
    final centre = tester.getCenter(find.byType(BoardCanvas));
    await tester.tapAt(centre);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    await tester.enterText(find.byType(EditableText), 'Helloo');
    await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    final text = container.read(boardEditorProvider('b1')).value!.page.elements.single as TextElement;
    expect(text.text, 'Hello');
    expect(find.text(l10n.boardUnsaved), findsOneWidget);
  });

  testWidgets('PD-55: Ctrl+D or the selection bar\'s Duplicate copies the selection, one undo step each; never while typing', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    final centre = tester.getCenter(find.byType(BoardCanvas));
    final gesture = await tester.startGesture(centre, kind: PointerDeviceKind.mouse);
    for (var i = 1; i <= 10; i++) {
      await gesture.moveTo(centre + Offset(i * 8.0, i * 3.0));
    }
    await gesture.up();
    await tester.pump();
    await tester.tap(find.byTooltip(l10n.boardToolSelect));
    await tester.pump();
    await tester.tapAt(centre + const Offset(40, 15));
    await tester.pump();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump();
    expect(container.read(boardEditorProvider('b1')).value!.page.elements, hasLength(2));

    // The selection's own bar, beside it on the page.
    await tester.tap(find.byKey(const ValueKey('board-sel-duplicate')));
    await tester.pump();
    expect(container.read(boardEditorProvider('b1')).value!.page.elements, hasLength(3));
  });

  testWidgets('PD-55: the page menu shows each layout as a picture -- blank, lined, grid and dotted first -- and dotted is chosen', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    await tester.ensureVisible(find.byTooltip(l10n.boardLayout));
    await tester.tap(find.byTooltip(l10n.boardLayout));
    await tester.pumpAndSettle();
    final shown = [
      for (final e in tester.widgetList<KeyedSubtree>(find.byWidgetPredicate((w) => w is KeyedSubtree && '${w.key}'.contains('layout-thumb-'))))
        '${e.key}'.split('layout-thumb-').last.replaceAll(RegExp(r"[^a-z_]"), ''),
    ];
    expect(shown.take(4), ['plain', 'arabic_lines', 'grid', 'dotted']);
    expect(shown.toSet(), {for (final l in PageLayout.values) l.wire});
    await tester.tap(find.text(l10n.boardLayoutDotted));
    await tester.pumpAndSettle();
    expect(container.read(boardEditorProvider('b1')).value!.page.layout, PageLayout.dotted);
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  });

  Future<void> typeOnBoard(WidgetTester tester, L10n l10n, String text) async {
    await tester.tap(find.byTooltip(l10n.boardToolText));
    await tester.pump();
    await tester.tapAt(tester.getCenter(find.byType(BoardCanvas)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText), text);
    await tester.pump();
  }

  testWidgets('PD-55 (review of #384): Back while typing keeps the text', (tester) async {
    final l10n = await pump(
      tester,
      Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const BoardEditorScreen(boardId: 'b1'))),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await typeOnBoard(tester, l10n, 'Kept on Back');
    await tester.pageBack();
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
    // Leaving saves the board -- with the text that was being typed in it.
    expect((repo.saved.last.elements.single as TextElement).text, 'Kept on Back');
  });

  testWidgets('PD-55 (review of #384): going to the background while typing keeps the text', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    await typeOnBoard(tester, l10n, 'Kept in the background');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pumpAndSettle();
    final page = container.read(boardEditorProvider('b1')).value!.page;
    expect((page.elements.single as TextElement).text, 'Kept in the background');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  });

  testWidgets('PD-55: the laser is a tool on the panel, and pointing with it saves nothing', (tester) async {
    final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    await tester.ensureVisible(find.byTooltip(l10n.boardToolLaser));
    await tester.tap(find.byTooltip(l10n.boardToolLaser));
    await tester.pump();
    final centre = tester.getCenter(find.byType(BoardCanvas));
    final g = await tester.startGesture(centre, kind: PointerDeviceKind.mouse);
    await g.moveTo(centre + const Offset(80, 10));
    await g.up();
    await tester.pump(const Duration(seconds: 1));
    expect(container.read(boardEditorProvider('b1')).value!.page.elements, isEmpty);
    expect(find.text(l10n.boardSaved), findsOneWidget);
  });

  testWidgets('PD-55: the editor\'s Rewards opens the tray, and a star from it lands on the page', (tester) async {
    await pump(tester, const BoardEditorScreen(boardId: 'b1'));
    await tester.ensureVisible(find.byKey(const ValueKey('board-rewards')));
    await tester.tap(find.byKey(const ValueKey('board-rewards')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('reward-no-lesson')), findsOneWidget, reason: 'no rewards server here: decorate only');
    await tester.tap(find.byKey(const ValueKey('reward-star')));
    await tester.pumpAndSettle();
    final stamp = container.read(boardEditorProvider('b1')).value!.page.elements.single as StampElement;
    expect(stamp.stamp, StampKind.star);
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
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

  group('PD-55: full screen', () {
    late List<MethodCall> system;

    setUp(() {
      system = [];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        system.add(call);
        return null;
      });
    });
    tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

    // Immersive is setEnabledSystemUIMode; manual mode with every overlay (the bars back) is setEnabledSystemUIOverlays.
    Iterable<MethodCall> uiModes() =>
        system.where((c) => c.method == 'SystemChrome.setEnabledSystemUIMode' || c.method == 'SystemChrome.setEnabledSystemUIOverlays');

    testWidgets('on a phone: the page gets the whole screen, the tools float and fold away, and drawing still works', (tester) async {
      final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'), size: const Size(390, 844));
      final before = tester.getSize(find.byType(BoardCanvas));

      await tester.tap(find.byTooltip(l10n.boardFullScreen));
      await tester.pumpAndSettle();
      final after = tester.getSize(find.byType(BoardCanvas));
      expect(find.byType(AppBar), findsNothing);
      expect(after.width, 390);
      expect(after.height, 844, reason: 'the canvas fills the screen; the controls float over it');
      expect(after.height, greaterThan(before.height + 200), reason: 'the app bar, page strip and docked tools are gone');
      expect(uiModes().single.method, 'SystemChrome.setEnabledSystemUIMode');
      expect(uiModes().single.arguments, 'SystemUiMode.immersiveSticky');
      expect(find.byWidgetPredicate((w) => w is Semantics && w.properties.label == l10n.boardPageOf('1', '1')), findsOneWidget);

      // The tools float -- and fold down to one button, and come back.
      expect(find.byTooltip(l10n.boardToolPen), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('board-hide-tools')));
      await tester.pumpAndSettle();
      expect(find.byTooltip(l10n.boardToolPen), findsNothing);
      await tester.tap(find.byKey(const ValueKey('board-show-tools')));
      await tester.pumpAndSettle();
      expect(find.byTooltip(l10n.boardToolPen), findsOneWidget);

      // A stroke drawn in full screen is a stroke on the page.
      await tester.tap(find.byTooltip(l10n.boardToolPen));
      await tester.pump();
      final centre = tester.getCenter(find.byType(BoardCanvas));
      final gesture = await tester.startGesture(centre, kind: PointerDeviceKind.mouse);
      for (var i = 1; i <= 10; i++) {
        await gesture.moveTo(centre + Offset(i * 6.0, i * 2.0));
      }
      await gesture.up();
      await tester.pump();
      expect(container.read(boardEditorProvider('b1')).value!.page.elements.single, isA<InkElement>());

      await tester.tap(find.byKey(const ValueKey('board-exit-full-screen')));
      await tester.pumpAndSettle();
      expect(find.byType(AppBar), findsOneWidget);
      expect(uiModes().last.method, 'SystemChrome.setEnabledSystemUIOverlays', reason: 'the system bars come back');
      expect(uiModes().last.arguments, hasLength(SystemUiOverlay.values.length));
      await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
      await tester.pumpAndSettle();
    });

    testWidgets('Back leaves full screen first, then the board -- and the system bars come back', (tester) async {
      final l10n = await pump(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const BoardEditorScreen(boardId: 'b1'))),
              child: const Text('open'),
            ),
          ),
        ),
        size: const Size(844, 390),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(l10n.boardFullScreen));
      await tester.pumpAndSettle();
      expect(find.byType(AppBar), findsNothing);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(BoardEditorScreen), findsOneWidget, reason: 'the first Back only leaves full screen');
      expect(find.byType(AppBar), findsOneWidget);
      expect(uiModes().map((c) => c.method), ['SystemChrome.setEnabledSystemUIMode', 'SystemChrome.setEnabledSystemUIOverlays'], reason: '$system');

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(BoardEditorScreen), findsNothing);
    });

    testWidgets('on a wide screen the tools float along the side; the page bar is replaced by previous / next', (tester) async {
      repo.pages = const [
        BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: []),
        BoardPage(id: 'p2', position: 1, layout: PageLayout.grid, background: PageBackground.white, elements: []),
      ];
      final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
      await tester.tap(find.byTooltip(l10n.boardFullScreen));
      await tester.pumpAndSettle();
      // Along the start edge: the pen sits left of the page's centre (English).
      expect(tester.getCenter(find.byTooltip(l10n.boardToolPen)).dx, lessThan(100));
      expect(find.text('1 / 2'), findsOneWidget);
      expect(find.byWidgetPredicate((w) => w is Semantics && w.properties.label == l10n.boardPageOf('1', '2')), findsOneWidget);

      await tester.tap(find.byTooltip(l10n.boardNextPage));
      await tester.pumpAndSettle();
      expect(find.text('2 / 2'), findsOneWidget);
      expect(container.read(boardEditorProvider('b1')).value!.page.id, 'p2');
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.navigate_next)).onPressed, isNull);

      await tester.tap(find.byTooltip(l10n.boardPreviousPage));
      await tester.pumpAndSettle();
      expect(container.read(boardEditorProvider('b1')).value!.page.id, 'p1');
    });

    testWidgets('Arabic: the floating tools sit on the right, the start edge', (tester) async {
      final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'), locale: const Locale('ar'));
      await tester.tap(find.byTooltip(l10n.boardFullScreen));
      await tester.pumpAndSettle();
      expect(tester.getCenter(find.byTooltip(l10n.boardToolPen)).dx, greaterThan(1280 - 100));
    });
  });

  group('PD-55 Phase 1 (4): emoji and stickers', () {
    testWidgets('the stamp tool offers the emoji picker and the stickers; a chosen emoji is placed as a square stamp', (tester) async {
      final l10n = await pump(tester, const BoardEditorScreen(boardId: 'b1'));
      await tester.tap(find.byTooltip(l10n.boardToolStamp).first);
      await tester.pumpAndSettle();
      // The reward stickers sit with PD-39's stamps: icons, no faces.
      for (final k in [StampKind.medal, StampKind.trophy, StampKind.rocket, StampKind.rainbow, StampKind.balloon]) {
        expect(find.byIcon(kStampIcons[k]!), findsOneWidget, reason: '$k');
      }

      // Below the tools in the side panel: scrolled to, as a teacher would.
      await tester.ensureVisible(find.byKey(const ValueKey('board-emoji')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('board-emoji')));
      await tester.pumpAndSettle();
      expect(find.text(l10n.boardEmojiPick), findsOneWidget);
      expect(find.text(l10n.boardEmojiAnimals), findsOneWidget);
      await tester.scrollUntilVisible(find.byKey(const ValueKey('emoji-🦉')), 200, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.byKey(const ValueKey('emoji-🦉')));
      await tester.pumpAndSettle();
      expect(find.text(l10n.boardEmojiPick), findsNothing);

      await tester.tapAt(tester.getCenter(find.byType(BoardCanvas)));
      await tester.pumpAndSettle();
      final placed = container.read(boardEditorProvider('b1')).value!.page.elements.single as StampElement;
      expect(placed.stamp, StampKind.emoji);
      expect(placed.text, '🦉');
      expect(placed.rect.width, closeTo(140, 0.001), reason: 'a square, like an icon stamp');
      expect(placed.rect.height, closeTo(140, 0.001));
      await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
      await tester.pumpAndSettle();
      expect((repo.saved.last.elements.single as StampElement).text, '🦉');
    });
  });
}
