import 'package:flutter/material.dart';

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
            onPageChanged: (index) => setState(() {
              _index = index;
              _zoomed = false;
            }),
            itemBuilder: (context, index) => _ZoomablePhoto(
              onZoomChanged: (zoomed) {
                if (zoomed != _zoomed) setState(() => _zoomed = zoomed);
              },
              child: _Photo(attachment: widget.photos[index]),
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
        ],
      ),
    );
  }
}

/// One page: pinch to zoom up to 4x.
///
/// At its own size it does not pan. InteractiveViewer pans by default even
/// unzoomed, and so it took every one-finger drag from the PageView -- the
/// photos could not be swiped. Once zoomed in, a drag moves the photo.
class _ZoomablePhoto extends StatefulWidget {
  const _ZoomablePhoto({required this.child, required this.onZoomChanged});

  final Widget child;
  final ValueChanged<bool> onZoomChanged;

  @override
  State<_ZoomablePhoto> createState() => _ZoomablePhotoState();
}

class _ZoomablePhotoState extends State<_ZoomablePhoto> {
  final _transform = TransformationController();
  bool _zoomed = false;

  @override
  void initState() {
    super.initState();
    _transform.addListener(_onTransform);
  }

  @override
  void dispose() {
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

  @override
  Widget build(BuildContext context) => InteractiveViewer(
        transformationController: _transform,
        minScale: 1,
        maxScale: 4,
        panEnabled: _zoomed,
        child: Center(child: widget.child),
      );
}

/// One photo, from wherever it currently lives.
///
/// A photo that is still uploading is on disk; one that has been sent is behind
/// a short-lived signed URL. [Attachment.isLocal] is the only thing that tells
/// them apart, and getting it wrong shows a broken image on the sender's own
/// screen for the length of an upload.
class _Photo extends StatelessWidget {
  const _Photo({required this.attachment});

  final Attachment attachment;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final url = attachment.url;
    if (url == null || url.isEmpty) return const _PhotoUnavailable();

    if (attachment.isLocal) {
      return Image(
        image: localImageProvider(url),
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => const _PhotoUnavailable(),
      );
    }

    return Image.network(
      url,
      fit: BoxFit.contain,
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
