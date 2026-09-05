import 'package:flutter/material.dart';

import '../tokens.dart';

/// The three non-content states every screen owes the user (§55).
///
/// These exist as one shared set so no screen can quietly ship a blank body — the rule is
/// that a screen renders content, [JawwidLoadingView], [JawwidEmptyView], or
/// [JawwidErrorView], and never nothing.
class JawwidLoadingView extends StatelessWidget {
  const JawwidLoadingView({super.key, this.label});

  final String? label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: label,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox.square(
              dimension: 28,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
            if (label != null) ...[
              const SizedBox(height: Spacing.lg),
              Text(
                label!,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class JawwidEmptyView extends StatelessWidget {
  const JawwidEmptyView({
    super.key,
    required this.title,
    this.body,
    this.icon = Icons.forum_outlined,
    this.action,
  });

  final String title;
  final String? body;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: theme.colorScheme.outline),
            const SizedBox(height: Spacing.lg),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            if (body != null) ...[
              const SizedBox(height: Spacing.sm),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            if (action != null) ...[
              const SizedBox(height: Spacing.xl),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// An error the user can act on.
///
/// Takes an already-localised [title]/[body] pair rather than an error object, so that no
/// screen can accidentally render an exception's `toString()` into the UI (§37, §56).
class JawwidErrorView extends StatelessWidget {
  const JawwidErrorView({
    super.key,
    required this.title,
    this.body,
    this.retryLabel,
    this.onRetry,
    this.icon = Icons.error_outline,
  });

  final String title;
  final String? body;
  final String? retryLabel;
  final VoidCallback? onRetry;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: theme.colorScheme.error),
            const SizedBox(height: Spacing.lg),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            if (body != null) ...[
              const SizedBox(height: Spacing.sm),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            if (onRetry != null && retryLabel != null) ...[
              const SizedBox(height: Spacing.xl),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(retryLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A slim persistent banner, used for "no connection" and similar ambient states so the
/// content underneath stays usable.
class JawwidBanner extends StatelessWidget {
  const JawwidBanner({
    super.key,
    required this.message,
    this.icon = Icons.cloud_off,
    this.tone = JawwidBannerTone.neutral,
  });

  final String message;
  final IconData icon;
  final JawwidBannerTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (background, foreground) = switch (tone) {
      JawwidBannerTone.neutral => (
          theme.colorScheme.surfaceContainerHighest,
          theme.colorScheme.onSurface,
        ),
      JawwidBannerTone.warning => (
          JawwidColors.warning.withValues(alpha: 0.14),
          theme.colorScheme.onSurface,
        ),
      JawwidBannerTone.error => (
          theme.colorScheme.errorContainer,
          theme.colorScheme.onErrorContainer,
        ),
    };

    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        color: background,
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.lg,
          vertical: Spacing.sm,
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: foreground),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                message,
                style: theme.textTheme.bodySmall?.copyWith(color: foreground),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum JawwidBannerTone { neutral, warning, error }
