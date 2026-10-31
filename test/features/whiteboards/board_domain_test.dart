// PD-39: the board's drawing model, without a canvas -- the stroke codec, the
// JSON round trip (an unknown kind survives untouched), undo/redo and the
// erasers (docs/product/pd039-whiteboard-design.md §4.1, §4.5).
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/domain/page_size.dart';
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
    test('round-trips every MVP element, and an image naming its asset (PR-4), and keeps a kind it does not draw exactly as it came', () {
      final verse = <String, Object?>{
        'id': 'v1',
        'kind': 'verse',
        'surah': 1,
        'fromAyah': 1,
        'toAyah': 7,
        'datasetId': 'tanzil-uthmani-1.1',
        'rangeSha256': 'a' * 64,
        'transform': {'x': 260.0, 'y': 300.0, 'w': 1400.0, 'h': 420.0},
        'style': {'size': 64.0, 'color': '#1b1b1b'},
      };
      final image = <String, Object?>{'id': 'i1', 'kind': 'image', 'assetId': '3f2c1a9e-0b1d-4c2e-9f00-1234567890ab', 'x': 10.0, 'y': 20.0, 'w': 400.0, 'h': 300.0};
      // A kind newer than this build: kept and saved back exactly as it came.
      final newer = <String, Object?>{'id': 'n1', 'kind': 'sticker', 'x': 1.0, 'y': 2.0, 'w': 3.0, 'h': 4.0, 'emoji': 'x'};
      final page = BoardPage.fromJson({
        'id': 'p1',
        'position': 0,
        'layout': 'arabic_lines',
        'background': 'cream',
        'document': {
          'v': 1,
          'elements': [
            ink('s1', const [Offset(10, 10), Offset(20, 30)]).toJson(),
            const ShapeElement(
              id: 'r1',
              shape: ShapeKind.ellipse,
              rect: Rect.fromLTWH(1, 2, 3, 4),
              stroke: Color(0xFFAA0000),
              width: 3,
            ).toJson(),
            const LineElement(
              id: 'a1',
              from: Offset(0, 0),
              to: Offset(50, 50),
              color: Color(0xFF000000),
              width: 4,
              arrow: true,
              bothEnds: true,
            ).toJson(),
            const TextElement(
              id: 't1',
              text: 'بِسْمِ اللَّهِ',
              topLeft: Offset(5, 5),
              size: Size(400, 80),
              fontSize: 48,
              color: Color(0xFF1B1B1B),
            ).toJson(),
            const StampElement(
              id: 'st',
              stamp: StampKind.excellentAr,
              rect: Rect.fromLTWH(0, 0, 200, 80),
              color: Color(0xFF2E7D32),
              text: 'ممتاز',
            ).toJson(),
            verse,
            image,
            newer,
          ],
        },
      });
      expect(page.layout, PageLayout.arabicLines);
      expect(page.background, PageBackground.cream);
      expect(page.elements.map((e) => e.runtimeType), [
        InkElement,
        ShapeElement,
        LineElement,
        TextElement,
        StampElement,
        VerseElement,
        ImageElement,
        OpaqueElement,
      ]);
      expect((page.elements[6] as ImageElement).rect, const Rect.fromLTWH(10, 20, 400, 300));
      expect(page.elements.last.toJson(), newer);
      final again = BoardPage.fromJson({'id': 'p1', 'document': page.documentJson()});
      expect(again.documentJson(), page.documentJson());
      final out = page.documentJson()['elements'] as List;
      // The verse is a reference and its place: exactly the fields the server allows, no text.
      expect(out[5], verse);
      expect(out[6], image);
      expect(out.last, newer);
    });

    test('an image keeps the fields this build does not know, through moves and scales (review of #328)', () {
      final json = <String, Object?>{
        'id': 'i1',
        'kind': 'image',
        'assetId': 'aaaaaaaa-0000-4000-8000-000000000001',
        'x': 10.0,
        'y': 20.0,
        'w': 400.0,
        'h': 300.0,
        'z': 7,
        'crop': {'x': 0.1, 'y': 0.0, 'w': 0.8, 'h': 1.0},
        'style': {'border': 'gold', 'radius': 12},
        'transform': [1, 0, 0, 1, 0, 0],
      };
      final image = BoardElement.fromJson(json) as ImageElement;
      expect(image.toJson(), json);
      final moved = image.translated(const Offset(5, 5)).scaled(Offset.zero, 2, 2).toJson();
      expect(moved['rect'], isNull);
      expect({'x': moved['x'], 'y': moved['y'], 'w': moved['w'], 'h': moved['h']}, {'x': 30.0, 'y': 50.0, 'w': 800.0, 'h': 600.0});
      for (final key in ['z', 'crop', 'style', 'transform']) {
        expect(moved[key], json[key], reason: key);
      }
      // A known field is never overwritten by a stale copy in the extras.
      expect(moved['assetId'], json['assetId']);
    });

    test('moving and scaling keep ids; a verse without a position is not moved', () {
      final s = ink('s1', const [Offset(10, 10), Offset(20, 20)]);
      final moved = s.translated(const Offset(5, -5)) as InkElement;
      expect(moved.id, 's1');
      expect(moved.points.first.offset, const Offset(15, 5));
      const unplaced = OpaqueElement('v', {'id': 'v', 'kind': 'image'});
      expect(identical(unplaced.translated(const Offset(1, 1)), unplaced), isTrue);
    });
  });

  group('undo and redo', () {
    test('step back and forward; a new change drops the redo', () {
      final h = PageHistory(const []);
      final a = [
        ink('a', const [Offset(0, 0), Offset(1, 1)]),
      ];
      final b = [
        ...a,
        ink('b', const [Offset(2, 2), Offset(3, 3)]),
      ];
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
        h.push([
          ink('$i', const [Offset(0, 0)]),
        ]);
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

  group('the page size, as the server measures it', () {
    test('jsonb\'s text form: ": " after every key, ", " between items, UTF-8 bytes', () {
      // Postgres prints {"v":1,"elements":[{"id":"a","t":"بِ"}]} as
      // {"v": 1, "elements": [{"t": "بِ", "id": "a"}]} -- 48 bytes ("بِ" is 4).
      expect(
        storedJsonBytes({
          'v': 1,
          'elements': [
            {'id': 'a', 't': 'بِ'},
          ],
        }),
        48,
      );
      expect(storedJsonBytes([1, 2, 3]), '[1, 2, 3]'.length);
      expect(storedJsonBytes(<String, Object?>{}), 2);
    });
  });

  test('a verse resizes as one: both sides and its type by the same factor', () {
    final v = VerseElement(
      id: 'v',
      surah: 1,
      fromAyah: 1,
      toAyah: 7,
      datasetId: 'd',
      rangeSha256: 'a' * 64,
      rect: const Rect.fromLTWH(100, 100, 1000, 400),
      fontSize: 50,
      color: const Color(0xFF000000),
    );
    final r = v.scaled(const Offset(100, 100), 1.5, 0.2) as VerseElement;
    expect(r.rect, const Rect.fromLTWH(100, 100, 1500, 600));
    expect(r.fontSize, 75);
    // The type stays legible and bounded: 16..240.
    expect((v.scaled(const Offset(100, 100), 0.01, 1) as VerseElement).fontSize, 16);
  });
}
