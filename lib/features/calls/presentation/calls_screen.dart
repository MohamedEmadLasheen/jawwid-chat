import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/search_text.dart';
import '../../../shared/utils/text_direction.dart';
import '../../conversations/application/conversations_controller.dart';
import '../../conversations/presentation/chat_search_field.dart';
import '../application/call_capability.dart';
import '../application/calls_controller.dart';
import '../application/upcoming_calls_controller.dart';
import '../data/scheduled_call_repository.dart';
import '../domain/scheduled_call.dart';
import 'call_member_picker.dart';
import 'calls_actions.dart';

/// Calls -- the same page for a parent and a teacher (PD-13).
///
/// A search field (by name), four actions -- Start call, New call link, Select
/// a member, Schedule call -- and three sections: Upcoming (scheduled calls and
/// open links), Favourites (pinned chats) and Recent (this account's history).
///
/// THERE IS STILL NO DIAL PAD AND NO DIRECTORY. Every action picks one of the
/// user's OWN conversations, and every call is started or joined inside that
/// conversation with the backend's permission, decided again on each request
/// (§31, §35). When the server refuses, this screen says so in words. Voice
/// only.
///
/// Nothing on this screen is fabricated. When calling has not been switched on
/// for the build, the Recent section says exactly that instead of showing an
/// inviting, empty list, and a failure is never drawn as "no calls".
class CallsScreen extends ConsumerStatefulWidget {
  const CallsScreen({super.key});

  @override
  ConsumerState<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends ConsumerState<CallsScreen> {
  final _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    await Future.wait([
      ref.read(callsControllerProvider.notifier).refresh(),
      ref.read(upcomingCallsControllerProvider.notifier).refresh(),
      ref.read(conversationsControllerProvider.notifier).refresh(),
    ]);
  }

