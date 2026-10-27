import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../application/notification_center_controller.dart';
import '../domain/inbox.dart';

/// PD-34: Settings → Notifications. Quiet hours (in this account's own zone), names on
/// the lock screen, and which kinds push. An operational kind (lessons, payments, calls)
/// is shown always on: it cannot be switched off, and saying so beats a switch that
/// silently refuses.
class NotificationSettingsScreen extends ConsumerWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(notificationSettingsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsNotifications)),
      body: state.when(
        loading: () => const JawwidLoadingView(),
        error: (error, _) {
          final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
          return JawwidErrorView(
            title: message.title,
            body: message.body,
            retryLabel: message.canRetry ? l10n.retryAction : null,
            onRetry: message.canRetry ? () => ref.invalidate(notificationSettingsProvider) : null,
          );
        },
        data: (settings) => _SettingsList(settings: settings),
      ),
    );
  }
}

class _SettingsList extends ConsumerWidget {
  const _SettingsList({required this.settings});

  final NotificationSettings settings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final role = ref.watch(currentRoleProvider);
    final controller = ref.read(notificationSettingsProvider.notifier);

    Future<void> apply(Future<void> Function() change) async {
      final messenger = ScaffoldMessenger.maybeOf(context);
      try {
        await change();
      } catch (error) {
        final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
        messenger
          ?..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message.title)));
      }
    }

    Future<void> pickTime({required bool start}) async {
      final minute = start ? settings.quietStartMinute : settings.quietEndMinute;
      final picked = await showTimePicker(
        context: context,
        initialTime: TimeOfDay(hour: minute ~/ 60, minute: minute % 60),
      );
      if (picked == null) return;
      final value = picked.hour * 60 + picked.minute;
      await apply(() => controller.change(
            quietEnabled: true,
            quietStartMinute: start ? value : settings.quietStartMinute,
            quietEndMinute: start ? settings.quietEndMinute : value,
          ));
    }

    String clock(int minute) =>
        MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay(hour: minute ~/ 60, minute: minute % 60));

    return ListView(
      padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
      children: [
        SwitchListTile(
          key: const ValueKey('notification-settings-quiet'),
          title: Text(l10n.notificationSettingsQuietHours),
          subtitle: Text(l10n.notificationSettingsQuietHoursBody),
          value: settings.quietEnabled,
          onChanged: (on) => apply(() => controller.change(
                quietEnabled: on,
                quietStartMinute: settings.quietStartMinute,
                quietEndMinute: settings.quietEndMinute,
              )),
        ),
        if (settings.quietEnabled) ...[
          ListTile(
            key: const ValueKey('notification-settings-quiet-from'),
            title: Text(l10n.notificationSettingsFrom),
            trailing: Text(clock(settings.quietStartMinute)),
            onTap: () => pickTime(start: true),
          ),
          ListTile(
            key: const ValueKey('notification-settings-quiet-until'),
            title: Text(l10n.notificationSettingsUntil),
            trailing: Text(clock(settings.quietEndMinute)),
            onTap: () => pickTime(start: false),
          ),
        ],
        if (!settings.quietIsDefault)
          ListTile(
            key: const ValueKey('notification-settings-quiet-default'),
            title: Text(l10n.notificationSettingsUseDefault, style: TextStyle(color: tokens.colorTextLink)),
            onTap: () => apply(() => controller.change(resetQuietHours: true)),
          ),
        const Divider(),
        SwitchListTile(
          key: const ValueKey('notification-settings-names'),
          title: Text(l10n.notificationSettingsShowNames),
          subtitle: Text(
            role == UserRole.teacher ? l10n.notificationSettingsShowNamesTeacherBody : l10n.notificationSettingsShowNamesBody,
          ),
          value: settings.showPreviews,
          onChanged: (on) => apply(() => controller.change(showPreviews: on)),
        ),
        const Divider(),
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, 0),
          child: Text(l10n.notificationSettingsCategories, style: Theme.of(context).textTheme.titleSmall),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, 0),
          child: Text(l10n.notificationSettingsCategoriesBody, style: TextStyle(color: tokens.colorTextSecondary)),
        ),
        for (final c in settings.categories)
          SwitchListTile(
            key: ValueKey('notification-settings-category-${c.category}'),
            title: Text(_categoryName(l10n, c.category)),
            subtitle: c.locked ? Text(l10n.notificationSettingsLocked) : null,
            value: c.locked || c.push,
            onChanged: c.locked ? null : (on) => apply(() => controller.change(categories: {c.category: on})),
          ),
      ],
    );
  }

  static String _categoryName(L10n l10n, String category) => switch (category) {
        'lesson' => l10n.notificationsTabLessons,
        'payment' => l10n.notificationsTabPayments,
        'conversation' => l10n.notificationCategoryMessages,
        'call' => l10n.notificationCategoryCalls,
        'task' => l10n.notificationCategoryTasks,
        'announcement' => l10n.notificationCategoryAnnouncements,
        _ => l10n.notificationCategorySystem,
      };
}
