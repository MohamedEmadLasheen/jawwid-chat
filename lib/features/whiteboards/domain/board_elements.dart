import 'dart:math' as math;
import 'dart:ui';

import '../../../design/tokens.dart';
import 'stroke_points.dart';

/// The page every board is drawn on: one fixed 16:9 page, so zoom, export and
/// (Phase 2) a shared view look the same on every screen (design §4.2).
const Size kBoardPageSize = Size(1920, 1080);

/// PD-39: one thing drawn on a page. Immutable: an edit makes a new element
/// with the same id, which is what lets undo keep whole pages cheaply.
///
/// The JSON shape is the client's own (the server checks ids, kinds, sizes,
/// verses and images only: apps/api/src/whiteboards/whiteboard-document.ts).
/// A kind this build does not draw -- a verse before PR-3, an image before
/// PR-4, anything newer -- is kept as an [OpaqueElement] and saved back
/// exactly as it came.
sealed class BoardElement {
  const BoardElement(this.id);

  final String id;

  String get kind;

  /// The area it covers on the page, for selection and hit tests.
  Rect get bounds;

  /// Moved by [delta]. Opaque elements move only if they say where they are.
  BoardElement translated(Offset delta);

  /// Scaled from [anchor] by [sx], [sy] (resizing a selection).
  BoardElement scaled(Offset anchor, double sx, double sy);

  Map<String, Object?> toJson();

  static BoardElement fromJson(Map<String, Object?> json) {
    final id = json['id'] as String? ?? '';
    try {
      switch (json['kind']) {
        case 'stroke':
        case 'highlight':
          return InkElement(
            id: id,
            highlight: json['kind'] == 'highlight',
            points: StrokePointCodec.decode(json['points'] as String? ?? ''),
            color: _color(json['color']),
            width: _num(json['width'], 4),
          );
        case 'shape':
          return ShapeElement(
            id: id,
            shape: ShapeKind.values.asNameMap()[json['shape']] ?? ShapeKind.rect,
            rect: Rect.fromLTWH(_num(json['x'], 0), _num(json['y'], 0), _num(json['w'], 10), _num(json['h'], 10)),
            stroke: _color(json['color']),
            fill: json['fill'] == null ? null : _color(json['fill']),
            width: _num(json['width'], 4),
          );
        case 'line':
        case 'arrow':
          return LineElement(
            id: id,
            arrow: json['kind'] == 'arrow',
            bothEnds: json['heads'] == 'both',
            from: Offset(_num(json['x1'], 0), _num(json['y1'], 0)),
            to: Offset(_num(json['x2'], 10), _num(json['y2'], 10)),
            color: _color(json['color']),
            width: _num(json['width'], 4),
          );
        case 'text':
          return TextElement(
            id: id,
            text: json['text'] as String? ?? '',
            topLeft: Offset(_num(json['x'], 0), _num(json['y'], 0)),
            size: Size(_num(json['w'], 300), _num(json['h'], 60)),
            fontSize: _num(json['size'], 48),
            color: _color(json['color']),
          );
        case 'stamp':
          return StampElement(
            id: id,
            stamp: StampKind.values.asNameMap()[json['stamp']] ?? StampKind.star,
            rect: Rect.fromLTWH(_num(json['x'], 0), _num(json['y'], 0), _num(json['w'], 120), _num(json['h'], 120)),
            color: _color(json['color']),
            text: json['text'] as String?,
          );
      }
    } on Object {
      // Fall through: a malformed element is kept as it came, never dropped.
    }
    return OpaqueElement(id, Map<String, Object?>.unmodifiable(json));
  }
}

/// A pen or highlighter stroke. The highlighter is drawn translucent and under
/// the ink (design §4.1).
class InkElement extends BoardElement {
  const InkElement({required String id, required this.points, required this.color, required this.width, this.highlight = false})
    : super(id);

  final List<StrokePoint> points;
  final Color color;
  final double width;
  final bool highlight;

  @override
  String get kind => highlight ? 'highlight' : 'stroke';

