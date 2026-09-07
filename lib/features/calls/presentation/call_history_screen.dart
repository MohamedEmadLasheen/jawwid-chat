import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';

/// Call history for one conversation.
///
/// Reads straight from the server on every open rather than from a local cache.
/// A call's outcome is decided server-side and can change AFTER the client last
/// saw it -- a ringing call becomes a missed call because a sweeper said so, not
/// because this device was watching -- so a cache here would show a call still
/// ringing that ended twenty minutes ago.
class CallHistoryScreen extends ConsumerWidget {
  const CallHistoryScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final calls = ref.watch(conversationCallsProvider(conversationId));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.callHistoryTitle)),
      body: calls.when(
        loading: () => const JawwidLoadingView(),
        error: (_, _) => JawwidErrorView(
          title: l10n.callUnavailable,
          onRetry: () => ref.invalidate(conversationCallsProvider(conversationId)),
        ),
        data: (items) => items.isEmpty
            ? JawwidEmptyView(
                title: l10n.callHistoryEmpty,
                icon: Icons.call_outlined,
              )
            : RefreshIndicator(
                onRefresh: () async =>
                    ref.invalidate(conversationCallsProvider(conversationId)),
                child: ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) =>
                      _CallRow(call: items[index]),
                ),
              ),
      ),
    );
  }
}

class _CallRow extends ConsumerWidget {
  const _CallRow({required this.call});

  final CallView call;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final me = ref.watch(authControllerProvider).user?.id;
    final outgoing = call.initiatorId == me;

    final missed = call.outcome == CallOutcome.missed;
    final label = switch (call.outcome) {
      CallOutcome.missed => l10n.callMissed,
      CallOutcome.declined => l10n.callDeclinedLabel,
      CallOutcome.cancelled => l10n.callCancelledLabel,
      CallOutcome.failed => l10n.callFailedLabel,
      _ => outgoing ? l10n.callOutgoing : l10n.callIncomingLabel,
    };

    return ListTile(
      leading: Icon(
        missed
            ? Icons.call_missed
            : (outgoing ? Icons.call_made : Icons.call_received),
        // A missed call is the one row worth colouring: it is the one the user
        // is scanning for.
        color: missed ? theme.colorScheme.error : theme.colorScheme.primary,
      ),
      title: Text(label),
      subtitle: Text(
        [
          DateFormat.yMd(Localizations.localeOf(context).toLanguageTag())
              .add_Hm()
              .format(call.startedAt),
          if (call.duration != null && call.duration! > Duration.zero)
            _formatDuration(call.duration!),
        ].join(' · '),
      ),
      // The recording marker appears ONLY when the server said this viewer may
      // know a recording exists. For everybody else `hasRecording` is false and
      // there is nothing here to notice -- which is the fact being protected.
      trailing: call.hasRecording
          ? Padding(
              // Directional, not physical: in Arabic this padding belongs on
              // the other side of the icon, and a physical edge would put it in
              // the wrong place for the academy's primary language.
              padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
              child: Icon(Icons.mic, size: 18, color: theme.colorScheme.outline),
            )
          : null,
    );
  }

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes.toString().padLeft(2, '0');
    final seconds = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }
}
