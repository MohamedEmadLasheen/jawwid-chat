import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/tokens.dart';
import '../../features/conversations/application/conversations_controller.dart';
import '../../features/settings/presentation/lesson_audio_notice_gate.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/models/user_role.dart';

/// One destination in a bottom tab bar.
class ShellDestination {
  const ShellDestination({
    required this.route,
    required this.icon,
    required this.selectedIcon,
    required this.label,
  });

  final String route;
  final IconData icon;
  final IconData selectedIcon;

  /// Resolved at render time from [L10n] — never a stored string (§46).
  final String Function(L10n) label;
}

/// **Chats · Calls · Settings**, for every role (plus Schedule for a teacher, Payments
/// for Sales, Subscriptions for a parent).
///
/// The shells used to differ (`decisions.md` DD-08): a parent got Home · Jawwid · Groups ·
/// Settings and a teacher got Home · Groups · Settings, on the reasoning that a parent's
/// centre of gravity is "my children" and a teacher's is "my groups".
///
/// That reasoning holds — and it is satisfied *inside* Chats, by the order the list is
/// already built in, not by giving the two roles different maps of the app. What the split
/// actually produced was three destinations that all led to conversations, so "where is my
/// child's group?" had three plausible answers: Home, Jawwid, or Groups. One list, filtered,
/// answers it once. Groups is now a filter chip; the Jawwid thread is the first row.
abstract final class Shells {
  static const chats = ShellDestination(
    route: '/chats',
    icon: Icons.chat_bubble_outline,
    selectedIcon: Icons.chat_bubble,
    label: _chatsLabel,
  );

  static const destinations = <ShellDestination>[
    chats,
    ShellDestination(
      route: '/calls',
      icon: Icons.phone_outlined,
      selectedIcon: Icons.phone,
      label: _callsLabel,
    ),
    ShellDestination(
      route: '/settings',
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
      label: _settingsLabel,
    ),
  ];

  /// PD-9/PD-10 (2026-10-18): a teacher's own Schedule -- the one surface the Teacher
  /// Account freeze reopened. Second, beside Chats: a teacher's day is their lessons and
  /// the chats they report in.
  static const schedule = ShellDestination(
    route: '/schedule',
    icon: Icons.calendar_month_outlined,
    selectedIcon: Icons.calendar_month,
    label: _scheduleLabel,
  );

  /// PD-20 (2026-10-22): Sales' Payments -- find a family, read its instalments, record
  /// a payment. Sales only; third, before Settings.
  static const salesPayments = ShellDestination(
    route: '/payments',
    icon: Icons.receipt_long_outlined,
    selectedIcon: Icons.receipt_long,
    label: _paymentsLabel,
  );

  /// PD-30 (2026-10-26): the parent's Subscriptions -- each child's plan, lessons left,
  /// grace and lock, then the family's payments (what Settings -> Payments was). Parents
  /// only; third, before Settings.
  static const subscriptions = ShellDestination(
    route: '/subscriptions',
    icon: Icons.card_membership_outlined,
    selectedIcon: Icons.card_membership,
    label: _subscriptionsLabel,
  );

  /// The destinations for a role: a parent's add [subscriptions] before Settings; a
  /// teacher's add [schedule] after Chats; Sales' add [salesPayments] before Settings.
  /// This is where a role difference belongs, not in a widget.
  static List<ShellDestination> forRole(UserRole role) => switch (role) {
        UserRole.parent => [chats, destinations[1], subscriptions, destinations[2]],
        UserRole.teacher => [chats, schedule, ...destinations.skip(1)],
        UserRole.sales => [chats, destinations[1], salesPayments, destinations[2]],
      };

  static String _chatsLabel(L10n l10n) => l10n.tabChats;
  static String _callsLabel(L10n l10n) => l10n.callHistoryTitle;
  static String _settingsLabel(L10n l10n) => l10n.settingsTitle;
  static String _scheduleLabel(L10n l10n) => l10n.tabSchedule;
  static String _paymentsLabel(L10n l10n) => l10n.tabPayments;
  static String _subscriptionsLabel(L10n l10n) => l10n.tabSubscriptions;
}

/// The tabbed frame around every signed-in screen.
///
/// Icon **and** label are always shown, never icon-only (`design-system.md` §7.5), and the
/// bar is 56dp plus the safe-area inset.
class AppShell extends ConsumerWidget {
  const AppShell({
    super.key,
    required this.role,
    required this.currentRoute,
    required this.onDestinationSelected,
    required this.child,
  });

  final UserRole role;
  final String currentRoute;
  final void Function(String route) onDestinationSelected;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final destinations = Shells.forRole(role);

    // Real, from the loaded conversations — the same number the Unread chip shows. Zero
    // renders no badge at all rather than a "0".
    final unread = ref.watch(totalUnreadProvider);

    // An unrecognised route (a deep link into a detail screen) selects nothing rather than
    // falsely highlighting the first tab.
    final selected = destinations.indexWhere(
      (d) => currentRoute == d.route || currentRoute.startsWith('${d.route}/'),
    );

    return Scaffold(
      // PD-48: a parent acknowledges the lesson-audio notice once, at the next sign-in.
      body: role == UserRole.parent ? LessonAudioNoticeGate(child: child) : child,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: tokens.colorBorderSubtle)),
        ),
        child: NavigationBar(
          selectedIndex: selected < 0 ? 0 : selected,
          onDestinationSelected: (index) =>
              onDestinationSelected(destinations[index].route),
          destinations: [
            for (final destination in destinations)
              NavigationDestination(
                icon: _badged(destination, destination.icon, unread),
                // Badged in the selected state too: the count is about the whole list,
                // not about which tab you happen to be looking at, and a number that
                // vanishes when you tap the tab reads as a bug.
                selectedIcon:
                    _badged(destination, destination.selectedIcon, unread),
                label: destination.label(l10n),
              ),
          ],
        ),
      ),
    );
  }

  /// The unread count rides the Chats tab only, and only when it is non-zero — a badge
  /// showing "0" is noise.
  static Widget _badged(ShellDestination destination, IconData icon, int unread) {
    if (destination.route != Shells.chats.route || unread <= 0) return Icon(icon);
    return Badge.count(count: unread, child: Icon(icon));
  }
}
