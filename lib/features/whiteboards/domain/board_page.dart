import 'dart:math' as math;
import 'dart:ui';

import '../../../design/tokens.dart';
import 'board_elements.dart';
import 'stroke_points.dart';

/// The page rulings (design §4.2). The values are the server's.
enum PageLayout {
  plain('plain'),
  ruled('ruled'),
  narrowRuled('narrow_ruled'),
  grid('grid'),
  arabicLines('arabic_lines');

  const PageLayout(this.wire);
  final String wire;

  static PageLayout parse(String? v) => values.firstWhere((l) => l.wire == v, orElse: () => plain);
}

/// The page colours (design §4.2): a palette, never free colour.
enum PageBackground {
  white('white', BoardPalette.pageWhite, false),
  cream('cream', BoardPalette.pageCream, false),
  grey('grey', BoardPalette.pageGrey, false),
  green('green', BoardPalette.pageGreen, true),
  dark('dark', BoardPalette.pageDark, true);

  const PageBackground(this.wire, this.color, this.isDark);
  final String wire;
  final Color color;

  /// Rulings and the default ink switch to light on a dark board.
  final bool isDark;

  static PageBackground parse(String? v) => values.firstWhere((b) => b.wire == v, orElse: () => white);
}

/// One page as the editor holds it: its look and its elements, bottom first.
class BoardPage {
  const BoardPage({
    required this.id,
    required this.position,
    required this.layout,
    required this.background,
    required this.elements,
    this.savedAt,
  });

  final String id;
  final int position;
  final PageLayout layout;
  final PageBackground background;
  final List<BoardElement> elements;

  /// The server's `updatedAt` for this page as last seen here, exactly as sent:
  /// a draft made against it applies only while the server still says the same
  /// (review of #293, P1). Local edits never change it; a save does.
  final String? savedAt;

  factory BoardPage.fromJson(Map<String, Object?> json) {
    final document = json['document'];
    final raw = document is Map && document['elements'] is List ? document['elements'] as List : const [];
    return BoardPage(
      id: json['id'] as String,
      position: (json['position'] as num?)?.toInt() ?? 0,
      layout: PageLayout.parse(json['layout'] as String?),
      background: PageBackground.parse(json['background'] as String?),
      savedAt: json['updatedAt'] as String?,
      elements: [
        for (final e in raw)
          if (e is Map) BoardElement.fromJson(Map<String, Object?>.from(e)),
      ],
    );
  }

  BoardPage copyWith({List<BoardElement>? elements, PageLayout? layout, PageBackground? background, int? position, String? savedAt}) =>
      BoardPage(
        id: id,
        position: position ?? this.position,
        layout: layout ?? this.layout,
        background: background ?? this.background,
        elements: elements ?? this.elements,
        savedAt: savedAt ?? this.savedAt,
      );

  /// The document the server stores (`{v: 1, elements}`).
  Map<String, Object?> documentJson() => {
    'v': 1,
    'elements': [for (final e in elements) e.toJson()],
  };
}

/// Undo and redo for one page: whole element lists, which share their
/// (immutable) elements, so a step costs one list, not a copy of the drawing.
class PageHistory {
  PageHistory(List<BoardElement> initial) : _present = initial;

  static const int depth = 100;

  final List<List<BoardElement>> _undo = [];
  final List<List<BoardElement>> _redo = [];
  List<BoardElement> _present;

  List<BoardElement> get present => _present;
  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;

  void push(List<BoardElement> next) {
    _undo.add(_present);
    if (_undo.length > depth) _undo.removeAt(0);
    _redo.clear();
    _present = List.unmodifiable(next);
  }

  List<BoardElement>? undo() {
    if (_undo.isEmpty) return null;
    _redo.add(_present);
    _present = _undo.removeLast();
    return _present;
  }

  List<BoardElement>? redo() {
    if (_redo.isEmpty) return null;
    _undo.add(_present);
    _present = _redo.removeLast();
    return _present;
  }
}

/// Hit tests and the erasers (design §4.1). Pure geometry, so it is tested
/// without a canvas.
class BoardGeometry {
  const BoardGeometry._();

  /// The topmost element under [point] (within [slop] page units), or null.
  static BoardElement? hit(List<BoardElement> elements, Offset point, {double slop = 8}) {
    for (final e in elements.reversed) {
      if (touches(e, point, slop)) return e;
    }
    return null;
  }

