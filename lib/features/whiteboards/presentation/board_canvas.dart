import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../data/board_images.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';
import '../domain/stroke_points.dart';
import 'board_painter.dart';

/// The board's tools (design §4.1).
enum BoardTool { select, hand, pen, highlighter, eraser, areaEraser, text, rect, ellipse, triangle, line, arrow, stamp, laser }

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
    this.onCommitTo,
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

  /// PD-55: an edit finished for a page no longer shown (a text being typed when
  /// the page changed) -- committed to THAT page. Without it, such an edit is
  /// committed through [onCommit] only if its page is still the one shown.
  final void Function(String pageId, List<BoardElement> elements)? onCommitTo;

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

enum _Drag { none, draw, erase, shape, move, resize, rotate, marquee, lasso, laser, pan, pinch }

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

class BoardCanvasState extends State<BoardCanvas> with SingleTickerProviderStateMixin {
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

  // PD-55 PR-2: the lasso's loop, what the stroke is drawn with, where the
  // eraser is, and the copied elements (kept across pages).
  List<Offset> _lasso = [];
  PointerDeviceKind _liveKind = PointerDeviceKind.mouse;
  Offset? _eraserAt;
  List<BoardElement> _clipboard = const [];
  int _pasteCount = 0;

  // PD-55 PR-3: the laser's trail, each point with the time it was made. It
  // is drawn and faded on its own ticker and is never part of the page.
  static const laserFade = Duration(milliseconds: 700);
  final List<(Offset, Duration)> _laser = [];
  late final Ticker _laserTicker = createTicker(_onLaserTick);
  Duration _laserNow = Duration.zero;