  bool _registered(Object Function() read) {
    try {
      read();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Run an action only in a build that can perform it, and say so otherwise.
  void _guarded({
    required bool needsSchedule,
    required Future<void> Function() run,
  }) {
    final wired =
        _registered(() => ref.read(callRepositoryProvider)) &&
        (!needsSchedule ||
            _registered(() => ref.read(scheduledCallRepositoryProvider)));
    if (!wired) {
      showCallsSnack(context, L10n.of(context).callsUnavailableTitle);
      return;
    }
    run();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final history = ref.watch(callsControllerProvider);
    final upcoming = ref.watch(upcomingCallsControllerProvider);
    final conversationsState = ref.watch(conversationsControllerProvider);
    final conversations = loadedConversations(ref);
    final searching = SearchText.fold(_query).isNotEmpty;

    String labelOf(String conversationId) {
      final c = conversationById(conversations, conversationId);
      return c == null ? '' : conversationLabel(l10n, c);
    }

    // ---- Upcoming
    final upcomingError = upcoming.hasError && !upcoming.hasValue
        ? upcoming.error
        : null;
    final upcomingHidden =
        upcomingError is AppError &&
        upcomingError.code == scheduledCallsNotAvailableCode;
    final upcomingRows = [
      for (final call in upcoming.value ?? const <ScheduledCall>[])
        if (SearchText.matches(
          '${call.title ?? ''} ${labelOf(call.conversationId)}',
          _query,
        ))
          call,
    ];

    // ---- Favourites: only once the chat list has loaded, so a failure there
    // is never drawn as "you have no favourites".
    final favouritesKnown = conversationsState.hasValue;
    final favourites = [
      for (final c in conversations)
        if (c.isPinned &&
            pickable(c) &&
            SearchText.matches(conversationLabel(l10n, c), _query))
          c,
    ];

    // ---- Recent
    String titleOf(CallHistoryEntry e) {
      final own = e.title.trim();
      if (own.isNotEmpty) return own;
      final resolved = labelOf(e.conversationId);
      if (resolved.isNotEmpty) return resolved;
      return e.isGroup ? l10n.callGroup : l10n.callsUnnamed;
    }

    final recentRows = [
      for (final e in history.value ?? const <CallHistoryEntry>[])
        if (SearchText.matches(titleOf(e), _query)) e,
    ];

    final showUpcoming =
        !upcomingHidden && (!searching || upcomingRows.isNotEmpty);
    final showFavourites =
        favouritesKnown && (!searching || favourites.isNotEmpty);
    final recentIsList = history.hasValue && !history.hasError;
    final showRecent = !searching || !recentIsList || recentRows.isNotEmpty;
    final nothingMatched =
        searching && !showUpcoming && !showFavourites && !showRecent;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.callHistoryTitle),
        titleTextStyle: Theme.of(context).textTheme.titleLarge
            ?.copyWith(fontWeight: FontWeight.w700),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            ChatSearchField(
              controller: _search,
              hintText: l10n.callsSearchHint,
              onChanged: (value) => setState(() => _query = value),
              onClear: () {
                _search.clear();
                setState(() => _query = '');
              },
            ),
            _ActionTiles(
              onStart: () => _guarded(
                needsSchedule: false,
                run: () => startCallFlow(context, ref),
              ),
              onLink: () => _guarded(
                needsSchedule: true,
                run: () => newLinkFlow(context, ref),
              ),
              onSelect: () => _guarded(
                needsSchedule: false,
                run: () => selectMemberFlow(context, ref),
              ),
              onSchedule: () => _guarded(
                needsSchedule: true,
                run: () => scheduleFlow(context, ref),
              ),
            ),
            if (nothingMatched)
              JawwidEmptyView(
                icon: Icons.search_off,
                title: l10n.callsSearchNoMatch,
              ),
            if (showUpcoming) ...[
              _SectionHeader(text: l10n.callsSectionUpcoming),
              if (upcomingError != null)
                _InlineNote(
                  text: l10n.callsUpcomingError,
                  actionLabel: l10n.retryAction,
                  onAction: () => ref
                      .read(upcomingCallsControllerProvider.notifier)
                      .refresh(),
                )
              else if (!upcoming.hasValue)
                const _InlineProgress()
              else if (upcomingRows.isEmpty)
                _InlineNote(text: l10n.callsUpcomingEmpty)
              else
                for (final call in upcomingRows)
                  _UpcomingRow(
                    call: call,
                    conversation: conversationById(
                      conversations,
                      call.conversationId,
                    ),
                  ),
            ],
            if (showFavourites) ...[
              _SectionHeader(text: l10n.callsSectionFavorites),
              if (favourites.isEmpty)
                _InlineNote(text: l10n.callsFavoritesEmpty)
              else
                for (final c in favourites) _FavouriteRow(conversation: c),
            ],
            if (showRecent) ...[
              _SectionHeader(text: l10n.callsSectionRecent),
              switch (history) {
                AsyncError(:final error) when !history.hasValue => _CallsError(
                  error: error,
                ),
                AsyncValue(:final value?) when value.isEmpty => JawwidEmptyView(
                  icon: Icons.phone_outlined,
                  title: l10n.callHistoryEmpty,
                  body: l10n.callHistoryEmptyBody,
                ),
                AsyncValue(hasValue: true) => Column(
                  children: [
                    for (var i = 0; i < recentRows.length; i++) ...[
                      if (i > 0)
                        Divider(
                          height: 1,
                          indent:
                              Spacing.spacing5 +
                              Sizes.avatarMd +
                              Spacing.spacing4,
                          color: JawwidTokens.of(context).colorBorderSubtle,
                        ),
                      _CallRow(
                        entry: recentRows[i],
                        title: titleOf(recentRows[i]),
                      ),
                    ],
                  ],
                ),
                _ => JawwidLoadingView(label: l10n.callHistoryTitle),
              },
            ],
            const SizedBox(height: Spacing.spacing8),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ actions

class _ActionTiles extends StatelessWidget {
  const _ActionTiles({
    required this.onStart,
    required this.onLink,
    required this.onSelect,
    required this.onSchedule,
  });

  final VoidCallback onStart;
  final VoidCallback onLink;
  final VoidCallback onSelect;
  final VoidCallback onSchedule;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing3,
        vertical: Spacing.spacing3,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _ActionTile(
              icon: Icons.call_outlined,
              label: l10n.callActionStart,
              primary: true,
              onTap: onStart,
            ),
          ),
          Expanded(
            child: _ActionTile(
              icon: Icons.link,
              label: l10n.callActionNewLink,
              onTap: onLink,
            ),
          ),
          Expanded(
            child: _ActionTile(
              icon: Icons.person_search_outlined,
              label: l10n.callActionSelectMember,
              onTap: onSelect,
            ),
          ),
          Expanded(
            child: _ActionTile(
              icon: Icons.event_outlined,
              label: l10n.callActionSchedule,
              onTap: onSchedule,
            ),
          ),
        ],
      ),
    );
  }
}