  @override
  Rect get bounds {
    if (points.isEmpty) return Rect.zero;
    var l = points.first.x, t = points.first.y, r = l, b = t;
    for (final p in points) {
      l = math.min(l, p.x);
      t = math.min(t, p.y);
      r = math.max(r, p.x);
      b = math.max(b, p.y);
    }
    return Rect.fromLTRB(l, t, r, b).inflate(width / 2);
  }

  InkElement withPoints(List<StrokePoint> next, {String? id}) =>
      InkElement(id: id ?? this.id, points: next, color: color, width: width, highlight: highlight);

  @override
  BoardElement translated(Offset delta) => withPoints([for (final p in points) StrokePoint(p.x + delta.dx, p.y + delta.dy, p.pressure)]);

  @override
  BoardElement scaled(Offset anchor, double sx, double sy) =>
      withPoints([for (final p in points) StrokePoint(anchor.dx + (p.x - anchor.dx) * sx, anchor.dy + (p.y - anchor.dy) * sy, p.pressure)]);

  @override
  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'points': StrokePointCodec.encode(points),
    'color': _hex(color),
    'width': _round(width),
  };
}

enum ShapeKind { rect, ellipse, triangle }

class ShapeElement extends BoardElement {
  const ShapeElement({required String id, required this.shape, required this.rect, required this.stroke, required this.width, this.fill})
    : super(id);

  final ShapeKind shape;
  final Rect rect;
  final Color stroke;
  final Color? fill;
  final double width;

  @override
  String get kind => 'shape';

  @override
  Rect get bounds => rect.inflate(width / 2);

  ShapeElement withRect(Rect next) => ShapeElement(id: id, shape: shape, rect: next, stroke: stroke, fill: fill, width: width);

  @override
  BoardElement translated(Offset delta) => withRect(rect.shift(delta));

  @override
  BoardElement scaled(Offset anchor, double sx, double sy) => withRect(_scaleRect(rect, anchor, sx, sy));

  @override
  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'shape': shape.name,
    ..._rectJson(rect),
    'color': _hex(stroke),
    'fill': fill == null ? null : _hex(fill!),
    'width': _round(width),
  };
}

/// A straight line, or an arrow with a head at the end (or both ends).
class LineElement extends BoardElement {
  const LineElement({
    required String id,
    required this.from,
    required this.to,
    required this.color,
    required this.width,
    this.arrow = false,
    this.bothEnds = false,
  }) : super(id);

  final Offset from;
  final Offset to;
  final Color color;
  final double width;
  final bool arrow;
  final bool bothEnds;

  @override
  String get kind => arrow ? 'arrow' : 'line';

  @override
  Rect get bounds => Rect.fromPoints(from, to).inflate(width + (arrow ? width * 3 : 0));

  LineElement withEnds(Offset a, Offset b) =>
      LineElement(id: id, from: a, to: b, color: color, width: width, arrow: arrow, bothEnds: bothEnds);

  @override
  BoardElement translated(Offset delta) => withEnds(from + delta, to + delta);

  @override
  BoardElement scaled(Offset anchor, double sx, double sy) => withEnds(_scalePoint(from, anchor, sx, sy), _scalePoint(to, anchor, sx, sy));

  @override
  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'x1': _round(from.dx),
    'y1': _round(from.dy),
    'x2': _round(to.dx),
    'y2': _round(to.dy),
    'color': _hex(color),
    'width': _round(width),
    if (arrow) 'heads': bothEnds ? 'both' : 'end',
  };
}

/// Text in Arabic or English; its direction comes from its first strong
/// character when it is drawn. [size] is the box it was laid out in.
class TextElement extends BoardElement {
  const TextElement({
    required String id,
    required this.text,
    required this.topLeft,
    required this.size,
    required this.fontSize,
    required this.color,
  }) : super(id);

  final String text;
  final Offset topLeft;
  final Size size;
  final double fontSize;
  final Color color;

  @override
  String get kind => 'text';

  @override
  Rect get bounds => topLeft & size;

  TextElement copyWith({String? text, Offset? topLeft, Size? size, double? fontSize, Color? color}) => TextElement(
    id: id,
    text: text ?? this.text,
    topLeft: topLeft ?? this.topLeft,
    size: size ?? this.size,
    fontSize: fontSize ?? this.fontSize,
    color: color ?? this.color,
  );

