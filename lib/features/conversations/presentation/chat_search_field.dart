import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// The search field that sits directly under the Chats header.
///
/// Visible, always — not an icon that opens a search page, and not something behind an
/// overflow menu. Finding a conversation is the second thing anyone does in a messaging
/// app after reading one, and hiding it behind a tap is the single most common way a chat
/// list is made to feel unfamiliar.
///
/// The magnifier is a `prefixIcon`, so it sits at the *leading* edge in both directions —
/// left in English, right in Arabic — without any mirroring logic here.
class ChatSearchField extends StatelessWidget {
  const ChatSearchField({
    super.key,
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: ValueListenableBuilder<TextEditingValue>(
        valueListenable: controller,
        builder: (context, value, _) {
          final hasText = value.text.isNotEmpty;

          return TextField(
            controller: controller,
            onChanged: onChanged,
            textInputAction: TextInputAction.search,
            // A name, not a sentence: capitalising every word is wrong for Arabic and
            // wrong for a search box.
            textCapitalization: TextCapitalization.none,
            autocorrect: false,
            style: theme.textTheme.bodyMedium,
            decoration: InputDecoration(
              hintText: l10n.searchHint,
              isDense: true,
              filled: true,
              fillColor: tokens.colorSurfaceMuted,
              contentPadding: const EdgeInsets.symmetric(
                vertical: Spacing.spacing4,
              ),
              prefixIcon: Icon(
                Icons.search,
                size: 20,
                color: tokens.colorTextSecondary,
              ),
              prefixIconConstraints: const BoxConstraints(
                minWidth: 44,
                minHeight: 44,
              ),
              suffixIcon: hasText
                  ? IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      tooltip: l10n.searchClear,
                      onPressed: onClear,
                      color: tokens.colorTextSecondary,
                    )
                  : null,
              // A pill, the shape this control has in every app the audience knows.
              //
              // The border is not decoration. The muted fill sits only a few percent off
              // the surface behind it, so without an edge this reads as a faint tint
              // rather than as something you can type into — and the filter chips below
              // *do* carry a border, which would leave the most important control on the
              // screen looking less real than the chips under it.
              border: _border(tokens.colorBorderDefault),
              enabledBorder: _border(tokens.colorBorderDefault),
              focusedBorder: _border(tokens.colorBorderFocus, width: 2),
            ),
          );
        },
      ),
    );
  }

  static OutlineInputBorder _border(Color color, {double width = 1}) =>
      OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radii.radiusFull),
        borderSide: BorderSide(color: color, width: width),
      );
}
