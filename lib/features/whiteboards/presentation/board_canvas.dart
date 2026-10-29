import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';
import '../domain/stroke_points.dart';
import 'board_painter.dart';

/// The board's tools (design §4.1).
enum BoardTool { select, hand, pen, highlighter, eraser, areaEraser, text, rect, ellipse, triangle, line, arrow, stamp }

/// What the current tool draws with.
class ToolStyle {
  const ToolStyle({required this.color, required this.width, this.stamp = StampKind.star, this.stampText});

  final Color color;
  final double width;
  final StampKind stamp;

  /// The words of a text stamp, in the language they were chosen in.
  final String? stampText;
}

/// The page view: draws, erases, places and selects in page units, and pans and
/// zooms the view. A pen (stylus) draws while fingers pan and zoom -- palm
/// rejection, once a pen has been seen; without a pen one finger draws and two
/// pan and zoom. A trackpad pinches, Ctrl/⌘ + wheel zooms, the wheel and the
/// space bar (or the hand tool) pan.
class BoardCanvas extends StatefulWidget {
  const BoardCanvas({
    super.key,
    required this.page,
    required this.tool,
    required this.style,
    required this.readOnly,
    required this.onCommit,
    this.onRequestText,
    this.placeholderLabel,
    this.view,
  });

  final BoardPage page;
  final BoardTool tool;
  final ToolStyle style;
  final bool readOnly;

  /// One finished edit: the page's elements after it (one undo step).
  final ValueChanged<List<BoardElement>> onCommit;

  /// Asks for text to place (or to edit, with [initial]); null cancels.
  final Future<String?> Function({String? initial})? onRequestText;
  final String Function(BoardElement element)? placeholderLabel;

  /// Zoom and pan, shared with the zoom buttons.
  final BoardViewController? view;

  @override
  State<BoardCanvas> createState() => BoardCanvasState();
}

/// Zoom (1 = the whole page fits) and pan (screen pixels), for the canvas and
/// the zoom buttons.
class BoardViewController extends ChangeNotifier {
  static const double minZoom = 0.5;
  static const double maxZoom = 4;

  double _zoom = 1;
  Offset _pan = Offset.zero;

  double get zoom => _zoom;
  Offset get pan => _pan;

  void zoomBy(double factor, {Offset focal = Offset.zero}) {
    final next = (_zoom * factor).clamp(minZoom, maxZoom).toDouble();
    final applied = next / _zoom;
    // Keep the point under [focal] (relative to the view's centre) where it is.
    _pan = focal - (focal - _pan) * applied;
    _zoom = next;
    notifyListeners();
  }

  void panBy(Offset delta) {
    _pan += delta;
    notifyListeners();
  }

  void fit() {
    _zoom = 1;
    _pan = Offset.zero;
    notifyListeners();
  }
}

enum _Drag { none, draw, erase, shape, move, resize, marquee, pan, pinch }

class BoardCanvasState extends State<BoardCanvas> {
  late BoardViewController _view = widget.view ?? BoardViewController();
  Size _viewport = Size.zero;

  // Pointers
  final Map<int, Offset> _touches = {};
  bool _stylusSeen = false;
  bool _spaceDown = false;
  int? _activePointer;
  _Drag _drag = _Drag.none;
  double _pinchStartDistance = 0;
  double _pinchStartZoom = 1;
  Offset _lastFocal = Offset.zero;

  // Work in progress
  List<StrokePoint> _live = [];
  int _liveRevision = 0;
  List<BoardElement>? _working;
  Offset? _start;
  Offset? _current;
  Set<String> _selected = {};
  int _idSeq = 0;

