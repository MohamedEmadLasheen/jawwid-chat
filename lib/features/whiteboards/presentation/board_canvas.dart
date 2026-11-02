import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../data/board_images.dart';
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
    this.placeholderLabel,
    this.view,
    this.verses,
    this.versesVersion,
    this.images,
    this.imagesVersion,
  });

  final BoardPage page;
  final BoardTool tool;
  final ToolStyle style;
  final bool readOnly;

  /// One finished edit: the page's elements after it (one undo step).
  final ValueChanged<List<BoardElement>> onCommit;

  final String Function(BoardElement element)? placeholderLabel;

  /// Zoom and pan, shared with the zoom buttons.
  final BoardViewController? view;

  /// The verses' texts (the open board's verse cache), and what changes when one does.
  final VerseSource? verses;
  final Object? versesVersion;

  /// The board's images (the open board's image cache), and what changes when one arrives.
  final BoardImageSource? images;
  final Object? imagesVersion;

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

enum _Drag { none, draw, erase, shape, move, resize, rotate, marquee, pan, pinch }

/// PD-55: the text sizes the style bar steps through (page units).
const kBoardTextSizes = <double>[24, 32, 48, 64, 96, 144];

/// PD-55: a text being typed in place. Nothing is committed until it ends: the
/// whole edit is one undo step.
class _TextEdit {
  _TextEdit({required this.id, required this.original, required this.anchor, required this.fontSize, required this.color, required this.bold})
    : controller = TextEditingController(text: original?.text ?? ''),
      focus = FocusNode(debugLabel: 'board text');

  final String id;

  /// The text being re-edited; null for a new one.
  final TextElement? original;

  /// A new text: where it was tapped -- its start edge (the right edge for
  /// right-to-left text) and the middle of its first line.
  final Offset anchor;
  final TextEditingController controller;
  final FocusNode focus;
  double fontSize;
  Color color;
  bool bold;

