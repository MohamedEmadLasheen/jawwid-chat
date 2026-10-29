import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../../core/media/local_image.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';

/// Open the photos of a conversation full-screen, starting at [initialIndex].
///
/// Pushed as an opaque route rather than shown as a dialog: it is a place the
/// user goes and comes back from, so it gets a back gesture and a real entry in
/// the history stack. §18 — the parent must not lose the conversation.
///
/// Not a `fullscreenDialog`: on iOS a full-screen dialog has no swipe-back, so
/// the viewer could only be left by its close button. As a plain page it
/// leaves by the edge swipe, like every other screen; swipes away from the
/// edge still turn the photos.
Future<void> showMediaViewer(
  BuildContext context, {
  required List<Attachment> photos,
  required int initialIndex,
  DateTime? takenAt,
}) {
  if (photos.isEmpty) return Future.value();

  return Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute<void>(
      builder: (_) => MediaViewer(
        photos: photos,
        initialIndex: initialIndex.clamp(0, photos.length - 1),
        takenAt: takenAt,
      ),
    ),
  );
}

class MediaViewer extends StatefulWidget {
  const MediaViewer({
    super.key,
    required this.photos,
    this.initialIndex = 0,
    this.takenAt,
  });

  final List<Attachment> photos;
  final int initialIndex;

  /// When the message carrying these photos was sent.
  final DateTime? takenAt;

  @override
  State<MediaViewer> createState() => _MediaViewerState();
}

class _MediaViewerState extends State<MediaViewer> {
  late final PageController _pages =
      PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  /// The photo on screen is zoomed in: a drag moves it, and the pages hold
  /// still until it is back to its size.
  bool _zoomed = false;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  /// "Photo 2 of 5" -- or just "Photo" when there is one.
  String _positionLabel(L10n l10n, int index) =>
      widget.photos.length > 1 ? l10n.photoPositionLabel(index + 1, widget.photos.length) : l10n.photoLabel;

  void _onPageChanged(int index) {
    setState(() {
      _index = index;
      _zoomed = false;
    });
    // A screen reader hears where it is now; the counter alone changes silently.
    SemanticsService.sendAnnouncement(
      View.of(context),
      _positionLabel(L10n.of(context), index),
      Directionality.of(context),
    );
  }

