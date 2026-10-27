import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../application/notification_center_controller.dart';
import '../domain/inbox.dart';

/// The clock entry times are shown against. Overridden in tests.
final notificationsClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// PD-34: the bell on Chats, with the unread count.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final unread = ref.watch(inboxCountsProvider).value?.unread ?? 0;
    return IconButton(
      key: const ValueKey('notification-bell'),
      tooltip: l10n.notificationsCenterTitle,
      onPressed: () => context.push(Routes.notifications),
      icon: Badge(
        isLabelVisible: unread > 0,
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const Icon(Icons.notifications_outlined),
      ),
    );
  }
}

/// PD-34: the account's Notification Center. One tab per kind the server says this
/// account has; each entry says what happened, when, and offers the one thing to do next.
class NotificationCenterScreen extends ConsumerWidget {
  const NotificationCenterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final counts = ref.watch(inboxCountsProvider).value ?? InboxCounts.empty;
    final tabs = counts.tabs;

    return DefaultTabController(
      key: ValueKey(tabs.map((t) => t.wire).join(',')),
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.notificationsCenterTitle),
          actions: [
            IconButton(
              key: const ValueKey('notifications-settings'),
              tooltip: l10n.settingsNotifications,
              icon: const Icon(Icons.tune),
              onPressed: () => context.push(Routes.notificationSettings),
            ),
          ],
          bottom: tabs.length < 2
              ? null
              : TabBar(
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  tabs: [
                    for (final t in tabs)
                      Tab(
                        key: ValueKey('notifications-tab-${t.wire}'),
                        text: _tabLabel(l10n, t, counts.perTab[t] ?? 0),
                      ),
                  ],
                ),
        ),
        body: TabBarView(children: [for (final t in tabs) _TabBody(tab: t)]),
      ),
    );
  }

  static String _tabLabel(L10n l10n, InboxTab tab, int unread) {
    final name = switch (tab) {
      InboxTab.all => l10n.notificationsTabAll,
      InboxTab.unread => l10n.notificationsTabUnread,
      InboxTab.action => l10n.notificationsTabAction,
      InboxTab.lessons => l10n.notificationsTabLessons,
      InboxTab.payments => l10n.notificationsTabPayments,
      InboxTab.conversations => l10n.notificationsTabConversations,
      InboxTab.announcements => l10n.notificationsTabAnnouncements,
    };
    return tab != InboxTab.all && tab != InboxTab.unread && unread > 0 ? '$name ($unread)' : name;
  }
}

class _TabBody extends ConsumerWidget {
  const _TabBody({required this.tab});

