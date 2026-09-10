import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/app.dart';
import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';

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
                          imageUrl: user.avatarUrl,
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
                                user.isTeacher
                                    ? l10n.groupMemberRoleTeacher
                                    : l10n.groupMemberRoleParent,
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
