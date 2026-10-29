import 'dart:collection';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';
import '../domain/stroke_points.dart';

/// The board's one font for text and text stamps (bundled; IBM Plex Sans
/// Arabic covers Arabic and Latin). Amiri arrives with the verses (PR-3).
const String kBoardFont = 'IBM Plex Sans Arabic';

/// Paints a page in page units (1920 × 1080); the caller scales the canvas.
///
/// Background and rulings first, then every highlighter stroke, then the
/// rest in order: the highlighter sits UNDER the ink so the writing over it
/// stays readable (design §4.1). The finished elements are recorded once into
/// a [ui.Picture] and replayed, so drawing a new stroke repaints only that
/// stroke (the canvas's overlay), not the whole page.
class BoardPagePainter extends CustomPainter {
  BoardPagePainter({required this.page, this.placeholderLabel}) : _cache = _PictureCache.of(page, null);

  final BoardPage page;

  /// How a kind this build does not draw is labelled (a verse before PR-3).
  final String Function(BoardElement element)? placeholderLabel;

  final _PictureCache _cache;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / kBoardPageSize.width, size.height / kBoardPageSize.height);
    canvas.drawPicture(_cache.picture(() => _record(page, placeholderLabel)));
    canvas.restore();
  }

  @override
  bool shouldRepaint(BoardPagePainter old) =>
      !identical(old.page.elements, page.elements) || old.page.layout != page.layout || old.page.background != page.background;
}

// ---------------------------------------------------------------------------

/// The recorded pictures of the last few page states, shared by every painter
/// of the same state (the editor, its thumbnail). BOUNDED (review of #293): a
/// picture per undo step would hold the whole history's drawings in memory,
/// so only the most recently drawn states keep theirs. An evicted picture is
/// only let go, never disposed: a frame being drawn may still hold it.
class _PictureCache {
  _PictureCache._(this.key);

  final Object key;
  ui.Picture? _picture;

  static const int _capacity = 16;
  static final LinkedHashMap<List<BoardElement>, _PictureCache> _recent = LinkedHashMap(equals: identical, hashCode: identityHashCode);

  static _PictureCache of(BoardPage page, Object? versesVersion) {
    final key = (page.layout, page.background, versesVersion == null ? 0 : identityHashCode(versesVersion));
    final existing = _recent.remove(page.elements);
    if (existing != null && existing.key == key) {
      _recent[page.elements] = existing; // most recent last
      return existing;
    }
    final cache = _PictureCache._(key);
    _recent[page.elements] = cache;
    while (_recent.length > _capacity) {
      final oldest = _recent.keys.first;
      _recent.remove(oldest);
    }
    return cache;
  }

  ui.Picture picture(ui.Picture Function() record) => _picture ??= record();
}

ui.Picture _record(BoardPage page, String Function(BoardElement)? label) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder, Offset.zero & kBoardPageSize);
  paintBackground(canvas, page.layout, page.background);
  for (final e in page.elements) {
    if (e is InkElement && e.highlight) paintInk(canvas, e);
  }
  for (final e in page.elements) {
    if (e is InkElement && e.highlight) continue;
    paintElement(canvas, e, dark: page.background.isDark, label: label);
  }
  return recorder.endRecording();
}

/// The page colour and its rulings.
void paintBackground(Canvas canvas, PageLayout layout, PageBackground background) {
  final page = Offset.zero & kBoardPageSize;
  canvas.drawRect(page, Paint()..color = background.color);
  final line = Paint()
    ..color = background.isDark ? BoardPalette.ruleOnDark : BoardPalette.ruleOnLight
    ..strokeWidth = 1.5;
  final w = kBoardPageSize.width, h = kBoardPageSize.height;
  switch (layout) {
    case PageLayout.plain:
      break;
    case PageLayout.ruled:
    case PageLayout.narrowRuled:
      final gap = layout == PageLayout.ruled ? 72.0 : 48.0;
      for (var y = gap; y < h; y += gap) {
        canvas.drawLine(Offset(0, y), Offset(w, y), line);
      }
    case PageLayout.grid:
      const gap = 60.0;
      for (var x = gap; x < w; x += gap) {
        canvas.drawLine(Offset(x, 0), Offset(x, h), line);
      }
      for (var y = gap; y < h; y += gap) {
        canvas.drawLine(Offset(0, y), Offset(w, y), line);
      }
    case PageLayout.arabicLines:
      // A baseline and a lighter upper guide per band: the height of a
      // letter's body, so a child's letters sit on the line (design §4.2).
      const band = 135.0, body = 45.0;
      final guide = Paint()
        ..color = line.color.withValues(alpha: line.color.a * 0.6)
        ..strokeWidth = 1;
      final base = Paint()
        ..color = line.color.withValues(alpha: math.min(1, line.color.a * 1.6))
        ..strokeWidth = 2;
      for (var y = band; y < h; y += band) {
        _dashed(canvas, Offset(0, y - body), Offset(w, y - body), guide);
        canvas.drawLine(Offset(0, y), Offset(w, y), base);
      }
  }
}