  @override
  void didUpdateWidget(BoardCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.view != widget.view && widget.view != null) _view = widget.view!;
    if (oldWidget.page.id != widget.page.id || oldWidget.tool != widget.tool) _selected = {};
    // A selection keeps only what still exists (after undo, say).
    _selected = _selected.where((id) => widget.page.elements.any((e) => e.id == id)).toSet();
  }

  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_onKey);
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_onKey);
    super.dispose();
  }

  /// The selection, for the editor's delete and arrange actions.
  Set<String> get selection => _selected;

  void clearSelection() => setState(() => _selected = {});

  bool _onKey(KeyEvent e) {
    if (e.logicalKey == LogicalKeyboardKey.space) {
      _spaceDown = e is! KeyUpEvent;
    }
    return false;
  }

  String _newId() => 'e${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}${(_idSeq++).toRadixString(36)}';

  // -- geometry ----------------------------------------------------------------

  double get _fit => math.min(_viewport.width / kBoardPageSize.width, _viewport.height / kBoardPageSize.height) * 0.96;
  double get _scale => _fit * _view.zoom;
  Offset get _origin =>
      Offset(_viewport.width / 2, _viewport.height / 2) + _view.pan - Offset(kBoardPageSize.width, kBoardPageSize.height) * _scale / 2;

  Offset _toPage(Offset screen) => (screen - _origin) / _scale;

  // -- pointers -----------------------------------------------------------------

  bool _isPen(PointerEvent e) => e.kind == PointerDeviceKind.stylus || e.kind == PointerDeviceKind.invertedStylus;

  void _down(PointerDownEvent e) {
    if (e.kind == PointerDeviceKind.touch) _touches[e.pointer] = e.localPosition;
    if (_isPen(e)) _stylusSeen = true;
    if (_activePointer != null) {
      // A second finger: whatever the first began becomes a pinch (nothing is committed).
      if (e.kind == PointerDeviceKind.touch && _touches.length == 2) _beginPinch();
      return;
    }
    final panOnly =
        widget.readOnly ||
        widget.tool == BoardTool.hand ||
        _spaceDown ||
        (e.kind == PointerDeviceKind.mouse && e.buttons == kMiddleMouseButton) ||
        (e.kind == PointerDeviceKind.touch && _stylusSeen);
    _activePointer = e.pointer;
    _lastFocal = e.localPosition;
    if (panOnly) {
      _drag = _Drag.pan;
      return;
    }
    final tool = e.kind == PointerDeviceKind.invertedStylus ? BoardTool.eraser : widget.tool;
    _begin(tool, _toPage(e.localPosition), e.pressure, e.kind);
  }

  void _move(PointerMoveEvent e) {
    if (e.kind == PointerDeviceKind.touch) _touches[e.pointer] = e.localPosition;
    if (_drag == _Drag.pinch) {
      _updatePinch();
      return;
    }
    if (e.pointer != _activePointer) return;
    if (_drag == _Drag.pan) {
      _view.panBy(e.localPosition - _lastFocal);
      _lastFocal = e.localPosition;
      return;
    }
    final tool = e.kind == PointerDeviceKind.invertedStylus ? BoardTool.eraser : widget.tool;
    _update(tool, _toPage(e.localPosition), e.pressure, e.kind);
  }

  void _up(PointerEvent e, {bool cancelled = false}) {
    _touches.remove(e.pointer);
    if (_drag == _Drag.pinch) {
      if (_touches.isEmpty) _reset();
      return;
    }
    if (e.pointer != _activePointer) return;
    if (!cancelled && _drag != _Drag.pan) _end(e.kind == PointerDeviceKind.invertedStylus ? BoardTool.eraser : widget.tool);
    _reset();
  }

  void _reset() {
    setState(() {
      _activePointer = null;
      _drag = _Drag.none;
      _live = [];
      _working = null;
      _start = null;
      _current = null;
    });
  }

  void _beginPinch() {
    setState(() {
      _drag = _Drag.pinch;
      _live = [];
      _working = null;
      _start = null;
    });
    final pts = _touches.values.toList();
    _pinchStartDistance = (pts[0] - pts[1]).distance;
    _pinchStartZoom = _view.zoom;
    _lastFocal = (pts[0] + pts[1]) / 2;
  }

  void _updatePinch() {
    if (_touches.length < 2) return;
    final pts = _touches.values.take(2).toList();
    final focal = (pts[0] + pts[1]) / 2;
    final distance = (pts[0] - pts[1]).distance;
    if (_pinchStartDistance > 0) {
      final target = _pinchStartZoom * distance / _pinchStartDistance;
      _view.zoomBy(target / _view.zoom, focal: focal - Offset(_viewport.width / 2, _viewport.height / 2));
    }
    _view.panBy(focal - _lastFocal);
    _lastFocal = focal;
  }

  void _signal(PointerSignalEvent e) {
    if (e is PointerScrollEvent) {
      final keys = HardwareKeyboard.instance;
      if (keys.isControlPressed || keys.isMetaPressed) {
        _view.zoomBy(e.scrollDelta.dy < 0 ? 1.1 : 1 / 1.1, focal: e.localPosition - Offset(_viewport.width / 2, _viewport.height / 2));
      } else {
        _view.panBy(-e.scrollDelta);
      }
    }
  }

  void _panZoom(PointerPanZoomUpdateEvent e) {
    if (e.scale != _lastTrackpadScale) {
      // A trackpad pinch reports the scale since it began; apply the change per update.
      final step = e.scale / (_lastTrackpadScale == 0 ? 1 : _lastTrackpadScale);
      _lastTrackpadScale = e.scale;
      _view.zoomBy(step, focal: e.localPosition - Offset(_viewport.width / 2, _viewport.height / 2));
    }
    _view.panBy(e.panDelta);
  }

  double _lastTrackpadScale = 1;

  // -- tools ---------------------------------------------------------------------

  double _pressure(double p, PointerDeviceKind kind) =>
      kind == PointerDeviceKind.stylus || kind == PointerDeviceKind.invertedStylus ? p.clamp(0.05, 1.0) : 0.5;

  void _begin(BoardTool tool, Offset p, double pressure, PointerDeviceKind kind) {
    final at = BoardGeometry.clampToPage(p);
    setState(() {
      _start = at;
      _current = at;
      switch (tool) {
        case BoardTool.pen:
        case BoardTool.highlighter:
          _drag = _Drag.draw;
          _live = [StrokePoint(at.dx, at.dy, _pressure(pressure, kind))];
        case BoardTool.eraser:
        case BoardTool.areaEraser:
          _drag = _Drag.erase;
          _working = widget.page.elements;
          _eraseAt(tool, at);
        case BoardTool.rect:
        case BoardTool.ellipse:
        case BoardTool.triangle:
        case BoardTool.line:
        case BoardTool.arrow:
          _drag = _Drag.shape;
        case BoardTool.select:
          _beginSelect(at);
        case BoardTool.text:
        case BoardTool.stamp:
        case BoardTool.hand:
          _drag = _Drag.none;
      }
    });
  }

  void _update(BoardTool tool, Offset p, double pressure, PointerDeviceKind kind) {
    final at = BoardGeometry.clampToPage(p);
    switch (_drag) {
      case _Drag.draw:
        _live.add(StrokePoint(at.dx, at.dy, _pressure(pressure, kind)));
        setState(() => _liveRevision++);
      case _Drag.erase:
        setState(() => _eraseAt(tool, at));
      case _Drag.shape:
      case _Drag.move:
      case _Drag.resize:
      case _Drag.marquee:
        setState(() => _current = at);
      case _Drag.none:
      case _Drag.pan:
      case _Drag.pinch:
        break;
    }
  }

  Future<void> _end(BoardTool tool) async {
    final start = _start;
    final current = _current;
    switch (_drag) {
      case _Drag.draw:
        if (_live.isEmpty) return;
        final stroke = InkElement(
          id: _newId(),
          points: BoardGeometry.simplify(_live),
          color: widget.style.color,
          width: widget.style.width,
          highlight: tool == BoardTool.highlighter,
        );
        widget.onCommit([...widget.page.elements, stroke]);
      case _Drag.erase:
        final working = _working;
        if (working != null && !_sameIds(working, widget.page.elements)) widget.onCommit(working);
      case _Drag.shape:
        if (start == null || current == null || (current - start).distance < 4) return;
        widget.onCommit([...widget.page.elements, _shapeFor(tool, start, current)]);
      case _Drag.move:
      case _Drag.resize:
        if (start == null || current == null || (current - start).distance < 1) return;
        widget.onCommit(_transformed(start, current));
      case _Drag.marquee:
        if (start == null || current == null) return;
        setState(() => _selected = BoardGeometry.within(widget.page.elements, Rect.fromPoints(start, current)));
      case _Drag.none:
        if (start == null) return;
        if (tool == BoardTool.text) await _placeText(start);
        if (tool == BoardTool.stamp) _placeStamp(start);
      case _Drag.pan:
      case _Drag.pinch:
        break;
    }
  }

  bool _sameIds(List<BoardElement> a, List<BoardElement> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!identical(a[i], b[i])) return false;
    }
    return true;
  }

  void _eraseAt(BoardTool tool, Offset at) {
    final radius = 14 / _scale.clamp(0.1, 10);
    final current = _working ?? widget.page.elements;
    _working = tool == BoardTool.areaEraser
        ? BoardGeometry.eraseArea(current, at, radius, _newId)
        : BoardGeometry.eraseStrokes(current, at, radius);
  }

  BoardElement _shapeFor(BoardTool tool, Offset a, Offset b) {
    final style = widget.style;
    return switch (tool) {
      BoardTool.line => LineElement(id: _newId(), from: a, to: b, color: style.color, width: style.width),
      BoardTool.arrow => LineElement(id: _newId(), from: a, to: b, color: style.color, width: style.width, arrow: true),
      BoardTool.ellipse => ShapeElement(
        id: _newId(),
        shape: ShapeKind.ellipse,
        rect: Rect.fromPoints(a, b),
        stroke: style.color,
        width: style.width,
      ),
      BoardTool.triangle => ShapeElement(
        id: _newId(),
        shape: ShapeKind.triangle,
        rect: Rect.fromPoints(a, b),
        stroke: style.color,
        width: style.width,
      ),
      _ => ShapeElement(id: _newId(), shape: ShapeKind.rect, rect: Rect.fromPoints(a, b), stroke: style.color, width: style.width),
    };
  }

  Future<void> _placeText(Offset at) async {
    final hit = BoardGeometry.hit(widget.page.elements, at);
    if (hit is TextElement) {
      final text = await widget.onRequestText?.call(initial: hit.text);
      if (text == null || !mounted) return;
      final laid = layoutBoardText(text, hit.fontSize, hit.color, hit.size.width);
      final edited = hit.copyWith(text: text, size: Size(hit.size.width, laid.height));
      widget.onCommit([
        for (final e in widget.page.elements)
          if (e.id == hit.id) edited else e,
      ]);
      return;
    }
    final text = await widget.onRequestText?.call();
    if (text == null || text.trim().isEmpty || !mounted) return;
    final fontSize = 24 + widget.style.width * 4;
    final laid = layoutBoardText(text, fontSize, widget.style.color, 900);
    final width = math.max(laid.width + 8, 60.0);
    final dir = textDirectionOf(text);
    // Right-to-left text grows from where it was placed towards the left.
    final left = dir == TextDirection.rtl ? at.dx - width : at.dx;
    final element = TextElement(
      id: _newId(),
      text: text,
      topLeft: BoardGeometry.clampToPage(Offset(left, at.dy - laid.height / 2)),
      size: Size(width, laid.height),
      fontSize: fontSize,
      color: widget.style.color,
    );
    widget.onCommit([...widget.page.elements, element]);
  }

  void _placeStamp(Offset at) {
    final style = widget.style;
    final text = style.stampText;
    final size = text == null ? const Size(140, 140) : Size(math.max(220, text.length * 46.0), 110);
    final rect = Rect.fromCenter(center: at, width: size.width, height: size.height);
    widget.onCommit([...widget.page.elements, StampElement(id: _newId(), stamp: style.stamp, rect: rect, color: style.color, text: text)]);
  }

  // -- selection -----------------------------------------------------------------

  Rect? get _selectionBounds {
    Rect? r;
    for (final e in widget.page.elements) {
      if (!_selected.contains(e.id)) continue;
      r = r == null ? e.bounds : r.expandToInclude(e.bounds);
    }
    return r;
  }

  double get _handleSize => 22 / _scale.clamp(0.1, 10);

  void _beginSelect(Offset at) {
    final bounds = _selectionBounds;
    if (bounds != null && (at - bounds.bottomRight).distance <= _handleSize) {
      _drag = _Drag.resize;
      return;
    }
    if (bounds != null && bounds.inflate(4).contains(at)) {
      _drag = _Drag.move;
      return;
    }
    final hit = BoardGeometry.hit(widget.page.elements, at);
    if (hit != null) {
      _selected = {hit.id};
      _drag = _Drag.move;
      return;
    }
    _selected = {};
    _drag = _Drag.marquee;
  }

  /// The page with the selection moved or resized from [a] to [b].
  List<BoardElement> _transformed(Offset a, Offset b) {
    final bounds = _selectionBounds;
    if (bounds == null) return widget.page.elements;
    BoardElement apply(BoardElement e) {
      if (_drag == _Drag.move) return e.translated(b - a);
      final w = math.max(8.0, bounds.width + (b.dx - a.dx));
      final h = math.max(8.0, bounds.height + (b.dy - a.dy));
      return e.scaled(bounds.topLeft, w / bounds.width.clamp(1, double.infinity), h / bounds.height.clamp(1, double.infinity));
    }

    return [
      for (final e in widget.page.elements)
        if (_selected.contains(e.id)) apply(e) else e,
    ];
  }

  // -- view ------------------------------------------------------------------------

  BoardPage get _shown {
    final working = _working;
    if (working != null) return widget.page.copyWith(elements: working);
    if ((_drag == _Drag.move || _drag == _Drag.resize) && _start != null && _current != null) {
      return widget.page.copyWith(elements: _transformed(_start!, _current!));
    }
    return widget.page;
  }

  BoardElement? get _shapePreview {
    if (_drag != _Drag.shape || _start == null || _current == null) return null;
    return _shapeFor(widget.tool, _start!, _current!);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        _viewport = constraints.biggest;
        return Listener(
          onPointerDown: _down,
          onPointerMove: _move,
          onPointerUp: _up,
          onPointerCancel: (e) => _up(e, cancelled: true),
          onPointerSignal: _signal,
          onPointerPanZoomStart: (_) => _lastTrackpadScale = 1,
          onPointerPanZoomUpdate: _panZoom,
          behavior: HitTestBehavior.opaque,
          child: MouseRegion(
            cursor: widget.readOnly || widget.tool == BoardTool.hand ? SystemMouseCursors.grab : SystemMouseCursors.precise,
            child: ClipRect(
              child: ListenableBuilder(
                listenable: _view,
                builder: (context, _) {
                  final pageSize = kBoardPageSize * _scale;
                  // The page sits where the pointer maths puts it: physical screen
                  // coordinates, and paper that is never mirrored for a
                  // right-to-left app.
                  return Directionality(
                    textDirection: TextDirection.ltr,
                    child: Stack(
                      children: [
                        const SizedBox.expand(),
                        Positioned.fromRect(
                          rect: _origin & pageSize,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              boxShadow: [BoxShadow(color: Theme.of(context).shadowColor.withValues(alpha: 0.18), blurRadius: 12)],
                            ),
                            child: RepaintBoundary(
                              child: CustomPaint(
                                size: pageSize,
                                painter: BoardPagePainter(page: _shown, placeholderLabel: widget.placeholderLabel),
                                foregroundPainter: _OverlayPainter(
                                  live: _drag == _Drag.draw && _live.isNotEmpty
                                      ? InkElement(
                                          id: 'live',
                                          points: _live,
                                          color: widget.style.color,
                                          width: widget.style.width,
                                          highlight: widget.tool == BoardTool.highlighter,
                                        )
                                      : null,
                                  liveRevision: _liveRevision,
                                  preview: _shapePreview,
                                  marquee: _drag == _Drag.marquee && _start != null && _current != null
                                      ? Rect.fromPoints(_start!, _current!)
                                      : null,
                                  selection: _drag == _Drag.move || _drag == _Drag.resize ? null : _selectionBounds,
                                  handle: _handleSize,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

/// What is drawn over the page: the stroke under the pen, a shape being
/// dragged, the marquee and the selection.
class _OverlayPainter extends CustomPainter {
  _OverlayPainter({this.live, required this.liveRevision, this.preview, this.marquee, this.selection, required this.handle});

  final InkElement? live;
  final int liveRevision;
  final BoardElement? preview;
  final Rect? marquee;
  final Rect? selection;
  final double handle;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / kBoardPageSize.width, size.height / kBoardPageSize.height);
    if (live != null) paintInk(canvas, live!);
    if (preview != null) paintElement(canvas, preview!);
    final outline = Paint()
      ..color = BoardPalette.selection
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2 * kBoardPageSize.width / size.width;
    if (marquee != null) {
      canvas.drawRect(marquee!, Paint()..color = BoardPalette.selection.withValues(alpha: 0.08));
      canvas.drawRect(marquee!, outline);
    }
    if (selection != null) {
      canvas.drawRect(selection!.inflate(4), outline);
      canvas.drawRect(
        Rect.fromCenter(center: selection!.bottomRight, width: handle, height: handle),
        Paint()..color = BoardPalette.selection,
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_OverlayPainter old) =>
      old.liveRevision != liveRevision ||
      old.preview != preview ||
      old.marquee != marquee ||
      old.selection != selection ||
      !identical(old.live, live);
}