/// A rounded, square, tonal tile with its label underneath. "Start call" is
/// the one filled in the brand colour.
class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.label,
    required this.onTap,
    this.primary = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool primary;

  static const double _tile = 56;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final fill = primary ? tokens.colorBrandPrimary : tokens.colorBrandSubtle;
    final glyph = primary
        ? tokens.colorBrandOnPrimary
        : tokens.colorBrandPrimary;

    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(Radii.radiusLg),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing1,
            vertical: Spacing.spacing2,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: _tile,
                height: _tile,
                decoration: BoxDecoration(
                  color: fill,
                  borderRadius: const BorderRadius.all(Radii.radiusLg),
                ),
                child: Icon(icon, color: glyph, size: Spacing.spacing7),
              ),
              const SizedBox(height: Spacing.spacing3),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: tokens.colorTextPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- sections

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Padding(
        padding: const EdgeInsetsDirectional.only(
          start: Spacing.spacing5,
          end: Spacing.spacing5,
          top: Spacing.spacing5,
          bottom: Spacing.spacing2,
        ),
        child: Text(
          text,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: JawwidTokens.of(context).colorTextSecondary,
          ),
        ),
      ),
    );
  }
}

/// The short line an empty or failed section collapses to.
class _InlineNote extends StatelessWidget {
  const _InlineNote({required this.text, this.actionLabel, this.onAction});

  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: JawwidTokens.of(context).colorTextSecondary,
              ),
            ),
          ),
          if (actionLabel != null && onAction != null)
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ),
    );
  }
}

class _InlineProgress extends StatelessWidget {
  const _InlineProgress();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(
      horizontal: Spacing.spacing5,
      vertical: Spacing.spacing3,
    ),
    child: LinearProgressIndicator(minHeight: 2),
  );
}

/// "Today, 14:05", "Yesterday, 09:30", "Monday, 18:00", "12 Oct 2026, 10:00".
String callWhenLabel(BuildContext context, DateTime when, DateTime now) {
  final l10n = L10n.of(context);
  final locale = Localizations.localeOf(context).toLanguageTag();
  final local = AppClock.view(when);
  final difference = RelativeTime.calendarDaysBetween(local, AppClock.view(now));

  final dayPart = switch (difference) {
    0 => l10n.todayLabel,
    1 => l10n.yesterdayLabel,
    > 1 && < 7 => DateFormat.EEEE(locale).format(local),
    _ => MaterialLocalizations.of(context).formatMediumDate(local),
  };
  return l10n.callWhen(dayPart, RelativeTime.forBubble(local, locale: locale));
}

class _UpcomingRow extends ConsumerWidget {
  const _UpcomingRow({required this.call, required this.conversation});