void _dashed(Canvas canvas, Offset a, Offset b, Paint paint) {
  const dash = 14.0, gap = 10.0;
  final total = (b - a).distance;
  final dir = (b - a) / total;
  for (var d = 0.0; d < total; d += dash + gap) {
    canvas.drawLine(a + dir * d, a + dir * math.min(total, d + dash), paint);
  }
}

void paintElement(Canvas canvas, BoardElement e, {bool dark = false, String Function(BoardElement)? label}) {
  switch (e) {
    case InkElement():
      paintInk(canvas, e);
    case ShapeElement():
      _paintShape(canvas, e);
    case LineElement():
      _paintLine(canvas, e);
    case TextElement():
      _paintText(canvas, e);
    case StampElement():
      _paintStamp(canvas, e);
    case OpaqueElement():
      _paintPlaceholder(canvas, e, dark, label?.call(e) ?? e.kind);
  }
}

/// A pen stroke widens with pressure; a stroke from a mouse (no pressure) and
/// every highlighter stroke are one smooth path of even width.
void paintInk(Canvas canvas, InkElement s) {
  final pts = s.points;
  if (pts.isEmpty) return;
  final paint = Paint()
    ..color = s.highlight ? s.color.withValues(alpha: 0.35) : s.color
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..isAntiAlias = true;
  if (pts.length == 1) {
    canvas.drawCircle(pts.first.offset, s.width / 2, Paint()..color = paint.color);
    return;
  }
  final even = s.highlight || pts.every((p) => (p.pressure - pts.first.pressure).abs() < 0.02);
  if (even) {
    canvas.drawPath(_smooth(pts), paint..strokeWidth = s.width);
    return;
  }
  for (var i = 1; i < pts.length; i++) {
    final w = s.width * (0.45 + 1.1 * (pts[i - 1].pressure + pts[i].pressure) / 2);
    canvas.drawLine(pts[i - 1].offset, pts[i].offset, paint..strokeWidth = w);
  }
}

