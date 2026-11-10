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
/// Nothing is shown where there is no native side (the web portal). A native side
/// that does not answer within `notificationPermissionReadTimeout` still gets the
/// row, neutral (no On/Off, Open settings).
class NotificationPermissionTile extends ConsumerStatefulWidget {
  const NotificationPermissionTile({super.key});

  @override
  ConsumerState<NotificationPermissionTile> createState() => _NotificationPermissionTileState();
}

class _NotificationPermissionTileState extends ConsumerState<NotificationPermissionTile> {
  late final AppLifecycleListener _lifecycle;

  /// Held for [dispose], where `ref` may no longer be read.
  late final NotificationPermissionController _controller;

  @override
  void initState() {
    super.initState();
    _controller = ref.read(notificationPermissionProvider.notifier);
    _lifecycle = AppLifecycleListener(onResume: _refresh);
    // After the first frame: a provider is not modified while the tree builds.
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  void _refresh() {
    if (!mounted) return;
    unawaited(ref.read(notificationPermissionProvider.notifier).refresh());
  }

  /// The row's controller while this row's explanation dialog is open.
  NotificationPermissionController? _dialogOpenFor;

  @override
  void dispose() {
    _lifecycle.dispose();
    // A native side that never answers: its read's timeout does not outlive the
    // row (a pending timer), and nothing is read or asked for a row that is gone.
    // The next row to appear reads again.
    _controller.stopWaiting();
    // Removed with the explanation still open (a forced sign-out removing the whole
    // navigator): that dialog may never answer. Hand the explanation and the row
    // back, as #557's host does, after this frame, never while the tree is being
    // torn down.
    final controller = _dialogOpenFor;
    _dialogOpenFor = null;
    if (controller != null) scheduleMicrotask(controller.dialogAbandoned);
    super.dispose();
  }

  Future<bool?> _showExplainer() async {
    if (!mounted) return null;
    final controller = ref.read(notificationPermissionProvider.notifier);
    _dialogOpenFor = controller;
    try {
      return await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => const PushPermissionExplainerDialog(),
      );
    } finally {
      if (identical(_dialogOpenFor, controller)) _dialogOpenFor = null;
    }
  }

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
