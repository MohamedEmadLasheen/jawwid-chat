import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/calls_controller.dart';

/// Calls — the history of calls this user took part in.
///
/// There is no "new call" button, and there is no dial pad. A call in this product starts
/// from inside the conversation it belongs to and only ever with the backend's permission
/// (§31, §35); a parent may join a Student Group call but may never start one (PD-2). A
/// composer for calls on this screen would offer something the backend would refuse.
///
/// Nothing on this screen is fabricated. When calling has not been switched on for the
/// build, it says exactly that instead of showing an inviting, empty list.
class CallsScreen extends ConsumerWidget {
  const CallsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(callsControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.callHistoryTitle),
        titleTextStyle: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(callsControllerProvider.notifier).refresh(),
        child: switch (state) {
          AsyncLoading() => JawwidLoadingView(label: l10n.callHistoryTitle),
          AsyncError(:final error) => _CallsError(error: error),
          AsyncData(:final value) when value.isEmpty => _Centred(
              child: JawwidEmptyView(
                icon: Icons.phone_outlined,
                title: l10n.callHistoryEmpty,
                body: l10n.callHistoryEmptyBody,
              ),
            ),
          AsyncData(:final value) => _History(entries: value),
        },
      ),
    );
  }
}

class _History extends StatelessWidget {
  const _History({required this.entries});

  final List<CallHistoryEntry> entries;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();

    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: entries.length,
      separatorBuilder: (context, index) => Divider(
        height: 1,
        color: JawwidTokens.of(context).colorBorderSubtle,
      ),
      itemBuilder: (context, index) => _CallRow(entry: entries[index], now: now),
    );
  }
}

class _CallRow extends StatelessWidget {
  const _CallRow({required this.entry, required this.now});

  final CallHistoryEntry entry;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    final outcome = switch (entry.outcome) {
      CallOutcome.answered => l10n.callOutcomeAnswered,
      CallOutcome.missed => l10n.callOutcomeMissed,
      CallOutcome.declined => l10n.callOutcomeDeclined,
    };

    // Missed calls are marked by their icon and by their words, never by red alone (§53).
    final (icon, tint) = switch (entry.outcome) {
      CallOutcome.answered => (Icons.call_received, tokens.colorTextSecondary),
      CallOutcome.missed => (Icons.call_missed, tokens.colorStatusDangerFg),
      CallOutcome.declined => (Icons.call_end, tokens.colorTextSecondary),
    };

    final duration = entry.duration;
    final detail = [
      outcome,
      if (duration != null)
        l10n.callDuration(duration.inMinutes, duration.inSeconds.remainder(60)),
    ].join(' · ');

    return Semantics(
      label: '${entry.title}. $detail',
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing5,
            vertical: Spacing.spacing4,
          ),
          child: Row(
            children: [
              JawwidAvatar(
                displayName: entry.title,
                size: Sizes.avatarMd,
              ),
              const SizedBox(width: Spacing.spacing4),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ContentText(
                      entry.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall,
                    ),
                    const SizedBox(height: Spacing.spacing1),
                    Row(
                      children: [
                        Icon(icon, size: 14, color: tint),
                        const SizedBox(width: Spacing.spacing2),
                        Flexible(
                          child: Text(
                            detail,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: tint,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Spacing.spacing3),
              Text(
                RelativeTime.forListRow(
                  entry.startedAt,
                  now,
                  locale: locale,
                  todayLabel: l10n.todayLabel,
                  yesterdayLabel: l10n.yesterdayLabel,
                ),
                style: theme.textTheme.labelSmall?.copyWith(
                  color: tokens.colorTextSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Separates "calling is not wired up" from every other failure.
class _CallsError extends ConsumerWidget {
  const _CallsError({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final appError = error is AppError ? error as AppError : null;

    if (appError?.code == callsNotAvailableCode) {
      return _Centred(
        child: JawwidEmptyView(
          icon: Icons.phone_disabled_outlined,
          title: l10n.callsUnavailableTitle,
          body: l10n.callsUnavailableBody,
        ),
      );
    }

    final message = ErrorPresenter.present(
      appError ?? const AppError(AppErrorKind.unknown),
      l10n,
    );

    return _Centred(
      child: JawwidErrorView(
        title: message.title,
        body: message.body,
        retryLabel: message.canRetry ? l10n.retryAction : null,
        onRetry: message.canRetry
            ? () => ref.read(callsControllerProvider.notifier).refresh()
            : null,
      ),
    );
  }
}

/// Keeps a non-content state pull-to-refreshable, which a bare [Center] is not.
class _Centred extends StatelessWidget {
  const _Centred({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: child,
        ),
      ),
    );
  }
}
