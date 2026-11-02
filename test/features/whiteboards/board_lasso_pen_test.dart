// PD-55 PR-2: drawing and selecting the way a teacher explains --
// a freehand lasso (Shift keeps the rectangle), copy / paste / duplicate, an
// input filter that steadies a finger or a mouse but never a pen, palm
// rejection on a tablet, and an eraser that shows where it reaches.
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/domain/stroke_points.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_canvas.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

const _ink = Color(0xFF1B1B1F);

StampElement _stamp(String id, Offset centre) =>
    StampElement(id: id, stamp: StampKind.star, rect: Rect.fromCenter(center: centre, width: 100, height: 100), color: _ink);

InkElement _line(String id, double fromX, double toX, double y) => InkElement(
  id: id,
  points: [for (var x = fromX; x <= toX; x += 20) StrokePoint(x, y, 0.5)],
  color: _ink,
  width: 4,
);

/// A closed loop around [c], in page units, starting at its top -- so the
/// press that starts it is on empty page, not on what it encloses.
List<Offset> _loop(Offset c, double rx, [double? ry]) => [
  for (var i = 0; i <= 24; i++)
    c + Offset(math.cos(i * math.pi / 12 - math.pi / 2) * rx, math.sin(i * math.pi / 12 - math.pi / 2) * (ry ?? rx)),
];

class _Harness {
  final commits = <List<BoardElement>>[];
  final key = GlobalKey<BoardCanvasState>();
  BoardCanvasState get state => key.currentState!;
  late BoardPage page;
  late StateSetter _set;

