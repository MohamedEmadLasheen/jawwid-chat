import 'dart:io';

import 'package:flutter/material.dart';

import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/byte_size_format.dart';
import '../../../shared/utils/text_direction.dart';

/// What the user decided about a chosen attachment.
class AttachmentDraft {
  const AttachmentDraft({required this.attachment, this.caption = ''});

  final PendingAttachment attachment;

  /// Optional text sent with the photo or file, in the same message.
  final String caption;
}

/// Review a chosen photo or file before it is sent.
///
/// §16 is explicit: a selected image must not be uploaded and sent on the spot.
/// The parent picked from a grid of thumbnails, possibly the wrong one, and the
/// only place that mistake is cheap to fix is here — before anything leaves the
/// phone and before anyone else has seen it.
///
/// Returns the draft to send, or null if the user backed out.
Future<AttachmentDraft?> showAttachmentPreview(
  BuildContext context, {
  required PendingAttachment attachment,
}) {
  return showModalBottomSheet<AttachmentDraft>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _AttachmentPreview(attachment: attachment),
  );
}

class _AttachmentPreview extends StatefulWidget {
  const _AttachmentPreview({required this.attachment});

  final PendingAttachment attachment;

  @override
  State<_AttachmentPreview> createState() => _AttachmentPreviewState();
}

class _AttachmentPreviewState extends State<_AttachmentPreview> {
  final _caption = TextEditingController();

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final isPhoto = widget.attachment.kind == MessageKind.image;

    return Padding(
      // Lifted above the keyboard: the caption field is the last thing here,
      // and a sheet that the keyboard covers is a sheet with no Send button.
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              header: true,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Spacing.spacing5,
                  vertical: Spacing.spacing2,
                ),
                child: Text(
                  l10n.attachmentSendTitle,
                  style: theme.textTheme.titleSmall,
                ),
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(Spacing.spacing5),
                child: isPhoto
                    ? _PhotoPreview(path: widget.attachment.filePath)
                    : _FilePreview(attachment: widget.attachment),
              ),
            ),
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(
                Spacing.spacing5,
                0,
                Spacing.spacing5,
                Spacing.spacing5,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _caption,
                      minLines: 1,
                      maxLines: 3,
                      maxLength: 1000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: l10n.composerHint,
                        counterText: '',
                        border: const OutlineInputBorder(
                          borderRadius: BorderRadius.all(Radii.radiusLg),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Spacing.spacing3),
                  IconButton.filled(
                    onPressed: () => Navigator.of(context).pop(
                      AttachmentDraft(
                        attachment: widget.attachment,
                        caption: _caption.text.trim(),
                      ),
                    ),
                    icon: const Icon(Icons.send),
                    tooltip: l10n.composerSend,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PhotoPreview extends StatelessWidget {
  const _PhotoPreview({required this.path});

  final String path;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: Radii.card,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 320),
        child: Image.file(
          File(path),
          fit: BoxFit.contain,
          errorBuilder: (context, _, _) => SizedBox(
            height: 160,
            child: Center(
              child: Icon(
                Icons.image_not_supported_outlined,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A document has nothing to show, so it shows what it is: the name the user
/// will see on the bubble, and how big it is.
class _FilePreview extends StatelessWidget {
  const _FilePreview({required this.attachment});

  final PendingAttachment attachment;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Container(
      padding: const EdgeInsets.all(Spacing.spacing4),
      decoration: BoxDecoration(
        color: tokens.colorSurfaceMuted,
        borderRadius: Radii.card,
        border: Border.all(color: tokens.colorBorderSubtle),
      ),
      child: Row(
        children: [
          Icon(
            Icons.insert_drive_file_outlined,
            size: 32,
            color: tokens.colorBrandPrimary,
          ),
          const SizedBox(width: Spacing.spacing4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                ContentText(
                  attachment.fileName?.trim().isNotEmpty == true
                      ? attachment.fileName!
                      : l10n.attachmentFileLabel,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                Text(
                  ByteSizeFormat.format(attachment.byteSize, l10n, locale: locale),
                  style: theme.textTheme.labelSmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
