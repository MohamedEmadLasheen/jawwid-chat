import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app.dart';
import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

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

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: [
          if (user != null)
            Padding(
              padding: const EdgeInsets.all(Spacing.spacing5),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user.displayName,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: Spacing.spacing1),
                        Text(
                          // The role label, not an internal role id.
                          user.isTeacher
                              ? l10n.groupMemberRoleTeacher
                              : l10n.groupMemberRoleParent,
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: tokens.colorTextSecondary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          const Divider(),

          _SectionHeading(text: l10n.settingsLanguage),
          RadioGroup<String>(
            groupValue: locale?.languageCode ?? 'system',
            onChanged: (value) => ref.read(localeOverrideProvider.notifier).set(
                  switch (value) {
                    'ar' => const Locale('ar'),
                    'en' => const Locale('en'),
                    _ => null,
                  },
                ),
            child: Column(
              children: [
                RadioListTile<String>(
                  value: 'system',
                  title: Text(l10n.settingsLanguageSystem),
                ),
                RadioListTile<String>(
                  value: 'ar',
                  title: Text(l10n.settingsLanguageArabic),
                ),
                RadioListTile<String>(
                  value: 'en',
                  title: Text(l10n.settingsLanguageEnglish),
                ),
              ],
            ),
          ),
          const Divider(),

          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: Text(l10n.settingsNotifications),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.devices_outlined),
            title: Text(l10n.settingsDevices),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
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