  Future<void> pump(
    WidgetTester tester, {
    List<BoardElement> elements = const [],
    BoardTool tool = BoardTool.select,
    Size size = const Size(1280, 800),
    PageShape shape = PageShape.wide,
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    page = BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, shape: shape, elements: elements);
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
          builder: (context, setState) => Scaffold(
            body: Builder(
              builder: (context) {
                _set = setState;
                return BoardCanvas(
              key: key,
              page: page,
              tool: tool,
              style: const ToolStyle(color: _ink, width: 6),
              readOnly: false,
              onCommit: (elements) {
                commits.add(elements);
                setState(() => page = page.copyWith(elements: elements));
              },
                );
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Another page in the same canvas, as going to another page does.
  Future<void> show(WidgetTester tester, BoardPage next) async {
    _set(() => page = next);
    await tester.pumpAndSettle();
  }

  Future<void> drag(WidgetTester tester, List<Offset> pagePoints, {PointerDeviceKind kind = PointerDeviceKind.mouse}) async {
    final g = await tester.startGesture(state.screenOf(pagePoints.first), kind: kind);
    for (final p in pagePoints.skip(1)) {
      await g.moveTo(state.screenOf(p));
    }
    await g.up();
    await tester.pumpAndSettle();
  }
}

void main() {
  group('the lasso', () {
    testWidgets('selects what its loop encloses, by each element\'s centre', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_stamp('a', const Offset(400, 400)), _stamp('b', const Offset(1200, 400))]);
      await h.drag(tester, _loop(const Offset(400, 400), 160));
      expect(h.state.selection, {'a'});
      expect(h.commits, isEmpty, reason: 'selecting changes nothing');
    });

    testWidgets('takes a stroke when at least half of its points are inside', (tester) async {
      final h = _Harness();
      // A stroke from x=100 to x=500 (21 points).
      await h.pump(tester, elements: [_line('s', 100, 500, 600)]);
      await h.drag(tester, _loop(const Offset(200, 600), 140, 80)); // x 60..340: 12 of 21 points
      expect(h.state.selection, {'s'});

      await h.pump(tester, elements: [_line('s', 100, 500, 600)]);
      await h.drag(tester, _loop(const Offset(160, 600), 90, 80)); // x 70..250: 8 of 21 points
      expect(h.state.selection, isEmpty);
    });

    testWidgets('Shift keeps the rectangle: anything it touches', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_stamp('a', const Offset(400, 400))]);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      // A rectangle that only clips the stamp's corner: the lasso would not take it.
      await h.drag(tester, [const Offset(200, 200), const Offset(300, 300), const Offset(370, 370)]);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      expect(h.state.selection, {'a'});
    });
  });

  group('copy, paste, duplicate', () {
    testWidgets('a pasted copy is a new element, 24 units on, and is what is selected after', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_stamp('a', const Offset(400, 400))]);
      await h.drag(tester, _loop(const Offset(400, 400), 160));
      h.state.copySelection();
      expect(h.commits, isEmpty, reason: 'copying changes nothing');
      h.state.paste();
      await tester.pumpAndSettle();

      final after = h.commits.single;
      expect(after, hasLength(2));
      final copy = after.last as StampElement;
      expect(copy.id, isNot('a'));
      expect(copy.rect.center, const Offset(424, 424));
      expect(h.state.selection, {copy.id});

      h.state.paste();
      await tester.pumpAndSettle();
      expect((h.commits.last.last as StampElement).rect.center, const Offset(448, 448), reason: 'each paste steps on');
    });

    testWidgets('the selection\'s bar: 48 px targets, Paste only once something is copied, Delete in one step', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_stamp('a', const Offset(400, 400))]);
      await h.drag(tester, _loop(const Offset(400, 400), 160));
      for (final k in ['board-sel-copy', 'board-sel-paste', 'board-sel-duplicate', 'board-sel-delete']) {
        final size = tester.getSize(find.byKey(ValueKey(k)));
        expect(math.min(size.width, size.height), greaterThanOrEqualTo(44), reason: '$k is $size');
      }
      IconButton button(String k) => tester.widget<IconButton>(find.byKey(ValueKey(k)));
      expect(button('board-sel-paste').onPressed, isNull);
      await tester.tap(find.byKey(const ValueKey('board-sel-copy')));
      await tester.pump();
      expect(button('board-sel-paste').onPressed, isNotNull);

      await tester.tap(find.byKey(const ValueKey('board-sel-delete')));
      await tester.pumpAndSettle();
      expect(h.commits.single, isEmpty);
      expect(find.byKey(const ValueKey('board-sel-delete')), findsNothing, reason: 'nothing selected, no bar');
    });

    testWidgets('PD-55: copied on a tall page, pasted on a wide one, it lands on the page -- not below it', (tester) async {
      final h = _Harness();
      await h.pump(tester, shape: PageShape.tall, size: const Size(800, 1280), elements: [_stamp('a', const Offset(540, 1700))]);
      await h.drag(tester, _loop(const Offset(540, 1700), 160));
      h.state.copySelection();
      await h.show(
        tester,
        const BoardPage(id: 'p2', position: 1, layout: PageLayout.plain, background: PageBackground.white, elements: []),
      );
      h.state.paste();
      await tester.pumpAndSettle();
      final copy = h.commits.last.single as StampElement;
      expect(copy.rect.bottom, 1080, reason: 'moved up just enough to be on the wide page');
      expect(copy.rect.center.dx, 564, reason: 'across, it was already on the page: only the 24-unit step');
    });

    testWidgets('PD-55: a tall page is drawn on to its foot -- far below where a wide page ends', (tester) async {
      final h = _Harness();
      await h.pump(tester, shape: PageShape.tall, size: const Size(390, 844), tool: BoardTool.pen);
      await h.drag(tester, [const Offset(300, 1700), const Offset(500, 1800), const Offset(700, 1900), const Offset(900, 2100)]);
      final ink = h.commits.single.single as InkElement;
      final ys = ink.points.map((p) => p.y).toList();
      expect(ys.reduce(math.max), 1920, reason: 'held to the tall page: 1920 units tall');
      expect(ys.reduce(math.min), greaterThan(1080));
      expect(ink.points.map((p) => p.x).reduce(math.max), lessThanOrEqualTo(1080), reason: 'and 1080 wide');
    });

    testWidgets('duplicate is copy and paste in one undo step', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_stamp('a', const Offset(400, 400))]);
      await h.drag(tester, _loop(const Offset(400, 400), 160));
      h.state.duplicateSelection();
      await tester.pumpAndSettle();
      expect(h.commits, hasLength(1));
      expect(h.commits.single, hasLength(2));
    });

    testWidgets('a copied verse is the reference again -- never its text', (tester) async {
      const verse = {
        'id': 'v1',
        'kind': 'verse',
        'surah': 1,
        'fromAyah': 1,
        'toAyah': 2,
        'datasetId': 'tanzil-uthmani-1.1',
        'rangeSha256': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'transform': {'x': 300, 'y': 300, 'w': 400, 'h': 200},
      };
      final h = _Harness();
      await h.pump(tester, elements: [BoardElement.fromJson(verse)]);
      await h.drag(tester, _loop(const Offset(500, 400), 300, 200));
      expect(h.state.selection, {'v1'});
      h.state.duplicateSelection();
      await tester.pumpAndSettle();
      final copy = h.commits.single.last;
      expect(copy, isA<VerseElement>());
      final json = copy.toJson();
      expect(json.keys.toSet().difference({'id', 'kind', 'z', 'transform', 'style', 'surah', 'fromAyah', 'toAyah', 'datasetId', 'rangeSha256'}), isEmpty);
      expect(json['id'], isNot('v1'));
    });
  });

  group('the pen', () {
    List<Offset> zigzag() => [for (var i = 0; i <= 30; i++) Offset(300 + i * 12.0, 500 + (i.isEven ? 4.0 : -4.0))];
    // Between its ends, which stay where they were drawn.
    double wobble(InkElement s) => s.points.sublist(1, s.points.length - 1).map((p) => (p.y - 500).abs()).reduce(math.max);

    testWidgets('a mouse or finger stroke is steadied; a pen\'s is drawn as it came', (tester) async {
      final h = _Harness();
      await h.pump(tester, tool: BoardTool.pen);
      await h.drag(tester, zigzag());
      final mouse = h.commits.last.whereType<InkElement>().single;
      expect(wobble(mouse), lessThan(3), reason: 'the jitter of a hand on a mouse is smoothed');

      await h.pump(tester, tool: BoardTool.pen);
      await h.drag(tester, zigzag(), kind: PointerDeviceKind.stylus);
      final pen = h.commits.last.whereType<InkElement>().single;
      expect(wobble(pen), greaterThan(3.5), reason: 'a pen is precise: never filtered');
    });

    testWidgets('palm rejection on a tablet: once a pen is seen, a palm or finger moves the view and draws nothing', (tester) async {
      final h = _Harness();
      await h.pump(tester, tool: BoardTool.pen, size: const Size(820, 1180));
      await h.drag(tester, [const Offset(300, 300), const Offset(400, 320), const Offset(500, 300)], kind: PointerDeviceKind.stylus);
      expect(h.commits, hasLength(1));
      await h.drag(tester, [const Offset(300, 600), const Offset(400, 620), const Offset(500, 600)], kind: PointerDeviceKind.touch);
      expect(h.commits, hasLength(1), reason: 'the palm drew nothing');
    });

    testWidgets('a fast eraser sweep erases all along its way, not only where the pointer reported', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_line('s', 100, 500, 600)], tool: BoardTool.eraser);
      // One jump from above the stroke to below it.
      await h.drag(tester, [const Offset(300, 450), const Offset(300, 750)]);
      expect(h.commits.single.whereType<InkElement>(), isEmpty);

      await h.pump(tester, elements: [_line('s', 100, 500, 600)], tool: BoardTool.areaEraser);
      await h.drag(tester, [const Offset(300, 450), const Offset(300, 750)]);
      expect(h.commits.last.whereType<InkElement>(), hasLength(2), reason: 'cut in two where the sweep crossed it');
    });

    test('the area eraser cuts a long, simplified stroke between its points too', () {
      // Two points 400 units apart: what a straight line becomes after simplifying.
      final sparse = InkElement(id: 's', points: const [StrokePoint(100, 600, 0.5), StrokePoint(500, 600, 0.5)], color: _ink, width: 4);
      var n = 0;
      final out = BoardGeometry.eraseArea([sparse], const Offset(300, 600), 14, () => 'n${n++}');
      final runs = out.whereType<InkElement>().toList();
      expect(runs, hasLength(2), reason: 'cut in the middle, where no point was');
      expect(runs.first.points.first.offset, const Offset(100, 600));
      expect(runs.last.points.last.offset, const Offset(500, 600));
      expect(runs.every((r) => r.points.every((p) => (p.offset - const Offset(300, 600)).distance > 14)), isTrue);
    });

    testWidgets('the area eraser shows the ring it erases within, while erasing', (tester) async {
      final h = _Harness();
      await h.pump(tester, elements: [_line('s', 100, 500, 600)], tool: BoardTool.areaEraser);
      final g = await tester.startGesture(h.state.screenOf(const Offset(300, 600)), kind: PointerDeviceKind.mouse);
      await tester.pump();
      final ring = h.state.eraserRing;
      expect(ring, isNotNull);
      expect(ring!.center, const Offset(300, 600));
      await g.up();
      await tester.pumpAndSettle();
      expect(h.state.eraserRing, isNull, reason: 'no ring once the pointer is gone');
    });
  });
}
