import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/push/push_permission_explainer.dart';
import '../../../l10n/app_localizations.dart';
import '../../app_lock/application/app_lock_controller.dart';
import '../../legal/application/legal_gate_state.dart';
import '../../settings/data/parent_notice_repository.dart';

/// LR-11 (explain-first): shows [PushPermissionExplainerDialog] when a signed-in
/// session is waiting on it (`PushExplainer.clearToStart`), then hands the answer
/// back. The platform's own prompt comes only after Continue.
///
/// Mounted by the signed-in shell, for every role, inside the router's navigator so
/// the dialog has somewhere to open. Renders nothing itself.
///
/// One first-run dialog at a time: it waits while the Terms of Use gate is up
/// (PD-58), while the lesson-audio notice is being decided (PD-48) and while the
/// app-lock offer is undecided or on screen (PD-23), as the location prompt does.
class PushPermissionExplainerHost extends ConsumerStatefulWidget {
  const PushPermissionExplainerHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<PushPermissionExplainerHost> createState() => _PushPermissionExplainerHostState();
}

class _PushPermissionExplainerHostState extends ConsumerState<PushPermissionExplainerHost> {
  static bool _lockBusy(AppLockState lock) => lock.offerVisible || lock.phase == AppLockPhase.pending;

  Future<void> _show() async {
    if (!mounted) return;
    final explainer = ref.read(pushExplainerProvider.notifier);
    if (!explainer.claim()) return;

    final proceed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PushPermissionExplainerDialog(),
    );

    if (proceed != null) {
      await explainer.answer(proceed: proceed);
    } else if (mounted) {
      // System Back on the dialog, with the app still here: "Not now".
      await explainer.answer(proceed: false);
    } else {
      // The screen went away under it (a sign-out): no answer was given, so the
      // next shell to mount asks again.
      explainer.release();
    }
  }

  @override
  Widget build(BuildContext context) {
    final phase = ref.watch(pushExplainerProvider);
    // The other gates are only consulted while there is something to show, so a
    // shell with nothing waiting reads nothing else.
    if (phase == PushExplainerPhase.waiting) {
      final clear = !ref.watch(legalGateShownProvider) &&
          !ref.watch(lessonAudioNoticeBusyProvider) &&
          !_lockBusy(ref.watch(appLockControllerProvider));
      if (clear) {
        WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_show()));
      }
    }
    return widget.child;
  }
}

/// What Jawwid notifies about, and why calls need it. Continue, then the system
/// prompt; Not now, and nothing is asked.
class PushPermissionExplainerDialog extends StatelessWidget {
  const PushPermissionExplainerDialog({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return AlertDialog(
      key: const ValueKey('push-explainer'),
      icon: const Icon(Icons.notifications_active_outlined),
      title: Text(l10n.notificationPermissionTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.notificationPermissionBody),
          const SizedBox(height: 8),
          Text(l10n.notificationPermissionCallsNote),
        ],
      ),
      actions: [
        TextButton(
          key: const ValueKey('push-explainer-not-now'),
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.notificationPermissionNotNow),
        ),
        FilledButton(
          key: const ValueKey('push-explainer-continue'),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(l10n.notificationPermissionContinue),
        ),
      ],
    );
  }
}