  final InboxTab tab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(inboxTabProvider(tab));
    return state.when(
      loading: () => const JawwidLoadingView(),
      error: (error, _) {
        final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
        return JawwidErrorView(
          title: message.title,
          body: message.body,
          retryLabel: message.canRetry ? l10n.retryAction : null,
          onRetry: message.canRetry ? () => ref.invalidate(inboxTabProvider(tab)) : null,
        );
      },
      data: (data) => RefreshIndicator(
        onRefresh: () async {
          await ref.read(inboxTabProvider(tab).notifier).reload();
          await ref.read(inboxCountsProvider.notifier).reload();
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
          children: [
            if (data.entries.isEmpty)
              JawwidEmptyView(icon: Icons.notifications_none, title: l10n.notificationsEmpty)
            else ...[
              if (data.entries.any((e) => !e.read))
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: TextButton(
                    key: const ValueKey('notifications-mark-all-read'),
                    onPressed: () => ref.read(inboxTabProvider(tab).notifier).markAllRead(),
                    child: Text(l10n.notificationsMarkAllRead),
                  ),
                ),
              for (final entry in data.entries) _EntryTile(tab: tab, entry: entry),
              if (data.next != null)
                Center(
                  child: data.loadingMore
                      ? const Padding(
                          padding: EdgeInsets.all(Spacing.spacing4),
                          child: CircularProgressIndicator(),
                        )
                      : TextButton(
                          key: const ValueKey('notifications-load-older'),
                          onPressed: () => ref.read(inboxTabProvider(tab).notifier).loadMore(),
                          child: Text(l10n.notificationsLoadOlder),
                        ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EntryTile extends ConsumerWidget {
  const _EntryTile({required this.tab, required this.entry});

  final InboxTab tab;
  final InboxEntry entry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final now = ref.watch(notificationsClockProvider)();
    final locale = Localizations.localeOf(context).toLanguageTag();
    final sameDay = entry.at.year == now.year && entry.at.month == now.month && entry.at.day == now.day;
    final when = sameDay ? DateFormat.Hm(locale).format(entry.at) : DateFormat.MMMd(locale).format(entry.at);
    final action = entry.action;
    final route = action == null ? null : routeFor(action, ref.read(currentRoleProvider));

    return ListTile(
      key: ValueKey('notification-${entry.id}'),
      leading: CircleAvatar(
        backgroundColor: tokens.colorSurfaceMuted,
        child: Icon(_icon(entry.category), color: tokens.colorTextSecondary),
      ),
      title: Text(
        entry.title,
        style: TextStyle(fontWeight: entry.read ? FontWeight.w400 : FontWeight.w700),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(entry.body),
          if (route != null)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                key: ValueKey('notification-action-${entry.id}'),
                style: TextButton.styleFrom(padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
                onPressed: () => _open(context, ref, route),
                child: Text(_actionLabel(l10n, action!.kind)),
              ),
            ),
        ],
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(when, style: TextStyle(color: tokens.colorTextSecondary, fontSize: 12)),
          if (!entry.read) ...[
            const SizedBox(height: Spacing.spacing1),
            Icon(Icons.circle, size: 10, color: tokens.colorBrandPrimary),
          ],
        ],
      ),
      onTap: route == null ? null : () => _open(context, ref, route),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref, String route) async {
    final router = GoRouter.of(context);
    try {
      await ref.read(inboxTabProvider(tab).notifier).acted(entry);
    } catch (_) {
      // Recording the tap is a courtesy; opening the screen is what was asked for.
    }
    unawaited(router.push(route));
  }

  static IconData _icon(String category) => switch (category) {
        'lesson' => Icons.event_outlined,
        'payment' => Icons.payments_outlined,
        'conversation' => Icons.chat_bubble_outline,
        'call' => Icons.call_missed,
        'task' => Icons.assignment_outlined,
        'announcement' => Icons.campaign_outlined,
        _ => Icons.notifications_outlined,
      };

  static String _actionLabel(L10n l10n, InboxActionKind kind) => switch (kind) {
        InboxActionKind.openConversation => l10n.notificationsActionOpenConversation,
        InboxActionKind.viewLesson => l10n.notificationsActionViewLesson,
        InboxActionKind.viewPayments => l10n.notificationsActionViewPayments,
        InboxActionKind.openStories => l10n.notificationsActionOpenStories,
        InboxActionKind.openCalls => l10n.notificationsActionOpenCalls,
      };
}

/// Where an entry's button goes, for this role. Null when this role has no such screen --
/// the entry is then shown without a button rather than with one that leads nowhere.
String? routeFor(InboxAction action, UserRole? role) => switch (action.kind) {
      InboxActionKind.openConversation =>
        action.conversationId == null ? null : Routes.conversation(action.conversationId!),
      InboxActionKind.viewLesson => role == UserRole.teacher
          ? Routes.schedule
          : action.learnerId == null
              ? null
              : Routes.childSchedule(action.learnerId!),
      InboxActionKind.viewPayments => switch (role) {
          UserRole.parent => Routes.myPayments,
          UserRole.sales => Routes.salesPayments,
          _ => null,
        },
      InboxActionKind.openStories => Routes.chats,
      InboxActionKind.openCalls => Routes.calls,
    };
