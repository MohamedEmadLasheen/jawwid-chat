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
/// app-lock offer is undecided or on screen (PD-23), as the location prompt does. The
/// offer, decided after lock settings are read, in turn stays hidden while this
/// explanation is on screen (`AppLockGate`), so neither opens over the other.
class PushPermissionExplainerHost extends ConsumerStatefulWidget {
  const PushPermissionExplainerHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<PushPermissionExplainerHost> createState() => _PushPermissionExplainerHostState();
}

class _PushPermissionExplainerHostState extends ConsumerState<PushPermissionExplainerHost> {
  static bool _lockBusy(AppLockState lock) => lock.offerVisible || lock.phase == AppLockPhase.pending;

  /// False until this host's first frame is done. The lesson-audio notice (a child of
  /// this host) marks itself busy in ITS first post-frame callback, which runs after
  /// one this host registered in the same frame; so on a fresh mount nothing is shown
  /// until one frame later, when that busy flag is already up.
  bool _settled = false;

  /// The explainer this host's dialog claimed, while that dialog is open.
  PushExplainer? _claimed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _settled = true);
    });
  }

  @override
  void dispose() {
    // Removed with the dialog still open (a sign-out). The dialog's future may never
    // complete when its whole navigator goes, so the claim is handed back here: the
    // question was not answered, and the next shell to mount asks it again. After
    // this frame, never while the tree is being torn down.
    final claimed = _claimed;
    _claimed = null;
    if (claimed != null) scheduleMicrotask(claimed.release);
    super.dispose();
  }

  /// The other first-run dialogs are all out of the way. [watch] in build; a fresh
  /// read when the post-frame callback actually runs.
  bool _othersClear({required bool watch}) {
    if (watch) {
      return !ref.watch(legalGateShownProvider) &&
          !ref.watch(lessonAudioNoticeBusyProvider) &&
          !_lockBusy(ref.watch(appLockControllerProvider));
    }
    return !ref.read(legalGateShownProvider) &&
        !ref.read(lessonAudioNoticeBusyProvider) &&
        !_lockBusy(ref.read(appLockControllerProvider));
  }

  Future<void> _show() async {
    // Re-checked: a gate can have become busy between the build and this callback.
    if (!mounted || !_othersClear(watch: false)) return;
    final explainer = ref.read(pushExplainerProvider.notifier);
    if (!explainer.claim()) return;
    _claimed = explainer;

    // Completes with true (Continue) or false (Not now, and System Back, which the
    // dialog turns into Not now itself). NULL means nobody answered: the page below
    // was removed -- a sign-out's redirect removes the signed-in page, and the
    // router's navigator removes this pageless dialog with it, completing it with
    // null. (If the whole navigator goes instead, it may never complete; `dispose`
    // covers that.)
    final proceed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PushPermissionExplainerDialog(),
    );

    // Already handed back by `dispose`: not this host's to answer any more.
    if (!identical(_claimed, explainer)) return;
    _claimed = null;

    if (proceed == null) {
      // The screen went away under it: no answer was given, so the next shell to
      // mount asks again.
      explainer.release();
      return;
    }
    await explainer.answer(proceed: proceed);
  }

  @override
  Widget build(BuildContext context) {
    final phase = ref.watch(pushExplainerProvider);
    // The other gates are only consulted while there is something to show, so a
    // shell with nothing waiting reads nothing else.
    if (_settled && phase == PushExplainerPhase.waiting && _othersClear(watch: true)) {
      WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_show()));
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
    // System Back is an answer: "Not now". Popped here with an explicit false, so a
    // null result always means "removed unanswered" (see the host).
    return PopScope<bool>(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(false);
      },
      child: _dialog(context, l10n),
    );
  }

  Widget _dialog(BuildContext context, L10n l10n) {
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