  @override
  BoardElement translated(Offset delta) => copyWith(topLeft: topLeft + delta);

  @override
  BoardElement scaled(Offset anchor, double sx, double sy) {
    final r = _scaleRect(bounds, anchor, sx, sy);
    return copyWith(topLeft: r.topLeft, size: r.size, fontSize: (fontSize * math.sqrt(sx.abs() * sy.abs())).clamp(8, 400).toDouble());
  }

  @override
  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'text': text,
    'x': _round(topLeft.dx),
    'y': _round(topLeft.dy),
    'w': _round(size.width),
    'h': _round(size.height),
    'size': _round(fontSize),
    'color': _hex(color),
  };
}

/// The reward stamps (design §4.1): drawn from bundled icons and our font,
/// never emoji (they render as boxes in the browser build).
enum StampKind { star, check, heart, thumbsUp, excellentAr, wellDoneAr, excellentEn, wellDoneEn }

class StampElement extends BoardElement {
  const StampElement({required String id, required this.stamp, required this.rect, required this.color, this.text}) : super(id);

  final StampKind stamp;
  final Rect rect;
  final Color color;

  /// The words of a text stamp, as drawn ("ممتاز", "Well done"); null for an icon.
  final String? text;

  @override
  String get kind => 'stamp';

  @override
  Rect get bounds => rect;

  StampElement withRect(Rect next) => StampElement(id: id, stamp: stamp, rect: next, color: color, text: text);

  @override
  BoardElement translated(Offset delta) => withRect(rect.shift(delta));

  @override
  BoardElement scaled(Offset anchor, double sx, double sy) => withRect(_scaleRect(rect, anchor, sx, sy));

  @override
  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'stamp': stamp.name,
    ..._rectJson(rect),
    'color': _hex(color),
    if (text != null) 'text': text,
  };
}

/// A kind this build does not draw (a verse before PR-3, an image before PR-4,
/// or anything newer). Kept and saved back exactly as it came; it moves only
/// when it carries x/y/w/h, and it is shown as a labelled box.
class OpaqueElement extends BoardElement {
  const OpaqueElement(super.id, this.json);

  final Map<String, Object?> json;

  @override
  String get kind => json['kind'] as String? ?? 'unknown';

  bool get _placed => json['x'] is num && json['y'] is num;

  @override
  Rect get bounds => Rect.fromLTWH(_num(json['x'], 0), _num(json['y'], 0), _num(json['w'], 400), _num(json['h'], 120));

  @override
  BoardElement translated(Offset delta) =>
      _placed ? OpaqueElement(id, {...json, 'x': _round(_num(json['x'], 0) + delta.dx), 'y': _round(_num(json['y'], 0) + delta.dy)}) : this;

  @override
  BoardElement scaled(Offset anchor, double sx, double sy) =>
      _placed ? OpaqueElement(id, {...json, ..._rectJson(_scaleRect(bounds, anchor, sx, sy))}) : this;

  @override
  Map<String, Object?> toJson() => json;
}

// ---------------------------------------------------------------------------

double _num(Object? v, double fallback) => v is num && v.isFinite ? v.toDouble() : fallback;

double _round(double v) => (v * 10).roundToDouble() / 10;

Color _color(Object? v) {
  if (v is String && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(v)) return Color(int.parse(v.substring(1), radix: 16) | 0xFF000000);
  return BoardPalette.ink;
}

String _hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

Map<String, Object?> _rectJson(Rect r) => {'x': _round(r.left), 'y': _round(r.top), 'w': _round(r.width), 'h': _round(r.height)};

Offset _scalePoint(Offset p, Offset anchor, double sx, double sy) =>
    Offset(anchor.dx + (p.dx - anchor.dx) * sx, anchor.dy + (p.dy - anchor.dy) * sy);

Rect _scaleRect(Rect r, Offset anchor, double sx, double sy) =>
    Rect.fromPoints(_scalePoint(r.topLeft, anchor, sx, sy), _scalePoint(r.bottomRight, anchor, sx, sy));