  /// A zoomed photo dragged on past its edge: on to the photo that way.
  void _turn(int by) {
    final to = _index + by;
    if (to < 0 || to >= widget.photos.length) return;
    _pages.animateToPage(
      to,
      duration: Motion.respecting(context, Motion.motionBase),
      curve: Motion.easingStandard,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final takenAt = widget.takenAt;

    return Scaffold(
      // Dark regardless of the app theme — see the media tokens.
      backgroundColor: tokens.colorMediaSurface,
      appBar: AppBar(
        backgroundColor: tokens.colorMediaSurface,
        foregroundColor: tokens.colorMediaOnSurface,
        // The close affordance is a leading icon, not a mirrored arrow: this is
        // a dismissal, and "X" means the same thing in both directions.
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: l10n.closeAction,
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: takenAt == null
            ? null
            : Text(
                RelativeTime.forBubble(takenAt, locale: locale),
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: tokens.colorMediaOnSurfaceMuted),
              ),
      ),
      body: Stack(
        children: [
          PageView.builder(
            controller: _pages,
            itemCount: widget.photos.length,
            // PD-37: swipe between the photos, as WhatsApp does -- unless the
            // photo is zoomed in, when the same drag moves around it.
            physics: _zoomed ? const NeverScrollableScrollPhysics() : null,
            onPageChanged: _onPageChanged,
            itemBuilder: (context, index) => _ZoomablePhoto(
              onZoomChanged: (zoomed) {
                if (zoomed != _zoomed) setState(() => _zoomed = zoomed);
              },
              onPastEdge: _turn,
              child: _Photo(attachment: widget.photos[index], label: _positionLabel(l10n, index)),
            ),
          ),
          // The counter appears only when there is more than one, so a single
          // photo is not captioned "1 / 1".
          if (widget.photos.length > 1)
            PositionedDirectional(
              bottom: Spacing.spacing7,
              start: 0,
              end: 0,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Spacing.spacing4,
                    vertical: Spacing.spacing2,
                  ),
                  decoration: BoxDecoration(
                    color: tokens.colorMediaScrimStrong,
                    borderRadius: const BorderRadius.all(Radii.radiusFull),
                  ),
                  // Forced LTR: "3 / 8" is a fraction, not a sentence, and
                  // mirroring it makes it read as 8 / 3.
                  child: Semantics(
                    label: _positionLabel(l10n, _index),
                    excludeSemantics: true,
                    child: Directionality(
                      textDirection: TextDirection.ltr,
                      child: Text(
                        '${_index + 1} / ${widget.photos.length}',
                        style: TextStyle(color: tokens.colorMediaOnSurface),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One page: pinch or double-tap to zoom, up to 4x.
///
/// At its own size it does not pan. InteractiveViewer pans by default even
/// unzoomed, and its drag then competed with the PageView's. Once zoomed in, a
/// drag moves the photo -- and a drag that carries on past the photo's edge
/// turns to the next one, as on WhatsApp.
class _ZoomablePhoto extends StatefulWidget {
  const _ZoomablePhoto({required this.child, required this.onZoomChanged, required this.onPastEdge});

  final Widget child;
  final ValueChanged<bool> onZoomChanged;

  /// +1 for the next photo, -1 for the previous (in reading order).
  final ValueChanged<int> onPastEdge;

  /// Double-tap zoom.
  static const doubleTapScale = 2.5;

  /// How far a zoomed drag must carry on past the edge to turn the photo.
  static const pastEdgeToTurn = 64.0;

  @override
  State<_ZoomablePhoto> createState() => _ZoomablePhotoState();
}

class _ZoomablePhotoState extends State<_ZoomablePhoto> with SingleTickerProviderStateMixin {
  final _transform = TransformationController();
  late final _zoomAnimation = AnimationController(vsync: this)..addListener(_onZoomFrame);
  Animation<Matrix4>? _zoomTween;
  bool _zoomed = false;
  Offset _doubleTapAt = Offset.zero;

  /// How far, this gesture, a single finger has pushed past the left (< 0) or
  /// right (> 0) edge of the zoomed photo.
  double _pastEdge = 0;
  Size _viewport = Size.zero;

  @override
  void initState() {
    super.initState();
    _transform.addListener(_onTransform);
  }

  @override
  void dispose() {
    _zoomAnimation.dispose();
    _transform
      ..removeListener(_onTransform)
      ..dispose();
    super.dispose();
  }

  void _onTransform() {
    final zoomed = _transform.value.getMaxScaleOnAxis() > 1.01;
    if (zoomed == _zoomed) return;
    setState(() => _zoomed = zoomed);
    widget.onZoomChanged(zoomed);
  }

  void _onZoomFrame() {
    final tween = _zoomTween;
    if (tween != null) _transform.value = tween.value;
  }

  void _animateTo(Matrix4 target) {
    _zoomTween = Matrix4Tween(begin: _transform.value, end: target)
        .animate(CurvedAnimation(parent: _zoomAnimation, curve: Motion.easingStandard));
    _zoomAnimation
      ..duration = Motion.respecting(context, Motion.motionBase)
      ..forward(from: 0);
  }

  /// In at the tapped point, or back out.
  void _onDoubleTap() {
    if (_zoomed) {
      _animateTo(Matrix4.identity());
      return;
    }
    const s = _ZoomablePhoto.doubleTapScale;
    final p = _doubleTapAt;
    _animateTo(Matrix4.identity()
      ..translateByDouble(-p.dx * (s - 1), -p.dy * (s - 1), 0, 1)
      ..scaleByDouble(s, s, 1, 1));
  }

  void _onInteractionStart(ScaleStartDetails details) {
    _zoomAnimation.stop();
    _pastEdge = 0;
  }

  void _onInteractionUpdate(ScaleUpdateDetails details) {
    if (!_zoomed || details.pointerCount != 1) {
      _pastEdge = 0;
      return;
    }
    // The photo is clamped to its own bounds: at the left edge its x
    // translation is 0, at the right edge it is width - width * scale.
    final m = _transform.value;
    final scale = m.getMaxScaleOnAxis();
    final x = m.getTranslation().x;
    final dx = details.focalPointDelta.dx;
    final atLeft = x >= -0.5;
    final atRight = x <= _viewport.width - _viewport.width * scale + 0.5;
    if (dx > 0 && atLeft) {
      _pastEdge += dx;
    } else if (dx < 0 && atRight) {
      _pastEdge += dx;
    } else if (dx != 0) {
      _pastEdge = 0;
    }
  }

  void _onInteractionEnd(ScaleEndDetails details) {
    final past = _pastEdge;
    _pastEdge = 0;
    if (past.abs() < _ZoomablePhoto.pastEdgeToTurn) return;
    // Dragged leftward past the right edge: the next photo in English, the
    // previous one in Arabic (the pages run the other way).
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final towardNext = rtl ? past > 0 : past < 0;
    _transform.value = Matrix4.identity();
    widget.onPastEdge(towardNext ? 1 : -1);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          _viewport = constraints.biggest;
          return GestureDetector(
            onDoubleTapDown: (d) => _doubleTapAt = d.localPosition,
            onDoubleTap: _onDoubleTap,
            child: InteractiveViewer(
              transformationController: _transform,
              minScale: 1,
              maxScale: 4,
              panEnabled: _zoomed,
              onInteractionStart: _onInteractionStart,
              onInteractionUpdate: _onInteractionUpdate,
              onInteractionEnd: _onInteractionEnd,
              child: Center(child: widget.child),
            ),
          );
        },
      );
}

/// One photo, from wherever it currently lives.
///
/// A photo that is still uploading is on disk; one that has been sent is behind
/// a short-lived signed URL. [Attachment.isLocal] is the only thing that tells
/// them apart, and getting it wrong shows a broken image on the sender's own
/// screen for the length of an upload.
///
/// Decoded at the screen's width in pixels, not the photo's: a 12-megapixel
/// photo held at full size is about 48 MB of memory per page. (Zoomed in, it is
/// as sharp as the screen, not as the original.)
class _Photo extends StatelessWidget {
  const _Photo({required this.attachment, required this.label});

  final Attachment attachment;

  /// What a screen reader says: "Photo 2 of 5".
  final String label;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final url = attachment.url;
    if (url == null || url.isEmpty) return Semantics(label: label, child: const _PhotoUnavailable());
    final decodeWidth = (MediaQuery.sizeOf(context).width * MediaQuery.devicePixelRatioOf(context)).round();

    if (attachment.isLocal) {
      return Image(
        image: ResizeImage.resizeIfNeeded(decodeWidth, null, localImageProvider(url)),
        fit: BoxFit.contain,
        semanticLabel: label,
        errorBuilder: (_, _, _) => const _PhotoUnavailable(),
      );
    }

    return Image.network(
      url,
      fit: BoxFit.contain,
      cacheWidth: decodeWidth,
      semanticLabel: label,
      loadingBuilder: (context, child, progress) => progress == null
          ? child
          : Center(
              child: CircularProgressIndicator(color: tokens.colorMediaOnSurface),
            ),
      // A signed URL expires; when it does the photo is simply not there yet,
      // and the fix is to reopen the conversation, not to show the user an
      // HTTP status (§31).
      errorBuilder: (_, _, _) => const _PhotoUnavailable(),
    );
  }
}

class _PhotoUnavailable extends StatelessWidget {
  const _PhotoUnavailable();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Icon(
        Icons.image_not_supported_outlined,
        color: JawwidTokens.of(context).colorMediaOnSurfaceMuted,
        size: 48,
      ),
    );
  }
}
