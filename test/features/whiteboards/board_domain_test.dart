// PD-39: the board's drawing model, without a canvas -- the stroke codec, the
// JSON round trip (an unknown kind survives untouched), undo/redo and the
// erasers (docs/product/pd039-whiteboard-design.md §4.1, §4.5).
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/domain/stroke_points.dart';

InkElement ink(String id, List<Offset> pts, {double width = 4}) =>
    InkElement(id: id, points: [for (final p in pts) StrokePoint(p.dx, p.dy, 0.5)], color: const Color(0xFF123456), width: width);

void main() {
  group('the stroke codec', () {
    test('round-trips points to 0.1 unit, with pressure, in a fraction of JSON', () {
      final points = [for (var i = 0; i < 200; i++) StrokePoint(100 + i * 1.37, 900 - i * 0.91, (i % 10) / 10)];
      final encoded = StrokePointCodec.encode(points);
      final back = StrokePointCodec.decode(encoded);
      expect(back, hasLength(points.length));
      for (var i = 0; i < points.length; i++) {
        expect(back[i].x, closeTo(points[i].x, 0.051));
        expect(back[i].y, closeTo(points[i].y, 0.051));
        expect(back[i].pressure, closeTo(points[i].pressure, 1 / 255));
      }
      expect(encoded.length, lessThan(points.length * 8));
    });

    test('a jump longer than an int16 still decodes to the same end point', () {
      final back = StrokePointCodec.decode(StrokePointCodec.encode(const [StrokePoint(0, 0), StrokePoint(5000, -4000)]));
      expect(back.last.x, closeTo(5000, 0.05));
      expect(back.last.y, closeTo(-4000, 0.05));
    });

    test('a damaged value gives no points instead of throwing', () {
      expect(StrokePointCodec.decode('not base64!'), isEmpty);
      expect(StrokePointCodec.decode('AAAA'), isEmpty);
    });
  });

  group('a page document', () {
    test('round-trips every MVP element, and keeps a verse (not drawn before PR-3) exactly as it came', () {
      final verse = <String, Object?>{
        'id': 'v1', 'kind': 'verse', 'surah': 1, 'fromAyah': 1, 'toAyah': 7,
        'datasetId': 'tanzil-uthmani-1.1', 'rangeSha256': 'a' * 64,
      };
      final page = BoardPage.fromJson({
        'id': 'p1',
        'position': 0,
        'layout': 'arabic_lines',
        'background': 'cream',
        'document': {
          'v': 1,
          'elements': [
            ink('s1', const [Offset(10, 10), Offset(20, 30)]).toJson(),
            const ShapeElement(id: 'r1', shape: ShapeKind.ellipse, rect: Rect.fromLTWH(1, 2, 3, 4), stroke: Color(0xFFAA0000), width: 3).toJson(),
            const LineElement(id: 'a1', from: Offset(0, 0), to: Offset(50, 50), color: Color(0xFF000000), width: 4, arrow: true, bothEnds: true).toJson(),
            const TextElement(id: 't1', text: 'بِسْمِ اللَّهِ', topLeft: Offset(5, 5), size: Size(400, 80), fontSize: 48, color: Color(0xFF1B1B1B)).toJson(),
            const StampElement(id: 'st', stamp: StampKind.excellentAr, rect: Rect.fromLTWH(0, 0, 200, 80), color: Color(0xFF2E7D32), text: 'ممتاز').toJson(),
            verse,
          ],
        },
      });
      expect(page.layout, PageLayout.arabicLines);
      expect(page.background, PageBackground.cream);
      expect(page.elements.map((e) => e.runtimeType), [InkElement, ShapeElement, LineElement, TextElement, StampElement, OpaqueElement]);
      final again = BoardPage.fromJson({'id': 'p1', 'document': page.documentJson()});
      expect(again.documentJson(), page.documentJson());
      expect((page.documentJson()['elements'] as List).last, verse);
    });

    test('moving and scaling keep ids; a verse without a position is not moved', () {
      final s = ink('s1', const [Offset(10, 10), Offset(20, 20)]);
      final moved = s.translated(const Offset(5, -5)) as InkElement;
      expect(moved.id, 's1');
      expect(moved.points.first.offset, const Offset(15, 5));
      const unplaced = OpaqueElement('v', {'id': 'v', 'kind': 'verse'});
      expect(identical(unplaced.translated(const Offset(1, 1)), unplaced), isTrue);
    });
  });

  group('undo and redo', () {
    test('step back and forward; a new change drops the redo', () {
      final h = PageHistory(const []);
      final a = [ink('a', const [Offset(0, 0), Offset(1, 1)])];
      final b = [...a, ink('b', const [Offset(2, 2), Offset(3, 3)])];
      h.push(a);
      h.push(b);
      expect(h.undo(), a);
      expect(h.redo(), b);
      h.undo();
      h.push(const []);
      expect(h.canRedo, isFalse);
    });

    test('keeps at most 100 steps', () {
      final h = PageHistory(const []);
      for (var i = 0; i < 150; i++) {
        h.push([ink('$i', const [Offset(0, 0)])]);
      }
      var n = 0;
      while (h.undo() != null) {
        n++;
      }
      expect(n, PageHistory.depth);
    });
  });

  group('the erasers', () {
    final line = ink('s', [for (var x = 0.0; x <= 100; x += 5) Offset(x, 50)]);
    const box = ShapeElement(id: 'r', shape: ShapeKind.rect, rect: Rect.fromLTWH(40, 40, 20, 20), stroke: Color(0xFF000000), width: 2);

    test('the stroke eraser takes a touched stroke whole and never a shape', () {
      expect(BoardGeometry.eraseStrokes([line, box], const Offset(50, 52), 4).map((e) => e.id), ['r']);
      expect(BoardGeometry.eraseStrokes([line, box], const Offset(50, 90), 4).map((e) => e.id), ['s', 'r']);
    });

    test('the area eraser splits a stroke into the runs that remain, with new ids', () {
      var n = 0;
      final out = BoardGeometry.eraseArea([line, box], const Offset(50, 50), 6, () => 'n${n++}');
      final runs = out.whereType<InkElement>().toList();
      expect(runs, hasLength(2));
      expect(runs.map((r) => r.id), ['n0', 'n1']);
      expect(runs.first.points.last.x, lessThan(45));
      expect(runs.last.points.first.x, greaterThan(55));
      expect(out.whereType<ShapeElement>(), hasLength(1));
    });

    test('simplifying a straight stroke keeps its ends and drops the middle', () {
      final pts = [for (var x = 0.0; x <= 100; x += 1) StrokePoint(x, 10)];
      final simple = BoardGeometry.simplify(pts);
      expect(simple.first.x, 0);
      expect(simple.last.x, 100);
      expect(simple.length, lessThan(5));
    });
  });
}
