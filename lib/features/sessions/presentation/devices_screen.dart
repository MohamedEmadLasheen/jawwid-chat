import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/account_sessions_controller.dart';
import '../domain/account_session.dart';

/// The clock "Last active …" is measured against. Overridden in tests.
final devicesClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// PD-23: Settings → Devices & sessions.
///
/// Every device this account is signed in on, this one first. Any other device can be
/// signed out from here, one at a time or all at once; each asks first, because the person
/// holding that device will need the password to come back.
class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(accountSessionsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsDevices)),
      body: state.when(
        loading: () => const JawwidLoadingView(),
        error: (error, _) {
          final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
          return JawwidErrorView(
            title: message.title,
            body: message.body,
            retryLabel: message.canRetry ? l10n.retryAction : null,
            onRetry: message.canRetry ? () => ref.invalidate(accountSessionsProvider) : null,
          );
        },
        data: (sessions) => RefreshIndicator(
          onRefresh: () => _reload(context, ref),
          child: _SessionList(sessions: sessions),
        ),
      ),
    );
  }

  static Future<void> _reload(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await ref.read(accountSessionsProvider.notifier).reload();
    } catch (error) {
      final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
      messenger
        ?..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(message.title)));
    }
  }
}

class _SessionList extends ConsumerWidget {
  const _SessionList({required this.sessions});

  final List<AccountSession> sessions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final now = ref.watch(devicesClockProvider)();
    final hasOthers = sessions.any((s) => !s.current);

    return ListView(
      // Always scrollable, so a one-row list can still be pulled to refresh.
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
      children: [
        if (sessions.isEmpty)
          JawwidEmptyView(icon: Icons.devices_outlined, title: l10n.devicesEmpty)
        else
          for (final session in sessions) _SessionTile(session: session, now: now),
        if (hasOthers && sessions.length > 1) ...[
          const Divider(),
          ListTile(
            key: const ValueKey('devices-sign-out-others'),
            leading: Icon(Icons.logout, color: JawwidTokens.of(context).colorStatusDangerFg),
            title: Text(
              l10n.devicesSignOutAllOthers,
              style: TextStyle(color: JawwidTokens.of(context).colorStatusDangerFg),
            ),
            onTap: () => _signOutOthers(context, ref),
          ),
        ],
      ],
    );
  }

  Future<void> _signOutOthers(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final confirmed = await _confirm(
      context,
      title: l10n.devicesSignOutAllOthers,
      body: l10n.devicesSignOutAllOthersConfirm,
      action: l10n.devicesSignOutAllOthers,
    );
    if (!confirmed) return;

    String text;
    try {
      final count = await ref.read(accountSessionsProvider.notifier).revokeOthers();
      text = l10n.devicesSignedOutOthers(count);
    } catch (error) {
      text = ErrorPresenter.present(asAppErrorOf(error), l10n).title;
    }
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }
}

class _SessionTile extends ConsumerWidget {
  const _SessionTile({required this.session, required this.now});

  final AccountSession session;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final name = deviceLabel(session, l10n);
    final seen = session.lastSeenAt;

    return ListTile(
      key: ValueKey('session-${session.id}'),
      leading: Icon(platformIcon(session.platform)),
      title: Row(
        children: [
          // The device's own name is user data: its direction is its own, not the UI's.
          Flexible(
            child: ContentText(name, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          if (session.current) ...[
            const SizedBox(width: Spacing.spacing2),
            Container(
              key: const ValueKey('session-this-device'),
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.spacing2,
                vertical: 2,
              ),
              decoration: BoxDecoration(
                color: tokens.colorBrandSubtle,
                borderRadius: Radii.control,
              ),
              child: Text(
                l10n.devicesThisDevice,
                style: theme.textTheme.labelSmall?.copyWith(color: tokens.colorTextPrimary),
              ),
            ),
          ],
        ],
      ),
      subtitle: Text(
        [
          l10n.devicesSignedIn(DateFormat.yMMMd(locale).format(session.signedInAt)),
          if (seen != null)
            l10n.devicesLastActive(lastActiveText(seen, now, l10n, locale))
          else
            l10n.devicesNeverUsed,
        ].join('\n'),
        style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
      ),
      isThreeLine: true,
      trailing: session.current
          ? null
          : TextButton(
              key: ValueKey('session-sign-out-${session.id}'),
              onPressed: () => _signOut(context, ref, name),
              child: Text(l10n.signOutAction),
            ),
    );
  }

  Future<void> _signOut(BuildContext context, WidgetRef ref, String name) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final confirmed = await _confirm(
      context,
      title: l10n.devicesSignOutConfirmTitle(name),
      body: l10n.devicesSignOutConfirmBody,
      action: l10n.devicesSignOutOther,
    );
    if (!confirmed) return;

    final controller = ref.read(accountSessionsProvider.notifier);
    String text;
    try {
      await controller.revoke(session);
      text = l10n.devicesSignedOutOne;
    } catch (error) {
      final appError = asAppErrorOf(error);
      if (appError.kind == AppErrorKind.notFound) {
        // Already gone (signed out elsewhere, or expired): show the list as it now is.
        text = l10n.devicesSignOutFailed;
        try {
          await controller.reload();
        } catch (_) {}
      } else {
        text = ErrorPresenter.present(appError, l10n).title;
      }
    }
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }
}

Future<bool> _confirm(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
}) async {
  final l10n = L10n.of(context);
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.cancelAction),
        ),
        TextButton(
          key: const ValueKey('devices-confirm'),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(action),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

/// The device's own name, or what kind of device it is when it never said.
///
/// iOS reports a model code (`iPhone18,1`) rather than a name a person recognises; that is
/// shown as its family (`iPhone`). Every other name is shown as the device gave it.
String deviceLabel(AccountSession session, L10n l10n) =>
    _readableDeviceName(session.deviceName) ??
    switch (session.platform) {
      SessionPlatform.ios => l10n.devicesPlatformIphone,
      SessionPlatform.android => l10n.devicesPlatformAndroid,
      SessionPlatform.web => l10n.devicesPlatformWeb,
      null => l10n.devicesPlatformUnknown,
    };

final _appleModelCode = RegExp(r'^(iPhone|iPad|iPod)\d+,\d+$');

String? _readableDeviceName(String? name) {
  final trimmed = name?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  return _appleModelCode.firstMatch(trimmed)?.group(1) ?? trimmed;
}

IconData platformIcon(SessionPlatform? platform) => switch (platform) {
      SessionPlatform.ios => Icons.phone_iphone,
      SessionPlatform.android => Icons.phone_android,
      SessionPlatform.web => Icons.laptop_outlined,
      null => Icons.devices_other_outlined,
    };

/// "just now", "5 minutes ago", "3 hours ago", "2 days ago" -- then a date after a month.
String lastActiveText(DateTime when, DateTime now, L10n l10n, String locale) {
  final elapsed = now.difference(when);
  if (elapsed.inMinutes < 1) return l10n.devicesJustNow;
  if (elapsed.inHours < 1) return l10n.devicesMinutesAgo(elapsed.inMinutes);
  if (elapsed.inDays < 1) return l10n.devicesHoursAgo(elapsed.inHours);
  if (elapsed.inDays < 30) return l10n.devicesDaysAgo(elapsed.inDays);
  return DateFormat.yMMMd(locale).format(when);
}
