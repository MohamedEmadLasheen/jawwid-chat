import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/locked_call_guard.dart';
import 'active_call_screen.dart';

/// The call route's screen: [ActiveCallScreen], with every way off it -- Back, Close,
/// opening the conversation -- going through [LockedCallGuard] (LR-46 P2-1).
///
/// On an unlocked phone nothing changes: Back pops as before, and the callbacks run at
/// once. On a locked phone (the call was taken from the lock screen) the person unlocks
/// first; cancelled, they stay on the call.
///
/// [onLeave] and [onOpenConversation] are the plain navigations, which the router owns.
/// They may run after an unlock prompt, so they must check the call route is still the
/// one on top.
class CallRouteScreen extends ConsumerWidget {
  const CallRouteScreen({super.key, required this.onLeave, this.onOpenConversation});

  /// Take the call route off the top.
  final VoidCallback onLeave;

  /// Leave the call screen for its conversation.
  final OpenConversation? onOpenConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locked = ref.watch(lockedCallGuardProvider);
    final guard = ref.read(lockedCallGuardProvider.notifier);
    final open = onOpenConversation;

    return PopScope(
      // Unlocked: Back pops the call route, as it always did.
      canPop: !locked,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(guard.leave(onLeave));
      },
      child: ActiveCallScreen(
        onLeave: () => unawaited(guard.leave(onLeave)),
        onOpenConversation: open == null
            ? null
            : (conversationId, {required recordVoice}) => unawaited(
                  guard.leave(() => open(conversationId, recordVoice: recordVoice)),
                ),
      ),
    );
  }
}
