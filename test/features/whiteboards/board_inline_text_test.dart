// PD-55 PR-1: text is typed ON the board, where the teacher taps -- the owner
// hit a modal "Write here" dialog with Save and Cancel instead. Edit in place,
// a double tap re-edits, one undo step per edit, size / colour / bold on a bar
// beside it, rotation, and the direction of each paragraph from its first
// strong character.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_canvas.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_painter.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

const _ink = Color(0xFF1B1B1F);

BoardPage _page(List<BoardElement> elements) =>
    BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: elements);

TextElement _text(String id, String text, {Offset at = const Offset(400, 300), double rotation = 0}) => TextElement(
  id: id,
  text: text,
  topLeft: at,
  size: const Size(400, 80),
  fontSize: 48,
  color: _ink,
  rotation: rotation,
);

class _Harness {
  final commits = <List<BoardElement>>[];
  int deleteShortcut = 0;
  final key = GlobalKey<BoardCanvasState>();

  BoardCanvasState get state => key.currentState!;

  Future<L10n> pump(WidgetTester tester, {List<BoardElement> elements = const [], BoardTool tool = BoardTool.text}) async {
    await tester.binding.setSurfaceSize(const Size(1280, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var page = _page(elements);
    await tester.pumpWidget(
      MaterialApp(
        theme: JawwidTheme.light(isArabic: false),
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('en'), Locale('ar')],
        home: StatefulBuilder(
          builder: (context, setState) => CallbackShortcuts(
            // The editor screen's own shortcuts sit above the canvas: typing must
            // never reach them (Backspace would delete the selection).
            bindings: {
              const SingleActivator(LogicalKeyboardKey.backspace): () => deleteShortcut++,
              const SingleActivator(LogicalKeyboardKey.delete): () => deleteShortcut++,
            },
            child: Focus(
              autofocus: true,
              child: Scaffold(
                body: BoardCanvas(
                  key: key,
                  page: page,
                  tool: tool,
                  style: const ToolStyle(color: _ink, width: 6),
                  readOnly: false,
                  onCommit: (elements) {
                    commits.add(elements);
                    setState(() => page = page.copyWith(elements: elements));
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return L10n.delegate.load(const Locale('en'));
  }

  Future<void> tapPage(WidgetTester tester, Offset pagePoint) async {
    await tester.tapAt(state.screenOf(pagePoint));
    await tester.pumpAndSettle();
  }
}

TextElement _only(List<BoardElement> elements) => elements.whereType<TextElement>().single;

void main() {
  testWidgets('the Text tool types ON the board where it is tapped: an editor in place, and no dialog', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));

    expect(find.byType(Dialog), findsNothing);
    expect(find.byType(AlertDialog), findsNothing);
    final editor = find.byType(EditableText);
    expect(editor, findsOneWidget);
    // It sits where the teacher tapped (within a few pixels of the tap, on screen).
    final box = tester.getRect(editor);
    final tap = h.state.screenOf(const Offset(900, 500));
    expect(box.inflate(60).contains(tap), isTrue, reason: 'editor at $box, tap at $tap');
    expect(h.commits, isEmpty, reason: 'nothing is committed while typing');
  });

  testWidgets('typed text commits on a tap outside, as one undo step; Arabic grows from the tap towards the left', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));
    await tester.enterText(find.byType(EditableText), 'مرحبا بكم');
    await tester.pump();
    expect(h.commits, isEmpty);

    await h.tapPage(tester, const Offset(200, 900));
    expect(h.commits, hasLength(1));
    final t = _only(h.commits.single);
    expect(t.text, 'مرحبا بكم');
    expect(textDirectionOf(t.text), TextDirection.rtl);
    expect(t.bounds.right, closeTo(900, 2), reason: 'right-to-left text ends where it was tapped');
    expect(find.byType(EditableText), findsNothing, reason: 'the tap that ends an edit does not start another');
  });

  testWidgets('English grows from the tap towards the right', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));
    await tester.enterText(find.byType(EditableText), 'Hello');
    await h.tapPage(tester, const Offset(200, 900));
    expect(_only(h.commits.single).bounds.left, closeTo(900, 2));
  });