  void dispose() {
    controller.dispose();
    focus.dispose();
  }
}

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

  // PD-55: text typed in place, the last text style, and a double tap.
  _TextEdit? _edit;
  double _textSize = 48;
  bool _textBold = false;
  Color? _textColor;
  DateTime? _lastDownAt;
  Offset? _lastDownAtScreen;
  final _editorKey = GlobalKey();
  final _styleBarKey = GlobalKey();

  @override
  void didUpdateWidget(BoardCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.view != widget.view && widget.view != null) _view = widget.view!;
    if (oldWidget.page.id != widget.page.id || oldWidget.tool != widget.tool) {
      _selected = {};
      // Another tool or page ends an edit -- after this frame, since it commits.
      if (_edit != null) WidgetsBinding.instance.addPostFrameCallback((_) => finishTextEdit());
    }
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
    _edit?.dispose();
    super.dispose();
  }

  /// The selection, for the editor's delete and arrange actions.
  Set<String> get selection => _selected;

  void clearSelection() => setState(() => _selected = {});

  /// Whether a text is being typed (the editor screen's shortcuts stand aside).
  bool get isEditingText => _edit != null;

  bool _onKey(KeyEvent e) {
    // A space typed into a text is a space, not "pan the view".
    if (e.logicalKey == LogicalKeyboardKey.space && _edit == null) {
      _spaceDown = e is! KeyUpEvent;
    }
    return false;
  }

  /// [pagePoint] on screen, in this canvas's own coordinates.
  @visibleForTesting
  Offset screenOf(Offset pagePoint) {
    final box = context.findRenderObject()! as RenderBox;
    return box.localToGlobal(_origin + pagePoint * _scale);
  }

  /// The rotate handle of the selected text, on screen; null without one.
  @visibleForTesting
  Offset? get rotateHandleOnScreen {
    final at = _rotateHandle;
    return at == null ? null : screenOf(at);
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

  bool _inside(GlobalKey key, Offset global) {
    final box = key.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return false;
    return (Offset.zero & box.size).contains(box.globalToLocal(global));
  }

  void _down(PointerDownEvent e) {
    if (e.kind == PointerDeviceKind.touch) _touches[e.pointer] = e.localPosition;
    if (_isPen(e)) _stylusSeen = true;
    // PD-55: the text being typed and its bar take their own taps; a tap
    // anywhere else ends the edit -- and only that.
    if (_inside(_editorKey, e.position) || _inside(_styleBarKey, e.position)) return;
    if (_edit != null && _activePointer == null) {
      finishTextEdit();
      _activePointer = e.pointer;
      _drag = _Drag.none;
      _start = null;
      return;
    }
    final now = DateTime.now();
    final last = _lastDownAt;
    final lastAt = _lastDownAtScreen;
    _lastDownAt = now;
    _lastDownAtScreen = e.localPosition;
    if (_activePointer == null &&
        !widget.readOnly &&
        last != null &&
        lastAt != null &&
        now.difference(last) < const Duration(milliseconds: 400) &&
        (e.localPosition - lastAt).distance < 24) {
      // A double tap on a text edits it in place, with any tool.
      final hit = BoardGeometry.hit(widget.page.elements, _toPage(e.localPosition));
      if (hit is TextElement) {
        _activePointer = e.pointer;
        _drag = _Drag.none;
        _start = null;
        _beginTextEdit(hit, hit.box.topLeft);
        return;
      }
    }
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
    if (_activePointer == null) return;
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
      case _Drag.rotate:
        // Not clamped to the page: the handle may be dragged off it.
        setState(() => _current = p);
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
      case _Drag.rotate:
        if (current == null) return;
        widget.onCommit(_rotated(current));
      case _Drag.none:
        if (start == null) return;
        if (tool == BoardTool.text) _placeText(start);
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

  // -- PD-55: text typed in place ------------------------------------------------

  /// The Text tool: a tap on a text edits it; anywhere else starts a new one there.
  void _placeText(Offset at) {
    final hit = BoardGeometry.hit(widget.page.elements, at);
    if (hit is TextElement) {
      _beginTextEdit(hit, hit.box.topLeft);
      return;
    }
    _beginTextEdit(null, at);
  }

  /// An edit's controller and focus node outlive the frame that removes its
  /// editor: released after it, never under a mounted EditableText.
  void _release(_TextEdit edit) => WidgetsBinding.instance.addPostFrameCallback((_) => edit.dispose());

  void _beginTextEdit(TextElement? original, Offset anchor) {
    final previous = _edit;
    if (previous != null) _release(previous);
    final edit = _TextEdit(
      id: original?.id ?? _newId(),
      original: original,
      anchor: anchor,
      fontSize: original?.fontSize ?? _textSize,
      color: original?.color ?? _textColor ?? widget.style.color,
      bold: original?.bold ?? _textBold,
    );
    edit.controller.addListener(() {
      if (mounted) setState(() {});
    });
    setState(() {
      _edit = edit;
      _selected = {};
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && identical(_edit, edit)) edit.focus.requestFocus();
    });
  }

  /// The text as it would be committed now.
  TextElement _editedText(_TextEdit edit) {
    final text = edit.controller.text;
    final original = edit.original;
    final measured = layoutBoardText(text.isEmpty ? ' ' : text, edit.fontSize, edit.color, 900, bold: edit.bold);
    final natural = math.max(measured.width + edit.fontSize * 0.5, 60.0);
    final rtl = textDirectionOf(text) == TextDirection.rtl;
    if (original == null) {
      final width = math.min(natural, 900.0);
      final laid = layoutBoardText(text.isEmpty ? ' ' : text, edit.fontSize, edit.color, width, bold: edit.bold);
      // Right-to-left text ends where it was tapped and grows towards the left.
      final left = rtl ? edit.anchor.dx - width : edit.anchor.dx;
      return TextElement(
        id: edit.id,
        text: text,
        topLeft: Offset(left, edit.anchor.dy - edit.fontSize * 0.7),
        size: Size(width, laid.height),
        fontSize: edit.fontSize,
        color: edit.color,
        bold: edit.bold,
      );
    }
    // Re-edited: it keeps its width unless the words need more, and grows from
    // the edge its direction starts at.
    final width = math.max(original.size.width, math.min(natural, 900.0));
    final laid = layoutBoardText(text.isEmpty ? ' ' : text, edit.fontSize, edit.color, width, bold: edit.bold);
    final left = rtl ? original.box.right - width : original.box.left;
    return original.copyWith(
      text: text,
      topLeft: Offset(left, original.box.top),
      size: Size(width, laid.height),
      fontSize: edit.fontSize,
      color: edit.color,
      bold: edit.bold,
    );
  }

  /// Ends the edit: one commit (a new text, the edited one, or -- emptied --
  /// its removal), or none for a new text left empty.
  void finishTextEdit() {
    final edit = _edit;
    if (edit == null) return;
    final element = _editedText(edit);
    final empty = edit.controller.text.trim().isEmpty;
    _textSize = edit.fontSize;
    _textBold = edit.bold;
    _textColor = edit.color;
    setState(() => _edit = null);
    _release(edit);
    if (edit.original == null) {
      if (!empty) widget.onCommit([...widget.page.elements, element]);
      return;
    }
    if (empty) {
      widget.onCommit([
        for (final e in widget.page.elements)
          if (e.id != edit.id) e,
      ]);
      return;
    }
    if (element.toJson().toString() == edit.original!.toJson().toString()) return;
    widget.onCommit([
      for (final e in widget.page.elements)
        if (e.id == edit.id) element else e,
    ]);
  }

  /// The one text selected (not being typed), for the style bar and the rotate handle.
  TextElement? get _selectedText {
    if (_edit != null || _selected.length != 1) return null;
    for (final e in widget.page.elements) {
      if (e is TextElement && _selected.contains(e.id)) return e;
    }
    return null;
  }

  /// A style change: to the text being typed, or -- one undo step -- to the selected one.
  void _restyle({double? fontSize, Color? color, bool? bold}) {
    final edit = _edit;
    if (edit != null) {
      setState(() {
        if (fontSize != null) edit.fontSize = fontSize;
        if (color != null) edit.color = color;
        if (bold != null) edit.bold = bold;
      });
      return;
    }
    final t = _selectedText;
    if (t == null) return;
    var next = t.copyWith(fontSize: fontSize, color: color, bold: bold);
    // A new size re-lays the words in the same width.
    final laid = layoutBoardText(next.text, next.fontSize, next.color, next.size.width, bold: next.bold);
    next = next.copyWith(size: Size(next.size.width, laid.height));
    _textSize = next.fontSize;
    _textBold = next.bold;
    _textColor = next.color;
    widget.onCommit([
      for (final e in widget.page.elements)
        if (e.id == t.id) next else e,
    ]);
  }

  double _stepSize(double from, int by) {
    final i = kBoardTextSizes.indexWhere((s) => s >= from - 0.5);
    final at = i < 0 ? kBoardTextSizes.length - 1 : i;
    final exact = i >= 0 && (kBoardTextSizes[at] - from).abs() < 0.5;
    final next = by > 0 ? (exact ? at + 1 : at) : at - 1;
    return kBoardTextSizes[next.clamp(0, kBoardTextSizes.length - 1)];
  }

  /// Where the rotate handle of the selected text sits: above its turned box.
  Offset? get _rotateHandle {
    final t = _selectedText;
    if (t == null) return null;
    final reach = t.size.height / 2 + 48 / _scale.clamp(0.1, 10);
    return t.box.center + Offset(math.sin(t.rotation) * reach, -math.cos(t.rotation) * reach);
  }

  /// Where the handle's stem starts: the middle of the turned box's top edge.
  Offset? get _rotateStem {
    final t = _selectedText;
    if (t == null) return null;
    final half = t.size.height / 2;
    return t.box.center + Offset(math.sin(t.rotation) * half, -math.cos(t.rotation) * half);
  }

  /// The page with the selected text turned towards [p]: upright snaps within
  /// 5 degrees; Shift steps by 15.
  List<BoardElement> _rotated(Offset p) {
    final t = _selectedText;
    if (t == null) return widget.page.elements;
    final d = p - t.box.center;
    var angle = math.atan2(d.dx, -d.dy);
    const quarter = math.pi / 2;
    if (HardwareKeyboard.instance.isShiftPressed) {
      angle = (angle / (math.pi / 12)).roundToDouble() * (math.pi / 12);
    } else {
      final nearest = (angle / quarter).roundToDouble() * quarter;
      if ((angle - nearest).abs() <= 5 * math.pi / 180) angle = nearest;
    }
    angle = angle % (2 * math.pi);
    if (angle.abs() < 1e-9) angle = 0;
    return [
      for (final e in widget.page.elements)
        if (e.id == t.id) t.copyWith(rotation: angle) else e,
    ];
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
    final handle = _rotateHandle;
    if (handle != null && (at - handle).distance <= _handleSize * 1.2) {
      _drag = _Drag.rotate;
      return;
    }
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
    if (_drag == _Drag.rotate && _current != null) return widget.page.copyWith(elements: _rotated(_current!));
    // The text being typed is drawn by its editor, not twice.
    final edit = _edit;
    if (edit != null) {
      return widget.page.copyWith(elements: [
        for (final e in widget.page.elements)
          if (e.id != edit.id) e,
      ]);
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
                                painter: BoardPagePainter(
                                  page: _shown,
                                  placeholderLabel: widget.placeholderLabel,
                                  verses: widget.verses,
                                  versesVersion: widget.versesVersion,
                                  images: widget.images,
                                  imagesVersion: widget.imagesVersion,
                                ),
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
                                  selection: _drag == _Drag.move || _drag == _Drag.resize || _drag == _Drag.rotate ? null : _selectionBounds,
                                  handle: _handleSize,
                                  rotateHandle: _drag == _Drag.none ? _rotateHandle : null,
                                  rotateStem: _rotateStem,
                                ),
                              ),
                            ),
                          ),
                        ),
                        ..._textOverlays(context),
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

