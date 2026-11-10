import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/push/notification_permission.dart';
import '../../../l10n/app_localizations.dart';
import 'push_permission_explainer_host.dart';

/// LR-11b: the Settings row for this device's notification permission.
///
/// "Notifications on this device: On / Off", and what a tap does: Allow (the
/// first ask goes through #557's explanation; on Android 13+ after one refusal,
/// the system prompt again) or Open settings (the phone's notification settings
/// for this app, which always works). The status is re-read when the row appears
/// and every time the app comes back to the foreground.
///
/// Nothing is shown where there is no native side (the web portal).
class NotificationPermissionTile extends ConsumerStatefulWidget {
  const NotificationPermissionTile({super.key});

  @override
  ConsumerState<NotificationPermissionTile> createState() => _NotificationPermissionTileState();
}

class _NotificationPermissionTileState extends ConsumerState<NotificationPermissionTile> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _refresh);
    // After the first frame: a provider is not modified while the tree builds.
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  void _refresh() {
    if (!mounted) return;
    unawaited(ref.read(notificationPermissionProvider.notifier).refresh());
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  Future<bool?> _showExplainer() => showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => const PushPermissionExplainerDialog(),
      );

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(notificationPermissionProvider);
    if (status == null || status == NotificationPermissionStatus.unsupported) {
      return const SizedBox.shrink();
    }
    final l10n = L10n.of(context);
    final on = status == NotificationPermissionStatus.granted;
    final action = switch (notificationPermissionActionFor(status)) {
      NotificationPermissionAction.explainThenAsk || NotificationPermissionAction.askAgain =>
        l10n.notificationDeviceAllow,
      _ => l10n.notificationPermissionAction,
    };
    return ListTile(
      key: const ValueKey('settings-notification-permission'),
      leading: Icon(on ? Icons.notifications_active_outlined : Icons.notifications_off_outlined),
      title: Text(l10n.notificationDeviceTitle),
      subtitle: status == NotificationPermissionStatus.unknown
          ? null
          : Text(on ? l10n.notificationDeviceOn : l10n.notificationDeviceOff),
      trailing: Text(
        action,
        key: const ValueKey('settings-notification-permission-action'),
        style: TextStyle(color: Theme.of(context).colorScheme.primary),
      ),
      onTap: () => unawaited(ref.read(notificationPermissionProvider.notifier).activate(_showExplainer)),
    );
  }
}
