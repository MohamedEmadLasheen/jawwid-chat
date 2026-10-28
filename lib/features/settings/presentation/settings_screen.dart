import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/app.dart';
import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/time/time_zone_controller.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/text_direction.dart';
import '../../app_lock/application/app_lock_controller.dart';
import '../../app_lock/data/device_security_settings.dart';
import '../../app_lock/domain/app_lock_settings.dart';
import '../../app_lock/presentation/unlock_platform.dart';
import '../../profile/presentation/profile_photos_section.dart';
import '../application/theme_mode_controller.dart';
import 'date_time_screen.dart';

/// Profile and settings.
///
/// Deliberately short. The only phone-adjacent thing here is the user's own display name —
/// no phone number for this user or anyone else appears anywhere (§5, §43).
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final user = ref.watch(authControllerProvider).user;
    final locale = ref.watch(localeOverrideProvider);
    final themeMode = ref.watch(themeModeProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.settingsTitle),
        titleTextStyle: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
      ),
      body: ListView(
        children: [
          // One identity row, and it is the thing you tap.
          //
          // This used to be two: a large avatar-and-name header that did nothing, sitting
          // directly above a "My account" row that did. Anyone who has used a messaging
          // app taps their own photo at the top of Settings first, found nothing there,
          // and had to look again — so the header *is* the entry point now, which is also
          // the arrangement people already know.
          //
          // It remains the only route to the signed-in user's own account. Someone else's
          // profile is reached contextually, by tapping their avatar or name in a chat;
          // the two never share an entry point.
          if (user != null)
            InkWell(
              onTap: () => context.push(Routes.myAccount),
              child: Semantics(
                button: true,
                label: '${user.displayName}. ${l10n.myAccountTitle}',
                child: ExcludeSemantics(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Spacing.spacing5,
                      vertical: Spacing.spacing5,
                    ),
                    child: Row(
                      children: [
                        JawwidAvatar(
                          displayName: user.displayName,
                          // The one photo, from where it is kept (`GET /me/photo`);
                          // the session's user carries none.
                          imageUrl: ref.watch(myPhotosProvider).value?.avatarUrl ?? user.avatarUrl,
                          size: Sizes.avatarLg,
                        ),
                        const SizedBox(width: Spacing.spacing4),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              ContentText(
                                user.displayName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: Spacing.spacing1),
                              Text(
                                // The role label, not an internal role id.
                                switch (user.role) {
                                  UserRole.teacher => l10n.groupMemberRoleTeacher,
                                  UserRole.sales => user.isSuperAdmin ? l10n.roleSuperAdmin : l10n.roleSales,
                                  UserRole.parent => l10n.groupMemberRoleParent,
                                },
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: tokens.colorTextSecondary),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.chevron_right,
                          color: tokens.colorTextSecondary,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          // ONE profile per account (owner 2026-10-24): the row above opens it. For a
          // teacher that is their professional profile; for a parent, their own profile
          // with each child's -- photo, name and About, one photo control each. There is
          // no second "Professional profile" or "My profile" row and no second upload.
          // PD-30: the parent's payments are no longer here -- they are the
          // Subscriptions tab, beside Settings.
          const Divider(),

          // Language and Appearance are one row each, showing the current value; the
          // options open in a sheet (owner 2026-10-24: two full radio lists took
          // half the screen for two settings nobody changes twice).
          SettingChoiceRow<String>(
            key: const ValueKey('settings-language'),
            icon: Icons.language_outlined,
            title: l10n.settingsLanguage,
            value: locale?.languageCode ?? 'system',
            options: [
              ('system', l10n.settingsLanguageSystem),
              ('ar', l10n.settingsLanguageArabic),
              ('en', l10n.settingsLanguageEnglish),
            ],
            onChanged: (value) => ref.read(localeOverrideProvider.notifier).set(
                  switch (value) {
                    'ar' => const Locale('ar'),
                    'en' => const Locale('en'),
                    _ => null,
                  },
                ),
          ),
          // "Appearance", not "Theme": Language's Auto reads "Follow device". Two
          // rows both offering "Follow device" for different things is how someone
          // changes the wrong one.
          SettingChoiceRow<ThemeMode>(
            key: const ValueKey('settings-appearance'),
            icon: Icons.contrast_outlined,
            title: l10n.settingsAppearance,
            value: themeMode,
            options: [
              (ThemeMode.system, l10n.settingsAppearanceAuto),
              (ThemeMode.light, l10n.settingsAppearanceLight),
              (ThemeMode.dark, l10n.settingsAppearanceDark),
            ],
            onChanged: (value) => ref.read(themeModeProvider.notifier).set(value),
          ),
          const Divider(),

          // PD-23: app lock -- per account, on this device. PD-28: not in a browser, which has
          // no Face ID / passcode prompt to ask (`local_auth` has no web implementation).
          if (user != null && !kIsWeb) ...[
            const _AppLockSection(),
            const Divider(),
          ],

          // PD-12: the one leave surface in the teacher app -- their own balance and requests.
          if (user?.isTeacher ?? false) ...[
            ListTile(
              key: const ValueKey('settings-my-leave'),
              leading: const Icon(Icons.beach_access_outlined),
              title: Text(l10n.myLeaveTitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push(Routes.myLeave),
            ),
            const Divider(),
          ],
          // PD-32: Starred messages moved to the Chats screen's "Starred" chip.
          // PD-22: the account's time zone, under the same name a phone uses.
          ListTile(
            key: const ValueKey('settings-date-time'),
            leading: const Icon(Icons.schedule_outlined),
            title: Text(l10n.settingsDateTime),
            subtitle: switch (ref.watch(timeZoneControllerProvider).value?.effectiveZone) {
              final zone? => Text(l10n.settingsDateTimeSubtitle(zoneDisplayName(zone, Localizations.localeOf(context).languageCode))),
              null => null,
            },
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(Routes.dateTime),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: Text(l10n.settingsNotifications),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(Routes.notificationSettings),
          ),
          // PD-23: every device this account is signed in on.
          ListTile(
            key: const ValueKey('settings-devices'),
            leading: const Icon(Icons.devices_outlined),
            title: Text(l10n.settingsDevices),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(Routes.devices),
          ),
          const Divider(),

          ListTile(
            leading: Icon(Icons.logout, color: tokens.colorStatusDangerFg),
            title: Text(
              l10n.signOutAction,
              style: TextStyle(color: tokens.colorStatusDangerFg),
            ),
            onTap: () => _confirmSignOut(context, ref, l10n),
          ),
          const SizedBox(height: Spacing.spacing8),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l10n.signOutConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancelAction),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.signOutAction),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await ref.read(authControllerProvider.notifier).signOut();
    }
  }
}

/// PD-23: the app lock's toggle and timeout.
///
/// Disabled, with the reason, when the device can authenticate nobody -- no biometrics and
/// no passcode -- rather than hidden: the person should learn what would make it work. On
/// Android the reason comes with a way there, "Open settings".
///
/// Asks the device again whenever it is shown: whether it can authenticate is the phone's
/// to change, not ours, and a stale answer kept the switch disabled after a screen lock
/// was added (Redmi A5 QA, 2026-10-27).
class _AppLockSection extends ConsumerStatefulWidget {
  const _AppLockSection();

  @override
  ConsumerState<_AppLockSection> createState() => _AppLockSectionState();
}

class _AppLockSectionState extends ConsumerState<_AppLockSection> {
  @override
  void initState() {
    super.initState();
    unawaited(ref.read(appLockControllerProvider.notifier).refreshAvailability());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final lock = ref.watch(appLockControllerProvider);
    final controller = ref.read(appLockControllerProvider.notifier);
    final enabled = lock.settings.enabled && lock.available;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeading(text: l10n.appLockTitle),
        SwitchListTile(
          key: const ValueKey('settings-app-lock'),
          secondary: const Icon(Icons.lock_outline),
          title: Text(l10n.appLockToggle(unlockPlatform(context))),
          subtitle: Text(lock.available ? l10n.appLockToggleSubtitle : l10n.appLockUnavailable(unlockPlatform(context))),
          value: enabled,
          onChanged: !lock.available || lock.authenticating
              ? null
              : (value) => controller.setEnabled(value, reason: l10n.appLockReason),
        ),
        if (!lock.available && unlockPlatform(context) == 'android')
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: Padding(
              padding: const EdgeInsetsDirectional.only(end: Spacing.spacing4),
              child: TextButton.icon(
                key: const ValueKey('settings-app-lock-open-settings'),
                icon: const Icon(Icons.open_in_new),
                label: Text(l10n.appLockOpenSettings),
                // Coming back from the phone's Settings is a resume, which asks again.
                onPressed: () => ref.read(deviceSecuritySettingsProvider).open(),
              ),
            ),
          ),
        if (enabled)
          SettingChoiceRow<AppLockTimeout>(
            key: const ValueKey('settings-app-lock-timeout'),
            icon: Icons.timer_outlined,
            title: l10n.appLockTimeoutLabel,
            value: lock.settings.timeout,
            options: [
              for (final timeout in AppLockTimeout.values)
                (timeout, switch (timeout) {
                  AppLockTimeout.immediately => l10n.appLockTimeoutImmediately,
                  AppLockTimeout.oneMinute => l10n.appLockTimeoutOneMinute,
                  AppLockTimeout.fifteenMinutes => l10n.appLockTimeoutFifteenMinutes,
                  AppLockTimeout.oneHour => l10n.appLockTimeoutOneHour,
                }),
            ],
            optionKey: (timeout) => ValueKey('settings-app-lock-${timeout.wire}'),
            onChanged: controller.setTimeout,
          ),
      ],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing2,
      ),
      child: Semantics(
        header: true,
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: JawwidTokens.of(context).colorTextSecondary,
              ),
        ),
      ),
    );
  }
}

