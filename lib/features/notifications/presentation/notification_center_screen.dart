import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/notification.dart';
import '../../conversations/application/conversations_controller.dart' show asAppError;
import '../application/notifications_controller.dart';
import '../domain/notification_deeplink.dart';
import 'notification_card.dart';

/// The notification centre.
///
/// One list, filtered by chips — the same shape the chat list already uses, so
/// a parent who has learned one screen has learned this one. There is no
/// dashboard and no configuration surface here: settings live behind one link
/// at the end of the filter row.
class NotificationCenterScreen extends ConsumerStatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  ConsumerState<NotificationCenterScreen> createState() =>
      _NotificationCenterScreenState();
}

class _NotificationCenterScreenState
    extends ConsumerState<NotificationCenterScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// Load the next page while there is still a screenful to scroll through, so
  /// the list never visibly stops. The controller guards against re-entry, so
  /// firing this on every scroll frame is safe.
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - 400) {
      ref.read(notificationsControllerProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final feed = ref.watch(notificationsControllerProvider);
    final counts = ref.watch(unreadCountsProvider).value ?? UnreadCounts.empty;
    final filter = ref.watch(notificationFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.notificationsTitle),
        actions: [
          if (counts.total > 0)
            TextButton(
              onPressed: () => unawaited(_markAllRead(context)),
              child: Text(l10n.notificationsMarkAllRead),
            ),
          IconButton(
            icon: const Icon(Icons.tune),
            tooltip: l10n.notificationPreferencesTitle,
            onPressed: () => context.push('/settings/notifications'),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: _FilterBar(filter: filter, counts: counts),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(notificationsControllerProvider.notifier).refresh(),
        child: feed.when(
          loading: () => const _Skeleton(),
          error: (error, _) {
            final presented = ErrorPresenter.present(asAppError(error), l10n);
            return JawwidErrorView(
              title: presented.title,
              body: presented.body,
              retryLabel: l10n.retryAction,
              onRetry: () =>
                  ref.read(notificationsControllerProvider.notifier).refresh(),
            );
          },
          data: (data) {
            if (data.items.isEmpty) {
              return ListView(
                // Must scroll, or RefreshIndicator cannot be pulled on an empty
                // list -- which is exactly when a parent wants to try again.
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
                  JawwidEmptyView(
                    icon: Icons.notifications_none,
                    title: filter.unreadOnly
                        ? l10n.notificationsAllCaughtUp
                        : l10n.notificationsEmptyTitle,
                    body: filter.unreadOnly ? null : l10n.notificationsEmptyBody,
                  ),
                ],
              );
            }

            return ListView.separated(
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: data.items.length + (data.hasMore ? 1 : 0),
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                if (index >= data.items.length) {
                  return const Padding(
                    padding: EdgeInsets.all(Spacing.spacing7),
                    child: Center(
                      child: SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  );
                }
                final notification = data.items[index];
                return NotificationCard(
                  notification: notification,
                  onTap: () => _open(context, notification),
                );
              },
            );
          },
        ),
      ),
    );
  }

  /// Tapping a notification does three things, in this order: mark it read,
  /// tell the server it was acted on, and navigate.
  ///
  /// Navigation is last and unconditional. A failed read or a failed report
  /// must never swallow the tap — the parent asked to go somewhere.
  Future<void> _open(BuildContext context, AppNotification notification) async {
    final route = NotificationDeepLink.resolve(notification);
    final controller = ref.read(notificationsControllerProvider.notifier);

    // Both are fire-and-forget on purpose: the controller already rolls its own
    // optimistic state back on failure, and neither a failed read nor a failed
    // open-report may swallow the tap. The parent asked to go somewhere.
    unawaited(
      controller.markRead(notification.id).catchError((Object _) {}),
    );
    unawaited(controller.reportOpened(notification.id));

    // push() completes when the pushed screen pops; nothing here waits on that.
    if (route != null && context.mounted) unawaited(context.push<void>(route));
  }

  Future<void> _markAllRead(BuildContext context) async {
    try {
      await ref.read(notificationsControllerProvider.notifier).markAllRead();
    } catch (error) {
      if (!context.mounted) return;
      final presented = ErrorPresenter.present(asAppError(error), L10n.of(context));
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(presented.title)));
    }
  }
}

/// The category chips.
///
/// Only the categories this product actually produces are offered. Approvals
/// and Account are absent: a parent never sees an approval notification, and an
/// empty tab is a dead end that teaches people the filters are unreliable.
class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.filter, required this.counts});

  final NotificationFilter filter;
  final UnreadCounts counts;

  static const _categories = <NotificationCategory?>[
    null,
    NotificationCategory.messaging,
    NotificationCategory.classes,
    NotificationCategory.calls,
    NotificationCategory.academy,
    NotificationCategory.billing,
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);

    String label(NotificationCategory? category) => switch (category) {
          null => l10n.notificationFilterAll,
          NotificationCategory.messaging => l10n.notificationFilterMessages,
          NotificationCategory.classes => l10n.notificationFilterClasses,
          NotificationCategory.calls => l10n.notificationFilterCalls,
          NotificationCategory.academy => l10n.notificationFilterAcademy,
          NotificationCategory.billing => l10n.notificationFilterPayments,
          _ => l10n.notificationFilterAll,
        };

    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
        children: [
          // Unread first: it is the one filter a parent reaches for by reflex.
          Padding(
            padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
            child: FilterChip(
              label: Text(l10n.notificationFilterUnread),
              selected: filter.unreadOnly,
              onSelected: (selected) => ref
                  .read(notificationFilterProvider.notifier)
                  .setUnreadOnly(selected),
            ),
          ),
          for (final category in _categories)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
              child: FilterChip(
                label: Text(label(category)),
                selected: filter.category == category,
                // A count per chip, so a parent can see where the unread ones
                // are without opening each tab.
                avatar: counts.forCategory(category) > 0
                    ? CircleAvatar(
                        radius: 9,
                        child: Text(
                          '${counts.forCategory(category)}',
                          style: const TextStyle(fontSize: 10),
                        ),
                      )
                    : null,
                onSelected: (_) => ref
                    .read(notificationFilterProvider.notifier)
                    .setCategory(category),
              ),
            ),
        ],
      ),
    );
  }
}

/// Skeleton rows rather than a spinner: the list's shape is already known, and
/// showing it makes the load feel like the screen filling in rather than the
/// app hanging.
class _Skeleton extends StatelessWidget {
  const _Skeleton();

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return ListView.separated(
      itemCount: 6,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, _) => Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing5,
          vertical: Spacing.spacing4,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: Sizes.avatarMd,
              height: Sizes.avatarMd,
              decoration: BoxDecoration(
                color: tokens.colorSurfaceMuted,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: Spacing.spacing4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Bar(width: 140, color: tokens.colorSurfaceMuted),
                  const SizedBox(height: Spacing.spacing3),
                  _Bar(width: double.infinity, color: tokens.colorSurfaceMuted),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.width, required this.color});

  final double width;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: width,
        height: 10,
        decoration: BoxDecoration(
          color: color,
          borderRadius: const BorderRadius.all(Radii.radiusSm),
        ),
      );
}
