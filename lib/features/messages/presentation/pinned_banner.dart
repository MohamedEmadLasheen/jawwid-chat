import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/marks_providers.dart';

/// The conversation's pinned messages, WhatsApp-style: one bar under the app
/// bar showing a pin; tapping it jumps to that message and moves the bar on to
/// the next. Absent when nothing is pinned.
class PinnedBanner extends ConsumerStatefulWidget {
  const PinnedBanner({super.key, required this.conversationId, required this.onJump});

  final String conversationId;

  /// Scroll to a message by its server id (when it is loaded).
  final void Function(String messageId) onJump;

  @override
  ConsumerState<PinnedBanner> createState() => _PinnedBannerState();
}

class _PinnedBannerState extends ConsumerState<PinnedBanner> {
  int _step = 0;

  @override
  Widget build(BuildContext context) {
    final pins = ref.watch(pinnedMessagesProvider(widget.conversationId)).asData?.value ?? const [];
    if (pins.isEmpty) return const SizedBox.shrink();

    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final theme = Theme.of(context);
    // Newest first; the counter reads oldest = 1, as WhatsApp's does.
    final shownIndex = pins.length - 1 - (_step % pins.length);
    final shown = pins[shownIndex].message;
    final label = pins.length > 1 ? l10n.pinnedBannerOf(shownIndex + 1, pins.length) : l10n.pinnedBannerOne;

    return Material(
      color: tokens.colorSurfaceMuted,
      child: InkWell(
        onTap: () {
          final id = shown.id;
          if (id != null) widget.onJump(id);
          setState(() => _step++);
        },
        child: Semantics(
          button: true,
          label: label,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing2),
            child: Row(
              children: [
                if (pins.length > 1)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (var i = 0; i < pins.length; i++)
                          Container(
                            width: 3,
                            height: 10,
                            margin: const EdgeInsets.symmetric(vertical: 1),
                            decoration: BoxDecoration(
                              color: i == shownIndex ? tokens.colorBrandPrimary : tokens.colorBorderStrong,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                      ],
                    ),
                  ),
                Icon(Icons.push_pin_outlined, size: 18, color: tokens.colorTextSecondary),
                const SizedBox(width: Spacing.spacing2),
                Expanded(
                  child: ExcludeSemantics(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(label, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.primary, fontWeight: FontWeight.w700)),
                        ContentText(
                          _preview(shown, l10n),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _preview(Message message, L10n l10n) {
    final body = message.body.trim();
    if (body.isNotEmpty) return body;
    return switch (message.attachments.firstOrNull?.kind ?? message.kind) {
      MessageKind.image => l10n.attachmentPhotoLabel,
      MessageKind.voice => l10n.attachmentVoiceLabel,
      _ => l10n.attachmentFileLabel,
    };
  }
}
