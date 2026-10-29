import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// Shown in place of an activity whose page did not load (TLS, the network, a
/// 404), instead of the WebView's blank white page: what happened, in the
/// reader's language, and a way to try again.
class ActivityLoadError extends StatelessWidget {
  const ActivityLoadError({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.wifi_off_outlined, size: 40, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: Spacing.spacing3),
            Text(l10n.activityLoadFailed, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            const SizedBox(height: Spacing.spacing4),
            FilledButton.tonal(key: const ValueKey('activity-retry'), onPressed: onRetry, child: Text(l10n.retryAction)),
          ],
        ),
      ),
    );
  }
}
