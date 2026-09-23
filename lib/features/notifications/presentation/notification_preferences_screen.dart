import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/notification.dart';
import '../../conversations/application/conversations_controller.dart' show asAppError;

/// Notification settings.
///
/// Deliberately small. A parent gets one switch per category and a sentence
/// saying what it does — not a matrix of channels, schedules and per-type
/// toggles. The product's rule is stated on the screen rather than buried:
/// **turning a category off stops the phone buzzing; the notification still
/// arrives in the app.** That sentence is why this screen is safe to give
/// people.
///
/// Categories the product treats as essential are shown LOCKED rather than
/// hidden, so a parent can see that approval and account notifications exist
/// and are not something they accidentally switched off.
class NotificationPreferencesScreen extends ConsumerWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final preferences = ref.watch(notificationPreferencesProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.notificationPreferencesTitle)),
      body: preferences.when(
        loading: () => const JawwidLoadingView(),
        error: (error, _) {
          final presented = ErrorPresenter.present(asAppError(error), l10n);
          return JawwidErrorView(
            title: presented.title,
            body: presented.body,
            retryLabel: l10n.retryAction,
            onRetry: () => ref.invalidate(notificationPreferencesProvider),
          );
        },
        data: (rows) => ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(Spacing.spacing5),
              child: Text(
                l10n.notificationPreferencesExplainer,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: JawwidTokens.of(context).colorTextSecondary,
                    ),
              ),
            ),
            for (final row in rows)
              _PreferenceRow(
                preference: row,
                onChanged: row.isOptional
                    ? (value) => _set(context, ref, row.category, value)
                    : null,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _set(
    BuildContext context,
    WidgetRef ref,
    NotificationCategory category,
    bool pushEnabled,
  ) async {
    try {
      await ref
          .read(notificationRepositoryProvider)
          .setPreference(category, pushEnabled: pushEnabled);
      ref.invalidate(notificationPreferencesProvider);
    } catch (error) {
      if (!context.mounted) return;
      final presented = ErrorPresenter.present(asAppError(error), L10n.of(context));
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(presented.title)));
      // Refetch rather than keep an optimistic value the server refused.
      ref.invalidate(notificationPreferencesProvider);
    }
  }
}

class _PreferenceRow extends StatelessWidget {
  const _PreferenceRow({required this.preference, this.onChanged});

  final NotificationPreference preference;

  /// Null for a category the product does not allow muting.
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    final (title, subtitle) = switch (preference.category) {
      NotificationCategory.messaging => (
          l10n.notificationCategoryMessages,
          l10n.notificationCategoryMessagesBody,
        ),
      NotificationCategory.calls => (
          l10n.notificationCategoryCalls,
          l10n.notificationCategoryCallsBody,
        ),
      NotificationCategory.classes => (
          l10n.notificationCategoryClasses,
          l10n.notificationCategoryClassesBody,
        ),
      NotificationCategory.academy => (
          l10n.notificationCategoryAcademy,
          l10n.notificationCategoryAcademyBody,
        ),
      NotificationCategory.billing => (
          l10n.notificationCategoryPayments,
          l10n.notificationCategoryPaymentsBody,
        ),
      NotificationCategory.approvals => (
          l10n.notificationCategoryApprovals,
          l10n.notificationCategoryAlwaysOn,
        ),
      NotificationCategory.account => (
          l10n.notificationCategoryAccount,
          l10n.notificationCategoryAlwaysOn,
        ),
      _ => (preference.category.name, ''),
    };

    return SwitchListTile.adaptive(
      title: Text(title),
      subtitle: Text(subtitle),
      value: preference.pushEnabled,
      onChanged: onChanged,
      secondary: preference.isOptional
          ? null
          // A lock, not a hidden row: "you cannot turn this off" is information,
          // "this does not exist" is a surprise later.
          : const Icon(Icons.lock_outline),
    );
  }
}

final notificationPreferencesProvider =
    FutureProvider<List<NotificationPreference>>((ref) async {
  return ref.read(notificationRepositoryProvider).preferences();
});