  final ScheduledCall call;
  final Conversation? conversation;

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.scheduledCallCancelConfirmTitle),
        content: Text(l10n.scheduledCallCancelConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.scheduledCallKeep),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.scheduledCallCancel),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(upcomingCallsControllerProvider.notifier).cancel(call.id);
    } catch (error) {
      if (!context.mounted) return;
      final appError = error is AppError
          ? error
          : const AppError(AppErrorKind.unknown);
      showCallsSnack(
        context,
        appError.code == ScheduledCallCodes.notJoinable
            ? l10n.scheduledJoinNotJoinable
            : ErrorPresenter.present(appError, l10n).title,
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final now = DateTime.now();
    final chat = conversation == null
        ? null
        : conversationLabel(l10n, conversation!);
    final title =
        call.title ??
        chat ??
        (call.isLink
            ? l10n.scheduledCallLinkLabel
            : l10n.scheduledCallDefaultTitle);
    final joinable = call.isJoinableAt(now);
    final when = callWhenLabel(context, call.startsAt, now);
    final subtitle = [
      if (chat != null && call.title != null) chat,
      when,
    ].join(' · ');

    final (chipText, chipFg, chipBg) = joinable
        ? (
            l10n.scheduledCallStateOpen,
            tokens.colorStatusSuccessFg,
            tokens.colorStatusSuccessBg,
          )
        : (
            l10n.scheduledCallStateUpcoming,
            tokens.colorStatusNeutralFg,
            tokens.colorStatusNeutralBg,
          );

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: Row(
        children: [
          Container(
            width: Sizes.avatarMd,
            height: Sizes.avatarMd,
            decoration: BoxDecoration(
              color: tokens.colorBrandSubtle,
              shape: BoxShape.circle,
            ),
            child: Icon(
              call.isLink ? Icons.link : Icons.event_outlined,
              size: 20,
              color: tokens.colorBrandPrimary,
            ),
          ),
          const SizedBox(width: Spacing.spacing4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                ContentText(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall,
                ),
                const SizedBox(height: Spacing.spacing1),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: tokens.colorTextSecondary,
                  ),
                ),
                const SizedBox(height: Spacing.spacing2),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Spacing.spacing3,
                    vertical: Spacing.spacing1,
                  ),
                  decoration: BoxDecoration(
                    color: chipBg,
                    borderRadius: const BorderRadius.all(Radii.radiusFull),
                  ),
                  child: Text(
                    chipText,
                    style: theme.textTheme.labelSmall?.copyWith(color: chipFg),
                  ),
                ),
              ],
            ),
          ),
          if (joinable)
            FilledButton.tonal(
              // The theme's buttons are full-width; this one sits in a row.
              style: FilledButton.styleFrom(
                minimumSize: const Size(
                  Sizes.minTouchTarget,
                  Sizes.minTouchTarget,
                ),
              ),
              onPressed: () => joinScheduledCall(
                context,
                ref,
                scheduledCallId: call.id,
                conversationId: call.conversationId,
                peerLabel: chat ?? title,
                isGroup:
                    conversation != null && isGroupConversation(conversation!),
              ),
              child: Text(l10n.scheduledCallJoin),
            ),
          if (call.canCancel)
            PopupMenuButton<String>(
              tooltip: l10n.scheduledCallCancel,
              onSelected: (_) => _cancel(context, ref),
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'cancel',
                  child: Text(l10n.scheduledCallCancel),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _FavouriteRow extends ConsumerWidget {
  const _FavouriteRow({required this.conversation});

  final Conversation conversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final label = conversationLabel(l10n, conversation);
    // Advisory, and absent rather than disabled when the server says no.
    final canCall = ref.watch(canCallProvider(conversation.id));

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
      leading: JawwidAvatar(
        displayName: label,
        imageUrl: conversation.avatarUrl,
        size: Sizes.avatarMd,
      ),
      title: ContentText(label, maxLines: 1, overflow: TextOverflow.ellipsis),
      onTap: () => openConversation(context, conversation.id),
      trailing: canCall
          ? IconButton(
              icon: const Icon(Icons.call_outlined),
              tooltip: l10n.callVoice,
              color: JawwidTokens.of(context).colorBrandPrimary,
              onPressed: () => callConversation(context, ref, conversation),
            )
          : null,
    );
  }
}

