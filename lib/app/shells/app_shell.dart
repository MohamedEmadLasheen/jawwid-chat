import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/tokens.dart';
import '../../features/conversations/application/conversations_controller.dart';
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

/// **Chats · Calls · Settings**, for both roles.
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

  /// Kept as a function because the shell is still handed a role: if a destination ever has
  /// to differ again, this is where it belongs rather than in a widget.
  static List<ShellDestination> forRole(UserRole role) => destinations;

  static String _chatsLabel(L10n l10n) => l10n.tabChats;
  static String _callsLabel(L10n l10n) => l10n.callHistoryTitle;
  static String _settingsLabel(L10n l10n) => l10n.settingsTitle;
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
      body: child,
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
