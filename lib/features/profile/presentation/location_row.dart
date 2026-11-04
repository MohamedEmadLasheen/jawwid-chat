import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/location/location.dart';
import '../../../shared/location/location_form.dart';
import '../../../shared/location/location_repository.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/text_direction.dart';

/// PD-45 PR-4 (plan 5.4): the parent's "Location" row -- read, and edit through the
/// searchable picker. Parents only: it is absent for any other role, and in a build with
/// no API. A failed read shows nothing rather than an error on a profile that is
/// otherwise fine.
class ProfileLocationRow extends ConsumerWidget {
  const ProfileLocationRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(currentRoleProvider) != UserRole.parent) return const SizedBox.shrink();
    final repo = ref.watch(locationRepositoryProvider);
    if (repo == null) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';

    return ref.watch(myLocationProvider).maybeWhen(
          data: (mine) {
            final text = mine.name?.of(arabic);
            return Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing4),
              child: Row(
                key: const ValueKey('profile-location-row'),
                children: [
                  const Icon(Icons.place_outlined),
                  const SizedBox(width: Spacing.spacing3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.locationRowTitle, style: theme.textTheme.labelMedium),
                        text == null
                            ? Text(
                                l10n.locationRowEmpty,
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                  fontStyle: FontStyle.italic,
                                ),
                              )
                            : ContentText(text, style: theme.textTheme.bodyMedium),
                      ],
                    ),
                  ),
                  TextButton(
                    key: const ValueKey('profile-location-edit'),
                    onPressed: () async {
                      final saved = await showLocationSheet(context, repo, mine);
                      if (saved != null) ref.invalidate(myLocationProvider);
                    },
                    child: Text(l10n.profileEdit),
                  ),
                ],
              ),
            );
          },
          orElse: () => const SizedBox.shrink(),
        );
  }
}

/// The picker in a bottom sheet (a dialog on a wide screen). Returns the saved location, or
/// null when closed without saving.
Future<MyLocation?> showLocationSheet(BuildContext context, LocationRepository repo, MyLocation current) {
  final l10n = L10n.of(context);
  Widget body(BuildContext ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
          Spacing.spacing5,
          Spacing.spacing4,
          Spacing.spacing5,
          Spacing.spacing5 + MediaQuery.viewInsetsOf(ctx).bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l10n.locationRowTitle, style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: Spacing.spacing4),
              LocationForm(
                repository: repo,
                initialCountryCode: current.countryCode,
                initialSubdivisionCode: current.subdivisionCode,
                secondaryLabel: l10n.profileCancel,
                onSecondary: () => Navigator.of(ctx).pop(),
                onDone: (saved) => Navigator.of(ctx).pop(saved),
              ),
            ],
          ),
        ),
      );
  if (MediaQuery.sizeOf(context).width >= 600) {
    return showDialog<MyLocation>(
      context: context,
      builder: (ctx) => Dialog(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: body(ctx))),
    );
  }
  return showModalBottomSheet<MyLocation>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: body,
  );
}