/// Quadratic curves through the midpoints: a hand-drawn line without corners.
Path _smooth(List<StrokePoint> pts) {
  final path = Path()..moveTo(pts.first.x, pts.first.y);
  for (var i = 1; i < pts.length - 1; i++) {
    final mid = Offset((pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    path.quadraticBezierTo(pts[i].x, pts[i].y, mid.dx, mid.dy);
  }
  path.lineTo(pts.last.x, pts.last.y);
  return path;
}

void _paintShape(Canvas canvas, ShapeElement s) {
  final path = switch (s.shape) {
    ShapeKind.rect => Path()..addRect(s.rect),
    ShapeKind.ellipse => Path()..addOval(s.rect),
    ShapeKind.triangle =>
      Path()
        ..moveTo(s.rect.center.dx, s.rect.top)
        ..lineTo(s.rect.right, s.rect.bottom)
        ..lineTo(s.rect.left, s.rect.bottom)
        ..close(),
  };
  if (s.fill != null) canvas.drawPath(path, Paint()..color = s.fill!);
  canvas.drawPath(
    path,
    Paint()
      ..color = s.stroke
      ..style = PaintingStyle.stroke
      ..strokeWidth = s.width
      ..strokeJoin = StrokeJoin.round,
  );
}

void _paintLine(Canvas canvas, LineElement l) {
  final paint = Paint()
    ..color = l.color
    ..strokeWidth = l.width
    ..strokeCap = StrokeCap.round
    ..style = PaintingStyle.stroke;
  canvas.drawLine(l.from, l.to, paint);
  if (!l.arrow) return;
  void head(Offset tip, Offset tail) {
    final a = math.atan2(tip.dy - tail.dy, tip.dx - tail.dx);
    final len = 14 + l.width * 3;
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo(tip.dx - len * math.cos(a - 0.45), tip.dy - len * math.sin(a - 0.45))
      ..lineTo(tip.dx - len * math.cos(a + 0.45), tip.dy - len * math.sin(a + 0.45))
      ..close();
    canvas.drawPath(path, Paint()..color = l.color);
  }

  head(l.to, l.from);
  if (l.bothEnds) head(l.from, l.to);
}

/// Right-to-left when the text's first strong character is Arabic (or Hebrew).
TextDirection textDirectionOf(String text) {
  for (final r in text.runes) {
    if ((r >= 0x0590 && r <= 0x08FF) || (r >= 0xFB1D && r <= 0xFEFC)) return TextDirection.rtl;
    if ((r >= 0x41 && r <= 0x5A) || (r >= 0x61 && r <= 0x7A) || (r >= 0xC0 && r <= 0x24F)) return TextDirection.ltr;
  }
  return TextDirection.ltr;
}

TextPainter layoutBoardText(String text, double fontSize, Color color, double maxWidth) {
  final dir = textDirectionOf(text);
  return TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(fontFamily: kBoardFont, fontSize: fontSize, color: color, height: 1.4),
    ),
    textDirection: dir,
    textAlign: dir == TextDirection.rtl ? TextAlign.right : TextAlign.left,
  )..layout(maxWidth: maxWidth);
}

void _paintText(Canvas canvas, TextElement t) {
  final tp = layoutBoardText(t.text, t.fontSize, t.color, t.size.width);
  final dx = tp.textDirection == TextDirection.rtl ? t.size.width - tp.width : 0.0;
  tp.paint(canvas, t.topLeft + Offset(dx, 0));
}

/// Icon stamps are Material icons drawn as glyphs; text stamps are our font.
const Map<StampKind, IconData> kStampIcons = {
  StampKind.star: Icons.star_rounded,
  StampKind.check: Icons.check_circle_rounded,
  StampKind.heart: Icons.favorite_rounded,
  StampKind.thumbsUp: Icons.thumb_up_rounded,
};

void _paintStamp(Canvas canvas, StampElement s) {
  final icon = kStampIcons[s.stamp];
  if (icon != null) {
    final tp = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(fontFamily: icon.fontFamily, package: icon.fontPackage, fontSize: s.rect.shortestSide, color: s.color),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, s.rect.center - Offset(tp.width / 2, tp.height / 2));
    return;
  }
  final text = s.text ?? '';
  final border = RRect.fromRectAndRadius(s.rect, Radius.circular(s.rect.height * 0.25));
  canvas.drawRRect(border, Paint()..color = s.color.withValues(alpha: 0.12));
  canvas.drawRRect(
    border,
    Paint()
      ..color = s.color
      ..style = PaintingStyle.stroke
      ..strokeWidth = math.max(3, s.rect.height * 0.06),
  );
  final tp = layoutBoardText(text, s.rect.height * 0.5, s.color, s.rect.width);
  tp.paint(canvas, s.rect.center - Offset(tp.width / 2, tp.height / 2));
}

void _paintPlaceholder(Canvas canvas, OpaqueElement e, bool dark, String label) {
  final r = e.bounds;
  final ink = dark ? BoardPalette.placeholderOnDark : BoardPalette.placeholderOnLight;
  canvas.drawRect(r, Paint()..color = ink.withValues(alpha: 0.08));
  final edge = Paint()
    ..color = ink
    ..strokeWidth = 2;
  _dashed(canvas, r.topLeft, r.topRight, edge);
  _dashed(canvas, r.topRight, r.bottomRight, edge);
  _dashed(canvas, r.bottomRight, r.bottomLeft, edge);
  _dashed(canvas, r.bottomLeft, r.topLeft, edge);
  final tp = layoutBoardText(label, 32, ink, math.max(40, r.width - 24));
  tp.paint(canvas, r.center - Offset(tp.width / 2, tp.height / 2));
}
