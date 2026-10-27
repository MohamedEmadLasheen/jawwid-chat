import 'package:flutter/material.dart';

/// Keeps the leading-edge swipe-back working over content that would otherwise take the
/// touch: a WebView, which is a native platform view.
///
/// Over a platform view the swipe that leaves every other screen did not leave this one.
/// The page under the finger got the drag (on an Android phone, owner's smoke test
/// 2026-10-27), while the back key still worked. So the leading [edgeWidth] belongs to
/// Flutter here, as it does on every other screen. Everything else is the child's, so a
/// lesson that scrolls sideways still does.
///
///  * **iOS / macOS**: the strip only keeps the touch out of the platform view. The route's
///    own Cupertino swipe (see `JawwidTheme.pageTransitions`) takes it from there, with
///    its usual interactive slide.
///  * **Android and the rest**: the strip is the swipe. A drag toward the trailing side,
///    past a third of the screen or flung, goes back by [Navigator.maybePop], the same
///    as the back key.
///
/// The edge is the LEADING one: the left in English, the right in Arabic.
class EdgeSwipeBack extends StatefulWidget {
  const EdgeSwipeBack({super.key, required this.child});

  final Widget child;

  /// The same 20pt the Cupertino route reserves.
  static const edgeWidth = 20.0;

  /// A fling toward the trailing side, in logical pixels per second, goes back however
  /// short the drag.
  static const flingVelocity = 700.0;

  @override
  State<EdgeSwipeBack> createState() => _EdgeSwipeBackState();
}

class _EdgeSwipeBackState extends State<EdgeSwipeBack> {
  /// How far the finger has gone toward the trailing side since the drag began.
  double _toward = 0;

  @override
  Widget build(BuildContext context) {
    final platform = Theme.of(context).platform;
    final cupertino = platform == TargetPlatform.iOS || platform == TargetPlatform.macOS;
    // +1 when "toward the trailing side" is rightward.
    final sign = Directionality.of(context) == TextDirection.rtl ? -1.0 : 1.0;

    final strip = cupertino
        // Opaque, and nothing else: the touch stops here, so the platform view below never
        // claims it and the route's own back gesture receives it.
        ? const _OpaqueStrip()
        : GestureDetector(
            behavior: HitTestBehavior.opaque,
            onHorizontalDragStart: (_) => _toward = 0,
            onHorizontalDragUpdate: (details) => _toward += sign * details.delta.dx,
            onHorizontalDragEnd: (details) {
              final velocity = sign * details.velocity.pixelsPerSecond.dx;
              final far = _toward > MediaQuery.sizeOf(context).width / 3;
              final flung = _toward > 0 && velocity > EdgeSwipeBack.flingVelocity;
              if (far || flung) Navigator.maybePop(context);
            },
            child: const SizedBox.expand(),
          );

    return Stack(
      children: [
        widget.child,
        PositionedDirectional(
          start: 0,
          top: 0,
          bottom: 0,
          width: EdgeSwipeBack.edgeWidth,
          child: KeyedSubtree(key: const ValueKey('edge-swipe-back'), child: strip),
        ),
      ],
    );
  }
}

class _OpaqueStrip extends StatelessWidget {
  const _OpaqueStrip();

  @override
  Widget build(BuildContext context) =>
      const Listener(behavior: HitTestBehavior.opaque, child: SizedBox.expand());
}