  testWidgets('an empty edit is discarded: nothing to commit, nothing to undo', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));
    await tester.enterText(find.byType(EditableText), '   ');
    await h.tapPage(tester, const Offset(200, 900));
    expect(h.commits, isEmpty);
  });

  testWidgets('Escape ends the edit and keeps the text', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));
    await tester.enterText(find.byType(EditableText), 'Hello');
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(_only(h.commits.single).text, 'Hello');
  });

  testWidgets('Backspace while typing edits the text -- it never reaches the board\'s delete shortcut', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));
    await tester.enterText(find.byType(EditableText), 'Helloo');
    await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
    await tester.pump();
    expect(h.deleteShortcut, 0);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(_only(h.commits.single).text, 'Hello');
  });

  testWidgets('a double tap re-edits existing text in place, with any tool; the edit keeps its id', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hello')], tool: BoardTool.select);
    final at = h.state.screenOf(const Offset(450, 330));
    await tester.tapAt(at);
    await tester.pump(const Duration(milliseconds: 80));
    await tester.tapAt(at);
    await tester.pumpAndSettle();

    final editor = tester.widget<EditableText>(find.byType(EditableText));
    expect(editor.controller.text, 'Hello');
    await tester.enterText(find.byType(EditableText), 'Hello there');
    await h.tapPage(tester, const Offset(1500, 900));
    final edited = _only(h.commits.last);
    expect([edited.id, edited.text], ['t1', 'Hello there']);
  });

  testWidgets('the Text tool on an existing text edits it rather than starting a new one', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hello')]);
    await h.tapPage(tester, const Offset(450, 330));
    expect(tester.widget<EditableText>(find.byType(EditableText)).controller.text, 'Hello');
  });

  testWidgets('clearing an existing text removes it, as one undo step', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hello')]);
    await h.tapPage(tester, const Offset(450, 330));
    await tester.enterText(find.byType(EditableText), '');
    await h.tapPage(tester, const Offset(1500, 900));
    expect(h.commits.single.whereType<TextElement>(), isEmpty);
  });

  testWidgets('the style bar: bigger, bold and a colour apply to the text being typed, with targets of at least 44 px', (tester) async {
    final h = _Harness();
    await h.pump(tester);
    await h.tapPage(tester, const Offset(900, 500));
    await tester.enterText(find.byType(EditableText), 'Hello');

    for (final k in ['board-text-bigger', 'board-text-smaller', 'board-text-bold', 'board-text-color-1', 'board-text-done']) {
      final size = tester.getSize(find.byKey(ValueKey(k)));
      expect(math.min(size.width, size.height), greaterThanOrEqualTo(44), reason: '$k is $size');
    }
    await tester.tap(find.byKey(const ValueKey('board-text-bigger')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('board-text-bold')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('board-text-color-1')));
    await tester.pump();
    expect(find.byType(EditableText), findsOneWidget, reason: 'styling does not end the edit');
    await tester.tap(find.byKey(const ValueKey('board-text-done')));
    await tester.pumpAndSettle();

    final t = _only(h.commits.single);
    expect(t.bold, isTrue);
    expect(t.fontSize, greaterThan(48));
    expect(t.color, isNot(_ink));
  });

  testWidgets('a selected text is styled from the same bar, each change one undo step', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hello')], tool: BoardTool.select);
    await h.tapPage(tester, const Offset(450, 330));
    await tester.tap(find.byKey(const ValueKey('board-text-bold')));
    await tester.pumpAndSettle();
    expect(h.commits, hasLength(1));
    expect(_only(h.commits.single).bold, isTrue);
  });

  testWidgets('the rotate handle turns a selected text, snapping to upright', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hello')], tool: BoardTool.select);
    await h.tapPage(tester, const Offset(450, 330));
    final handle = h.state.rotateHandleOnScreen!;
    // Drag the handle to the right of the centre: a quarter turn.
    final centre = h.state.screenOf(const Offset(600, 340));
    final gesture = await tester.startGesture(handle);
    await gesture.moveTo(centre + const Offset(200, 0));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(_only(h.commits.single).rotation, closeTo(math.pi / 2, 0.001), reason: 'snapped to 90 degrees');
  });

  testWidgets('a page change while typing keeps the text -- on the page it was typed on, never the new one (review of #384)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1280, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final key = GlobalKey<BoardCanvasState>();
    final commits = <List<BoardElement>>[];
    final committedTo = <(String, List<BoardElement>)>[];
    final pageA = _page([]);
    final pageB = BoardPage(id: 'p2', position: 1, layout: PageLayout.plain, background: PageBackground.white, elements: [_text('other', 'On B')]);
    Widget canvas(BoardPage page) => MaterialApp(
      localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: Scaffold(
        body: BoardCanvas(
          key: key,
          page: page,
          tool: BoardTool.text,
          style: const ToolStyle(color: _ink, width: 6),
          readOnly: false,
          onCommit: commits.add,
          onCommitTo: (id, elements) => committedTo.add((id, elements)),
        ),
      ),
    );
    await tester.pumpWidget(canvas(pageA));
    await tester.pumpAndSettle();
    await tester.tapAt(key.currentState!.screenOf(const Offset(900, 500)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText), 'Typed on A');
    await tester.pumpWidget(canvas(pageB));
    await tester.pumpAndSettle();

    expect(commits, isEmpty, reason: 'nothing committed to the page now shown');
    expect(committedTo, hasLength(1));
    expect(committedTo.single.$1, 'p1');
    expect(_only(committedTo.single.$2).text, 'Typed on A');
    expect(find.byType(EditableText), findsNothing);
  });

  testWidgets('with the pen, a quick second tap draws -- the double-tap shortcut is for select, hand and text only', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hello')], tool: BoardTool.pen);
    final at = h.state.screenOf(const Offset(450, 330));
    await tester.tapAt(at);
    await tester.pump(const Duration(milliseconds: 80));
    await tester.tapAt(at);
    await tester.pumpAndSettle();
    expect(find.byType(EditableText), findsNothing);
  });

  testWidgets('a turned text grows about its centre when re-edited', (tester) async {
    final h = _Harness();
    await h.pump(tester, elements: [_text('t1', 'Hi', rotation: math.pi / 2)], tool: BoardTool.text);
    await h.tapPage(tester, const Offset(600, 340));
    await tester.enterText(find.byType(EditableText), 'Hi there, a much longer line');
    await h.tapPage(tester, const Offset(1500, 900));
    final t = _only(h.commits.single);
    expect(t.box.center.dx, closeTo(600, 1));
    expect(t.box.center.dy, closeTo(340, 20));
  });

  group('the text element', () {
    test('bold and rotation round-trip; a PD-39 text without them reads as before and saves the same bytes', () {
      final old = {'id': 't1', 'kind': 'text', 'text': 'Hi', 'x': 1, 'y': 2, 'w': 30, 'h': 20, 'size': 24, 'color': '#1b1b1f'};
      final read = BoardElement.fromJson(old) as TextElement;
      expect([read.bold, read.rotation], [false, 0]);
      expect(read.toJson(), old, reason: 'no new keys on an unchanged text');

      final styled = read.copyWith(bold: true, rotation: math.pi / 2);
      final again = BoardElement.fromJson(styled.toJson()) as TextElement;
      expect([again.bold, again.rotation], [true, math.pi / 2]);
    });

    test('a rotated text is hit where it is drawn, not where its unrotated box was', () {
      // A wide box, turned a quarter: it now stands upright around its centre.
      const t = TextElement(id: 't', text: 'x', topLeft: Offset(0, 0), size: Size(400, 40), fontSize: 24, color: _ink, rotation: math.pi / 2);
      expect(BoardGeometry.hit([t], const Offset(200, 180)), same(t), reason: 'above the centre, inside the upright box');
      expect(BoardGeometry.hit([t], const Offset(20, 20)), isNull, reason: 'a corner of the old box is empty now');
      expect(t.bounds.height, greaterThan(t.bounds.width));
    });
  });
}
