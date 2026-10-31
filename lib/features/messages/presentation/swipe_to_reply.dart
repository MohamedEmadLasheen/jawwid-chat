import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// PD-37: WhatsApp's swipe-to-reply. Drag a message toward the trailing side
/// -- rightward in English, leftward in Arabic -- past [threshold], let go, and
/// it becomes the message being replied to.
///
/// THE BACK GESTURE COMES FIRST (#141). The reply drag runs the same way as
/// the iOS back swipe, which starts at the LEADING edge. A touch that lands in
/// the leading [backGestureEdge] is never offered to this widget at all -- it
/// does not even enter the gesture arena -- so the back swipe cannot be lost
/// to a message that happens to sit under the thumb.
class SwipeToReply extends StatefulWidget {
  const SwipeToReply({super.key, required this.child, required this.onReply, this.enabled = true});

  /// How far the message must travel before letting go replies.
  static const threshold = 56.0;

  /// How far it can be pulled at all.
  static const maxTravel = 80.0;

  /// The leading strip left to the system back gesture -- the width of the
  /// iOS edge swipe.
  static const backGestureEdge = 20.0;

  final Widget child;
  final VoidCallback onReply;

  /// Off in select mode, in a read-only chat, and for a message nothing can be
  /// done to (see `canActOn`).
  final bool enabled;

  @override
  State<SwipeToReply> createState() => _SwipeToReplyState();
}

class _SwipeToReplyState extends State<SwipeToReply> with SingleTickerProviderStateMixin {
  late final _back = AnimationController(vsync: this)..addListener(_onSpringBack);
  double _travel = 0;
  double _springFrom = 0;
  bool _armed = false;

  /// The touch was cancelled (the system took it: a call, an alert). A drag
  /// already under way reports that through onEnd, not onCancel, so the
  /// pointer itself is watched.
  bool _pointerCancelled = false;

  bool get _rtl => Directionality.of(context) == TextDirection.rtl;

  @override
  void dispose() {
    _back.dispose();
    super.dispose();
  }

  void _onSpringBack() => setState(() => _travel = _springFrom * (1 - Motion.easingStandard.transform(_back.value)));

  /// Not in the leading [SwipeToReply.backGestureEdge] of the area the chat's
  /// pages are laid out in -- the back gesture's own edge. That is the
  /// navigator's box, not the screen: on an iPad in split view, or the web
  /// beside a list, the chat does not start at the screen's edge.
  bool _clearOfBackGesture(Offset global) {
    final box = Navigator.maybeOf(context)?.context.findRenderObject() as RenderBox?;
    final area = box != null && box.hasSize
        ? box.localToGlobal(Offset.zero) & box.size
        : Offset.zero & MediaQuery.sizeOf(context);
    return _rtl
        ? global.dx < area.right - SwipeToReply.backGestureEdge
        : global.dx > area.left + SwipeToReply.backGestureEdge;
  }

  void _onUpdate(DragUpdateDetails details) {
    _back.stop();
    final toward = _rtl ? -details.delta.dx : details.delta.dx;
    setState(() => _travel = (_travel + toward).clamp(0.0, SwipeToReply.maxTravel));
    final armed = _travel >= SwipeToReply.threshold;
    if (armed && !_armed) HapticFeedback.selectionClick();
    _armed = armed;
  }

  /// Let go: a reply if it was armed -- and if a finger really let go.
  void _onEnd(DragEndDetails _) {
    if (_armed && !_pointerCancelled) widget.onReply();
    _springBack();
  }

  /// Taken away -- the system cancelled the touch, or another gesture won it.
  /// Never a reply, armed or not: nobody let go.
  void _onCancel() => _springBack();

  void _springBack() {
    _armed = false;
    _springFrom = _travel;
    if (_travel == 0) return;
    _back.duration = Motion.respecting(context, Motion.motionBase);
    _back.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    final progress = (_travel / SwipeToReply.threshold).clamp(0.0, 1.0);
    final theme = Theme.of(context);
    return Semantics(
      customSemanticsActions: {CustomSemanticsAction(label: L10n.of(context).replyAction): widget.onReply},
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => _pointerCancelled = false,
        onPointerCancel: (_) => _pointerCancelled = true,
        child: RawGestureDetector(
          behavior: HitTestBehavior.translucent,
          gestures: {
            _ReplyDragRecognizer: GestureRecognizerFactoryWithHandlers<_ReplyDragRecognizer>(
              () => _ReplyDragRecognizer(allowedAt: _clearOfBackGesture, debugOwner: this),
              (r) => r
                ..onUpdate = _onUpdate
                ..onEnd = _onEnd
                ..onCancel = _onCancel,
            ),
          },
          child: Stack(
            alignment: AlignmentDirectional.centerStart,
            children: [
              if (_travel > 0)
                PositionedDirectional(
                  start: Spacing.spacing2,
                  child: Opacity(
                    opacity: progress,
                    child: Transform.scale(
                      scale: 0.6 + 0.4 * progress,
                      child: Icon(Icons.reply, color: theme.colorScheme.primary),
                    ),
                  ),
                ),
              Transform.translate(offset: Offset(_rtl ? -_travel : _travel, 0), child: widget.child),
            ],
          ),
        ),
      ),
    );
  }
}

/// A horizontal drag that is never offered a pointer landing in the strip the
/// back gesture owns.
class _ReplyDragRecognizer extends HorizontalDragGestureRecognizer {
  _ReplyDragRecognizer({required this.allowedAt, super.debugOwner});

  final bool Function(Offset global) allowedAt;

  @override
  bool isPointerAllowed(PointerEvent event) => allowedAt(event.position) && super.isPointerAllowed(event);
}