  @override
  void didUpdateWidget(BoardCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.view != widget.view && widget.view != null) _view = widget.view!;
    final edit = _edit;
    if (edit != null && oldWidget.page.id != widget.page.id) {
      // Another page: the text belongs to the page it was typed on. Its result
      // is taken from THAT page now; the commit (a provider change) waits for
      // the frame, but can no longer land on the page now in view (review of #384).
      final page = oldWidget.page;
      final elements = _finishedOn(page, edit);
      _edit = null;
      _release(edit);
      if (elements != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => widget.onCommitTo?.call(page.id, elements));
      }
    }
    // The laser points at the page it was used on: another page starts clean.
    if (oldWidget.page.id != widget.page.id) _laser.clear();
    if (oldWidget.page.id != widget.page.id || oldWidget.tool != widget.tool) {
      _selected = {};
      // Another tool ends an edit -- after this frame, since it commits.
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
    _laserTicker.dispose();
    super.dispose();
  }

  /// PD-55: the laser trail as it stands (page units, oldest first); for tests.
  @visibleForTesting
  List<Offset> get laserTrail => [for (final (p, _) in _laser) p];

  void _addLaserPoint(Offset p) {
    if (!_laserTicker.isActive) {
      _laserNow = Duration.zero;
      _laserTicker.start();
    }
    setState(() => _laser.add((p, _laserNow)));
  }

  void _onLaserTick(Duration elapsed) {
    _laserNow = elapsed;
    setState(() => _laser.removeWhere((point) => elapsed - point.$2 > laserFade));
    // Nothing left and nobody pointing: the ticker stops until the next point.
    if (_laser.isEmpty && _drag != _Drag.laser) _laserTicker.stop();
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

  /// The page in page units: wide 1920 x 1080 or tall 1080 x 1920 (PD-55).
  Size get _page => widget.page.size;
  double get _fit => math.min(_viewport.width / _page.width, _viewport.height / _page.height) * 0.96;
  double get _scale => _fit * _view.zoom;
  Offset get _origin => Offset(_viewport.width / 2, _viewport.height / 2) + _view.pan - Offset(_page.width, _page.height) * _scale / 2;

  Offset _toPage(Offset screen) => (screen - _origin) / _scale;

  // -- pointers -----------------------------------------------------------------

  bool _isPen(PointerEvent e) => _isPenKind(e.kind);
  bool _isPenKind(PointerDeviceKind kind) => kind == PointerDeviceKind.stylus || kind == PointerDeviceKind.invertedStylus;

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
        // Not with a drawing tool: its first tap would already have drawn or erased.
        const {BoardTool.select, BoardTool.hand, BoardTool.text}.contains(widget.tool) &&
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
      _lasso = [];
      _eraserAt = null;
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
    final at = BoardGeometry.clampToPage(p, _page);
    setState(() {
      _start = at;
      _current = at;
      switch (tool) {
        case BoardTool.pen:
        case BoardTool.highlighter:
          _drag = _Drag.draw;
          _liveKind = kind;
          _live = [StrokePoint(at.dx, at.dy, _pressure(pressure, kind))];
        case BoardTool.eraser:
        case BoardTool.areaEraser:
          _drag = _Drag.erase;
          _working = widget.page.elements;
          _eraserAt = at;
          _eraseAt(tool, at);
        case BoardTool.rect:
        case BoardTool.ellipse:
        case BoardTool.triangle:
        case BoardTool.line:
        case BoardTool.arrow:
          _drag = _Drag.shape;
        case BoardTool.select:
          _beginSelect(at);
        case BoardTool.laser:
          _drag = _Drag.laser;
          _addLaserPoint(p);
        case BoardTool.text:
        case BoardTool.stamp:
        case BoardTool.hand:
          _drag = _Drag.none;
      }
    });
  }

  void _update(BoardTool tool, Offset p, double pressure, PointerDeviceKind kind) {
    final at = BoardGeometry.clampToPage(p, _page);
    switch (_drag) {
      case _Drag.draw:
        _live.add(StrokePoint(at.dx, at.dy, _pressure(pressure, kind)));
        setState(() => _liveRevision++);
      case _Drag.erase:
        setState(() {
          // PD-55: all along the way since the last report, so a fast sweep
          // erases what it crossed and not only where the pointer landed.
          final from = _eraserAt ?? at;
          final steps = math.max(1, ((at - from).distance / (_eraserRadius * 0.75)).ceil());
          for (var i = 1; i <= steps; i++) {
            _eraseAt(tool, Offset.lerp(from, at, i / steps)!);
          }
          _eraserAt = at;
        });
      case _Drag.lasso:
        setState(() => _lasso.add(at));
      case _Drag.laser:
        _addLaserPoint(p);
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
          // A pen is drawn as it came; a finger or a mouse is steadied (PD-55).
          points: BoardGeometry.simplify(_isPenKind(_liveKind) ? _live : BoardGeometry.steady(_live)),
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
      case _Drag.lasso:
        final loop = _lasso;
        setState(() => _selected = BoardGeometry.inLasso(widget.page.elements, loop));
      case _Drag.laser:
        // Nothing to keep: the trail fades on its own.
        break;
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

  /// How far the erasers reach from the pointer, in page units (14 px on screen).
  double get _eraserRadius => 14 / _scale.clamp(0.1, 10);

  /// PD-55: the ring the eraser shows while erasing; null otherwise.
  @visibleForTesting
  Rect? get eraserRing {
    final at = _eraserAt;
    return at == null ? null : Rect.fromCircle(center: at, radius: _eraserRadius);
  }

  void _eraseAt(BoardTool tool, Offset at) {
    final radius = _eraserRadius;
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
    // A turned text grows about its centre: growing from an edge would swing it
    // across the page as it turns (review of #384).
    final topLeft = original.rotation == 0
        ? Offset(left, original.box.top)
        : original.box.center - Offset(width / 2, laid.height / 2);
    return original.copyWith(
      text: text,
      topLeft: topLeft,
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
    final elements = _finishedOn(widget.page, edit);
    setState(() => _edit = null);
    _release(edit);
    if (elements != null) widget.onCommit(elements);
  }

  /// [page]'s elements with [edit] applied -- the new text added, the edited one
  /// replaced, an emptied one removed -- or null when there is nothing to commit.
  List<BoardElement>? _finishedOn(BoardPage page, _TextEdit edit) {
    final element = _editedText(edit);
    final empty = edit.controller.text.trim().isEmpty;
    _textSize = edit.fontSize;
    _textBold = edit.bold;
    _textColor = edit.color;
    if (edit.original == null) return empty ? null : [...page.elements, element];
    if (empty) {
      return [
        for (final e in page.elements)
          if (e.id != edit.id) e,
      ];
    }
    if (element.toJson().toString() == edit.original!.toJson().toString()) return null;
    return [
      for (final e in page.elements)
        if (e.id == edit.id) element else e,
    ];
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

  /// PD-55: a reward stamp from the tray, in the middle of what is in view -- the
  /// teacher then drags it where they want. One undo step; returns its id.
  String placeStampInView({required StampKind stamp, String? text, required Color color}) {
    final centre = BoardGeometry.clampToPage(_toPage(Offset(_viewport.width / 2, _viewport.height / 2)));
    final size = text == null ? const Size(160, 160) : Size(math.max(220, text.length * 46.0), 110);
    final element = StampElement(id: _newId(), stamp: stamp, rect: Rect.fromCenter(center: centre, width: size.width, height: size.height), color: color, text: text);
    widget.onCommit([...widget.page.elements, element]);
    return element.id;
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
    // PD-55: a freehand lasso; Shift keeps the rectangle.
    if (HardwareKeyboard.instance.isShiftPressed) {
      _drag = _Drag.marquee;
    } else {
      _drag = _Drag.lasso;
      _lasso = [at];
    }
  }

  // -- PD-55: copy, paste, duplicate ------------------------------------------------

  /// Copies the selection (bottom first); nothing on the page changes.
  void copySelection() {
    if (_selected.isEmpty) return;
    // A state change: the bar's Paste comes on.
    setState(() {
      _clipboard = [
        for (final e in widget.page.elements)
          if (_selected.contains(e.id)) e,
      ];
      _pasteCount = 0;
    });
  }

  /// Pastes the copy on top, each paste 24 units further on; the pasted
  /// elements are the selection after. One undo step.
  void paste() {
    if (_clipboard.isEmpty || widget.readOnly) return;
    _pasteCount++;
    final offset = Offset(24.0 * _pasteCount, 24.0 * _pasteCount);
    // A copy is the element's own JSON under a new id: a verse stays a
    // reference, an image names the same asset, an unknown kind is kept as it came.
    var pasted = [for (final e in _clipboard) BoardElement.fromJson({...e.toJson(), 'id': _newId()}).translated(offset)];
    // PD-55: copied from a page of another shape, it may land off this one: moved back on.
    final back = _backOnPage(pasted.map((e) => e.bounds).reduce((a, b) => a.expandToInclude(b)));
    if (back != Offset.zero) pasted = [for (final e in pasted) e.translated(back)];
    widget.onCommit([...widget.page.elements, ...pasted]);
    setState(() => _selected = {for (final e in pasted) e.id});
  }

  /// How far to move [bounds] so it lies on this page: as far onto it as fits,
  /// its top-left corner first when it is larger than the page.
  Offset _backOnPage(Rect bounds) {
    double shift(double lo, double hi, double max) => hi > max ? math.max(max - hi, -lo) : (lo < 0 ? -lo : 0);
    return Offset(shift(bounds.left, bounds.right, _page.width), shift(bounds.top, bounds.bottom, _page.height));
  }

  /// Removes the selection: one undo step.
  void deleteSelection() {
    if (_selected.isEmpty || widget.readOnly) return;
    final gone = _selected;
    widget.onCommit([
      for (final e in widget.page.elements)
        if (!gone.contains(e.id)) e,
    ]);
    setState(() => _selected = {});
  }

  /// Copy and paste in one undo step.
  void duplicateSelection() {
    final keep = _clipboard;
    final count = _pasteCount;
    copySelection();
    paste();
    _clipboard = keep.isEmpty ? _clipboard : keep;
    _pasteCount = keep.isEmpty ? _pasteCount : count;
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
                  final pageSize = _page * _scale;
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
                                  page: _page,
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
                                  lasso: _drag == _Drag.lasso ? _lasso : null,
                                  lassoRevision: _lasso.length,
                                  eraserRing: eraserRing,
                                  laser: _laser.isEmpty ? null : [for (final (p, t) in _laser) (p, 1 - ((_laserNow - t).inMicroseconds / laserFade.inMicroseconds).clamp(0.0, 1.0))],
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
      // The stack is left-to-right (page coordinates, never mirrored), so start is left.
      out.add(
        PositionedDirectional(
          start: _origin.dx + styled.topLeft.dx * _scale,
          top: _origin.dy + styled.topLeft.dy * _scale,
          child: Transform.scale(
            scale: _scale,
            alignment: AlignmentDirectional.topStart,
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
    final actions = edit == null && _selected.isNotEmpty && !widget.readOnly && _drag == _Drag.none
        ? _SelectionActions(
            canPaste: _clipboard.isNotEmpty,
            onCopy: copySelection,
            onPaste: paste,
            onDuplicate: duplicateSelection,
            onDelete: deleteSelection,
          )
        : null;
    final bounds = _selectionBounds;
    if (styled == null && actions != null && bounds != null) {
      // PD-55: the selection's own actions, just below it.
      final left = (_origin.dx + bounds.left * _scale).clamp(8.0, math.max(8.0, _viewport.width - _SelectionActions.width - 8)).toDouble();
      out.add(
        PositionedDirectional(
          start: left,
          top: _origin.dy + bounds.bottom * _scale + 12,
          child: Material(
            key: _styleBarKey,
            elevation: 4,
            borderRadius: Radii.card,
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing1), child: actions),
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
        PositionedDirectional(
          start: left,
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
            actions: actions,
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
    this.actions,
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

  /// A selected (not typed) text's selection actions, after its style.
  final Widget? actions;

  static const _target = BoxConstraints(minWidth: 48, minHeight: 48);

  /// Its widest (selected: three buttons, six colours and the selection's
  /// four actions), for placing it.
  static const width = 13 * 48.0 + 2 * Spacing.spacing1;

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
              ?actions,
            ],
          ),
        ),
      ),
    );
  }
}

/// PD-55: copy, paste, duplicate and delete for what is selected. 48 px targets.
class _SelectionActions extends StatelessWidget {
  const _SelectionActions({required this.canPaste, required this.onCopy, required this.onPaste, required this.onDuplicate, required this.onDelete});

  final bool canPaste;
  final VoidCallback onCopy;
  final VoidCallback onPaste;
  final VoidCallback onDuplicate;
  final VoidCallback onDelete;

  static const width = 4 * 48.0 + 2 * Spacing.spacing1;
  static const _target = BoxConstraints(minWidth: 48, minHeight: 48);

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(key: const ValueKey('board-sel-copy'), constraints: _target, tooltip: l10n.boardCopy, onPressed: onCopy, icon: const Icon(Icons.copy_outlined)),
        IconButton(
          key: const ValueKey('board-sel-paste'),
          constraints: _target,
          tooltip: l10n.boardPaste,
          onPressed: canPaste ? onPaste : null,
          icon: const Icon(Icons.paste_outlined),
        ),
        IconButton(
          key: const ValueKey('board-sel-duplicate'),
          constraints: _target,
          tooltip: l10n.boardDuplicate,
          onPressed: onDuplicate,
          icon: const Icon(Icons.control_point_duplicate_outlined),
        ),
        IconButton(
          key: const ValueKey('board-sel-delete'),
          constraints: _target,
          tooltip: l10n.boardDeleteSelection,
          onPressed: onDelete,
          icon: const Icon(Icons.delete_outline),
        ),
      ],
    );
  }
}

/// What is drawn over the page: the stroke under the pen, a shape being
/// dragged, the marquee and the selection.
class _OverlayPainter extends CustomPainter {
  _OverlayPainter({
    required this.page,
    this.live,
    required this.liveRevision,
    this.preview,
    this.marquee,
    this.selection,
    required this.handle,
    this.rotateHandle,
    this.rotateStem,
    this.lasso,
    this.lassoRevision = 0,
    this.eraserRing,
    this.laser,
  });

  /// The page in page units (PD-55: wide or tall).
  final Size page;

  final InkElement? live;
  final int liveRevision;
  final BoardElement? preview;
  final Rect? marquee;
  final Rect? selection;
  final double handle;

  /// PD-55: where the selected text's rotate handle is, and where its stem starts.
  final Offset? rotateHandle;
  final Offset? rotateStem;

  /// PD-55 PR-2: the lasso's loop as drawn so far, and the eraser's ring.
  final List<Offset>? lasso;
  final int lassoRevision;
  final Rect? eraserRing;

  /// PD-55 PR-3: the laser trail, each point with how much of it is left (1 new, 0 gone).
  final List<(Offset, double)>? laser;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / page.width, size.height / page.height);
    if (live != null) paintInk(canvas, live!);
    if (preview != null) paintElement(canvas, preview!);
    final outline = Paint()
      ..color = BoardPalette.selection
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2 * page.width / size.width;
    if (marquee != null) {
      canvas.drawRect(marquee!, Paint()..color = BoardPalette.selection.withValues(alpha: 0.08));
      canvas.drawRect(marquee!, outline);
    }
    final loop = lasso;
    if (loop != null && loop.length > 1) {
      final path = Path()..addPolygon(loop, true);
      canvas.drawPath(path, Paint()..color = BoardPalette.selection.withValues(alpha: 0.08));
      canvas.drawPath(path, outline);
    }
    final trail = laser;
    if (trail != null && trail.isNotEmpty) {
      final scale = page.width / size.width;
      for (var i = 1; i < trail.length; i++) {
        final (a, _) = trail[i - 1];
        final (b, life) = trail[i];
        canvas.drawLine(
          a,
          b,
          Paint()
            ..color = BoardPalette.laser.withValues(alpha: 0.85 * life)
            ..strokeWidth = (4 + 6 * life) * scale
            ..strokeCap = StrokeCap.round,
        );
      }
      final (tip, life) = trail.last;
      canvas.drawCircle(tip, 9 * scale, Paint()..color = BoardPalette.laser.withValues(alpha: 0.35 * life));
      canvas.drawCircle(tip, 5 * scale, Paint()..color = BoardPalette.laser.withValues(alpha: life));
    }
    final ring = eraserRing;
    if (ring != null) {
      canvas.drawOval(ring, Paint()..color = BoardPalette.selection.withValues(alpha: 0.10));
      canvas.drawOval(ring, outline);
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
      old.page != page ||
      old.liveRevision != liveRevision ||
      old.preview != preview ||
      old.marquee != marquee ||
      old.selection != selection ||
      old.rotateHandle != rotateHandle ||
      old.rotateStem != rotateStem ||
      old.lassoRevision != lassoRevision ||
      !identical(old.lasso, lasso) ||
      old.eraserRing != eraserRing ||
      !identical(old.laser, laser) ||
      !identical(old.live, live);
}