/// One setting with a few options, WhatsApp-style: a single row naming the setting
/// and its current value ("Language · Follow device"); tapping it opens the options
/// in a sheet, and choosing one closes it.
class SettingChoiceRow<T> extends StatelessWidget {
  const SettingChoiceRow({
    super.key,
    required this.icon,
    required this.title,
    required this.value,
    required this.options,
    required this.onChanged,
    this.optionKey,
  });

  final IconData icon;
  final String title;
  final T value;

  /// Each option and its label, in display order.
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  /// A key for each option's row in the sheet (tests find options by it).
  final Key Function(T value)? optionKey;

  String get _current => options.firstWhere((o) => o.$1 == value, orElse: () => options.first).$2;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(_current),
      trailing: const Icon(Icons.chevron_right),
      onTap: () async {
        final picked = await showModalBottomSheet<(T,)>(
          context: context,
          useRootNavigator: true,
          showDragHandle: true,
          builder: (sheet) => SafeArea(
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing2),
                    child: Semantics(
                      header: true,
                      child: Text(title, style: Theme.of(sheet).textTheme.titleMedium),
                    ),
                  ),
                  RadioGroup<T>(
                    groupValue: value,
                    onChanged: (v) => Navigator.of(sheet).pop((v as T,)),
                    child: Column(
                      children: [
                        for (final (option, label) in options)
                          RadioListTile<T>(key: optionKey?.call(option), value: option, title: Text(label)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
        if (picked != null && picked.$1 != value) onChanged(picked.$1);
      },
    );
  }
}
