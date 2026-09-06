import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/tokens.dart';
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

/// The parent and teacher shells are deliberately **different** (`decisions.md` DD-08): a
/// parent's centre of gravity is "my children", a teacher's is "my groups". They are not
/// unified to save a widget.
abstract final class Shells {
  /// Home · Jawwid · Groups · Settings.
  static const parent = <ShellDestination>[
    ShellDestination(
      route: '/home',
      icon: Icons.home_outlined,
      selectedIcon: Icons.home,
      label: _homeLabel,
    ),
    ShellDestination(
      route: '/chats',
      icon: Icons.chat_bubble_outline,
      selectedIcon: Icons.chat_bubble,
      label: _jawwidLabel,
    ),
    ShellDestination(
      route: '/groups',
      icon: Icons.groups_outlined,
      selectedIcon: Icons.groups,
      label: _groupsLabel,
    ),
    ShellDestination(
      route: '/settings',
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
      label: _settingsLabel,
    ),
  ];

  /// Home · Groups · Settings.
  static const teacher = <ShellDestination>[
    ShellDestination(
      route: '/home',
      icon: Icons.home_outlined,
      selectedIcon: Icons.home,
      label: _homeLabel,
    ),
    ShellDestination(
      route: '/groups',
      icon: Icons.groups_outlined,
      selectedIcon: Icons.groups,
      label: _groupsLabel,
    ),
    ShellDestination(
      route: '/settings',
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
      label: _settingsLabel,
    ),
  ];

  static List<ShellDestination> forRole(UserRole role) => switch (role) {
        UserRole.parent => parent,
        UserRole.teacher => teacher,
      };

  static String _homeLabel(L10n l10n) => l10n.tabHome;
  static String _jawwidLabel(L10n l10n) => l10n.sectionJawwid;
  static String _groupsLabel(L10n l10n) => l10n.tabGroups;
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
                icon: Icon(destination.icon),
                selectedIcon: Icon(destination.selectedIcon),
                label: destination.label(l10n),
              ),
          ],
        ),
      ),
    );
  }
}