class _CallRow extends ConsumerWidget {
  const _CallRow({required this.entry, required this.title});

  final CallHistoryEntry entry;

  /// Resolved by the screen: the record's own name, else the conversation's.
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final now = DateTime.now();
    final canCall = ref.watch(canCallProvider(entry.conversationId));
    final direction = entry.direction;
    final missed = entry.outcome == CallOutcome.missed;

    final outcome = switch (entry.outcome) {
      CallOutcome.answered => l10n.callOutcomeAnswered,
      CallOutcome.missed => l10n.callOutcomeMissed,
      CallOutcome.declined => l10n.callOutcomeDeclined,
    };

    // Missed calls are marked by their icon and by their words, never by red alone (§53).
    final icon = switch (direction) {
      CallHistoryDirection.outgoing when missed => Icons.call_missed_outgoing,
      _ when missed => Icons.call_missed,
      CallHistoryDirection.outgoing => Icons.call_made,
      CallHistoryDirection.incoming => Icons.call_received,
      null when entry.outcome == CallOutcome.declined => Icons.call_end,
      null => Icons.call_received,
    };
    final tint = missed
        ? tokens.colorStatusDangerFg
        : tokens.colorTextSecondary;

    final duration = entry.duration;
    final detail = [
      outcome,
      if (duration != null)
        l10n.callDuration(duration.inMinutes, duration.inSeconds.remainder(60)),
    ].join(' · ');
    final when = callWhenLabel(context, entry.startedAt, now);
    final directionWord = switch (direction) {
      CallHistoryDirection.outgoing => l10n.callDirectionOutgoing,
      CallHistoryDirection.incoming => l10n.callDirectionIncoming,
      null => null,
    };

    return InkWell(
      onTap: () => openConversation(context, entry.conversationId),
      child: Padding(
        padding: const EdgeInsetsDirectional.only(
          start: Spacing.spacing5,
          end: Spacing.spacing3,
          top: Spacing.spacing3,
          bottom: Spacing.spacing3,
        ),
        child: Row(
          children: [
            Expanded(
              child: Semantics(
                label: [title, ?directionWord, detail, when].join('. '),
                child: ExcludeSemantics(
                  child: Row(
                    children: [
                      JawwidAvatar(displayName: title, size: Sizes.avatarMd),
                      const SizedBox(width: Spacing.spacing4),
                      Expanded(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ContentText(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleSmall?.copyWith(
                                color: missed
                                    ? tokens.colorStatusDangerFg
                                    : null,
                              ),
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
                        when,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: tokens.colorTextSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (canCall)
              IconButton(
                icon: const Icon(Icons.call_outlined),
                tooltip: l10n.callBack,
                color: tokens.colorBrandPrimary,
                onPressed: () {
                  final c = conversationById(
                    loadedConversationsRead(ref),
                    entry.conversationId,
                  );
                  if (c != null) {
                    callConversation(context, ref, c);
                  } else {
                    openConversation(context, entry.conversationId);
                  }
                },
              )
            else
              const SizedBox(width: Spacing.spacing3),
          ],
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
      return JawwidEmptyView(
        icon: Icons.phone_disabled_outlined,
        title: l10n.callsUnavailableTitle,
        body: l10n.callsUnavailableBody,
      );
    }

    final message = ErrorPresenter.present(
      appError ?? const AppError(AppErrorKind.unknown),
      l10n,
    );

    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry
          ? () => ref.read(callsControllerProvider.notifier).refresh()
          : null,
    );
  }
}