extension on BoardCanvasState {
  /// PD-55: the text being typed, in place, and the style bar beside it.
  List<Widget> _textOverlays(BuildContext context) {
    final out = <Widget>[];
    final edit = _edit;
    final styled = edit != null ? _editedText(edit) : _selectedText;
    if (edit != null && styled != null) {
      final text = edit.controller.text;
      final dir = textDirectionOf(text);
      out.add(
        Positioned(
          left: _origin.dx + styled.topLeft.dx * _scale,
          top: _origin.dy + styled.topLeft.dy * _scale,
          child: Transform.scale(
            scale: _scale,
            alignment: Alignment.topLeft,
            child: Transform.rotate(
              angle: styled.rotation,
              child: SizedBox(
                key: _editorKey,
                width: styled.size.width,
                child: CallbackShortcuts(
                  // Escape ends the edit here, before the board's own shortcuts see it.
                  bindings: {const SingleActivator(LogicalKeyboardKey.escape): finishTextEdit},
                  // Typing keys (Backspace, Delete, the arrows, undo) are the
                  // text's: handled under the board's shortcuts, never by them.
                  child: DefaultTextEditingShortcuts(
                    child: EditableText(
                      controller: edit.controller,
                      focusNode: edit.focus,
                      style: boardTextStyle(edit.fontSize, edit.color, bold: edit.bold),
                      cursorColor: BoardPalette.selection,
                      backgroundCursorColor: BoardPalette.ruleOnLight,
                      textDirection: dir,
                      textAlign: dir == TextDirection.rtl ? TextAlign.right : TextAlign.left,
                      maxLines: null,
                      keyboardType: TextInputType.multiline,
                      cursorWidth: math.max(2, edit.fontSize / 16),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }
    if (styled != null && !widget.readOnly && _drag != _Drag.rotate) {
      final r = styled.bounds;
      final top = _origin.dy + r.top * _scale;
      final below = _origin.dy + r.bottom * _scale + 8;
      // The bar is about 500 px wide (ten 48 px targets): kept inside the view.
      final left = (_origin.dx + r.left * _scale).clamp(8.0, math.max(8.0, _viewport.width - _TextStyleBar.width - 8)).toDouble();
      out.add(
        Positioned(
          left: left,
          // Above the text being typed; below a selected one, whose rotate
          // handle is above it.
          top: edit == null || top - 64 < 8 ? below : top - 64,
          child: _TextStyleBar(
            key: _styleBarKey,
            fontSize: edit?.fontSize ?? styled.fontSize,
            color: edit?.color ?? styled.color,
            bold: edit?.bold ?? styled.bold,
            darkPage: widget.page.background.isDark,
            editing: edit != null,
            onSmaller: () => _restyle(fontSize: _stepSize(edit?.fontSize ?? styled.fontSize, -1)),
            onBigger: () => _restyle(fontSize: _stepSize(edit?.fontSize ?? styled.fontSize, 1)),
            onBold: () => _restyle(bold: !(edit?.bold ?? styled.bold)),
            onColor: (c) => _restyle(color: c),
            onDone: finishTextEdit,
          ),
        ),
      );
    }
    return out;
  }
}

/// PD-55: size, colour and bold for a text, beside it. Every target is at least
/// 44 px (Material's 48 on touch).
class _TextStyleBar extends StatelessWidget {
  const _TextStyleBar({
    super.key,
    required this.fontSize,
    required this.color,
    required this.bold,
    required this.darkPage,
    required this.editing,
    required this.onSmaller,
    required this.onBigger,
    required this.onBold,
    required this.onColor,
    required this.onDone,
  });

  final double fontSize;
  final Color color;
  final bool bold;
  final bool darkPage;
  final bool editing;
  final VoidCallback onSmaller;
  final VoidCallback onBigger;
  final VoidCallback onBold;
  final ValueChanged<Color> onColor;
  final VoidCallback onDone;

  static const _target = BoxConstraints(minWidth: 48, minHeight: 48);

  /// Its widest (typing: three buttons, six colours and Done), for placing it.
  static const width = 10 * 48.0 + 2 * Spacing.spacing1;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    // The quick colours: the first six inks, with chalk for ink on a dark page.
    final colours = [darkPage ? BoardPalette.pens.last : BoardPalette.pens.first, ...BoardPalette.pens.sublist(1, 6)];
    return Directionality(
      textDirection: Directionality.of(context),
      child: Material(
        elevation: 4,
        borderRadius: Radii.card,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing1),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                key: const ValueKey('board-text-smaller'),
                constraints: _target,
                tooltip: l10n.boardTextSmaller,
                onPressed: fontSize <= kBoardTextSizes.first ? null : onSmaller,
                icon: const Icon(Icons.text_decrease),
              ),
              IconButton(
                key: const ValueKey('board-text-bigger'),
                constraints: _target,
                tooltip: l10n.boardTextBigger,
                onPressed: fontSize >= kBoardTextSizes.last ? null : onBigger,
                icon: const Icon(Icons.text_increase),
              ),
              IconButton(
                key: const ValueKey('board-text-bold'),
                constraints: _target,
                tooltip: l10n.boardTextBold,
                isSelected: bold,
                onPressed: onBold,
                icon: const Icon(Icons.format_bold),
              ),
              for (var i = 0; i < colours.length; i++)
                Semantics(
                  label: l10n.boardTextColour,
                  selected: colours[i] == color,
                  button: true,
                  child: InkWell(
                    key: ValueKey('board-text-color-$i'),
                    customBorder: const CircleBorder(),
                    onTap: () => onColor(colours[i]),
                    child: SizedBox.square(
                      dimension: 48,
                      child: Center(
                        child: Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            color: colours[i],
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: colours[i] == color ? BoardPalette.selection : BoardPalette.ruleOnLight,
                              width: colours[i] == color ? 3 : 1,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              if (editing)
                IconButton(
                  key: const ValueKey('board-text-done'),
                  constraints: _target,
                  tooltip: l10n.boardTextDone,
                  onPressed: onDone,
                  icon: const Icon(Icons.check),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What is drawn over the page: the stroke under the pen, a shape being
/// dragged, the marquee and the selection.
class _OverlayPainter extends CustomPainter {
  _OverlayPainter({
    this.live,
    required this.liveRevision,
    this.preview,
    this.marquee,
    this.selection,
    required this.handle,
    this.rotateHandle,
    this.rotateStem,
  });

  final InkElement? live;
  final int liveRevision;
  final BoardElement? preview;
  final Rect? marquee;
  final Rect? selection;
  final double handle;

  /// PD-55: where the selected text's rotate handle is, and where its stem starts.
  final Offset? rotateHandle;
  final Offset? rotateStem;

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
    final r = rotateHandle;
    if (r != null && selection != null) {
      canvas.drawLine(rotateStem ?? Offset(selection!.center.dx, selection!.top), r, outline);
      canvas.drawCircle(r, handle * 0.6, Paint()..color = BoardPalette.selection);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_OverlayPainter old) =>
      old.liveRevision != liveRevision ||
      old.preview != preview ||
      old.marquee != marquee ||
      old.selection != selection ||
      old.rotateHandle != rotateHandle ||
      old.rotateStem != rotateStem ||
      !identical(old.live, live);
}