  static bool touches(BoardElement e, Offset point, double slop) {
    if (!e.bounds.inflate(slop).contains(point)) return false;
    return switch (e) {
      InkElement(:final points, :final width) => _nearPolyline(points.map((p) => p.offset).toList(), point, width / 2 + slop),
      LineElement(:final from, :final to, :final width) => _distanceToSegment(point, from, to) <= width / 2 + slop,
      _ => true,
    };
  }

  /// The stroke eraser: every pen, highlighter, line or arrow the eraser
  /// touches goes whole. Shapes, text and stamps are removed with select +
  /// delete, never by sweeping across them.
  static List<BoardElement> eraseStrokes(List<BoardElement> elements, Offset point, double radius) => [
    for (final e in elements)
      if (!((e is InkElement || e is LineElement) && touches(e, point, radius))) e,
  ];

  /// The area eraser: removes the parts of pen and highlighter strokes within
  /// [radius] of [point], splitting a stroke into the runs that remain. Each
  /// new run gets a new id ([newId]); a stroke untouched keeps its own.
  static List<BoardElement> eraseArea(List<BoardElement> elements, Offset point, double radius, String Function() newId) {
    final out = <BoardElement>[];
    for (final e in elements) {
      if (e is! InkElement || !e.bounds.inflate(radius).contains(point)) {
        out.add(e);
        continue;
      }
      final keep = radius + e.width / 2;
      final runs = <List<StrokePoint>>[];
      var run = <StrokePoint>[];
      for (final p in e.points) {
        if ((p.offset - point).distance <= keep) {
          if (run.isNotEmpty) runs.add(run);
          run = [];
        } else {
          run.add(p);
        }
      }
      if (run.isNotEmpty) runs.add(run);
      if (runs.length == 1 && runs.first.length == e.points.length) {
        out.add(e);
        continue;
      }
      for (final r in runs) {
        if (r.length >= 2) out.add(e.withPoints(r, id: newId()));
      }
    }
    return out;
  }

  /// Every element whose bounds meet [area] (the marquee selection).
  static Set<String> within(List<BoardElement> elements, Rect area) => {
    for (final e in elements)
      if (e.bounds.overlaps(area)) e.id,
  };

  static bool _nearPolyline(List<Offset> pts, Offset p, double tolerance) {
    if (pts.length == 1) return (pts.first - p).distance <= tolerance;
    for (var i = 1; i < pts.length; i++) {
      if (_distanceToSegment(p, pts[i - 1], pts[i]) <= tolerance) return true;
    }
    return false;
  }

  static double _distanceToSegment(Offset p, Offset a, Offset b) {
    final ab = b - a;
    final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
    if (len2 == 0) return (p - a).distance;
    final t = (((p.dx - a.dx) * ab.dx + (p.dy - a.dy) * ab.dy) / len2).clamp(0.0, 1.0);
    return (p - Offset(a.dx + ab.dx * t, a.dy + ab.dy * t)).distance;
  }

  /// Simplifies a freshly drawn stroke (Ramer–Douglas–Peucker, [epsilon] page
  /// units): fewer points, the same line -- the page stays small.
  static List<StrokePoint> simplify(List<StrokePoint> points, {double epsilon = 0.6}) {
    if (points.length < 3) return points;
    final keep = List<bool>.filled(points.length, false)
      ..[0] = true
      ..[points.length - 1] = true;
    final stack = <(int, int)>[(0, points.length - 1)];
    while (stack.isNotEmpty) {
      final (s, e) = stack.removeLast();
      var maxD = 0.0;
      var idx = -1;
      for (var i = s + 1; i < e; i++) {
        final d = _distanceToSegment(points[i].offset, points[s].offset, points[e].offset);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (idx != -1 && maxD > epsilon) {
        keep[idx] = true;
        stack
          ..add((s, idx))
          ..add((idx, e));
      }
    }
    return [
      for (var i = 0; i < points.length; i++)
        if (keep[i]) points[i],
    ];
  }

  /// Keeps a point on the page.
  static Offset clampToPage(Offset p) =>
      Offset(p.dx.clamp(0, kBoardPageSize.width).toDouble(), p.dy.clamp(0, kBoardPageSize.height).toDouble());

  /// The angle of the segment [a]→[b], for arrow heads.
  static double angle(Offset a, Offset b) => math.atan2(b.dy - a.dy, b.dx - a.dx);
}
