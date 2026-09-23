import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/notification.dart';
import '../../conversations/application/conversations_controller.dart' show asAppError;

/// An academy announcement, opened from its notification.
///
/// THE DEEP LINK IS NOT THE AUTHORIZATION. This screen fetches the announcement
/// from the server, which checks that a notification for it was addressed to
/// this actor and that it is published and not expired. An old link, a shared
/// link, or a guessed id all land on the same "no longer available" state, and
/// none of them shows content.
class AnnouncementScreen extends ConsumerWidget {
  const AnnouncementScreen({super.key, required this.announcementId});

  final String announcementId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final announcement = ref.watch(announcementProvider(announcementId));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.announcementTitle)),
      body: announcement.when(
        loading: () => const JawwidLoadingView(),
        error: (error, _) {
          final presented = ErrorPresenter.present(asAppError(error), l10n);
          // Deleted, expired, or never theirs: one honest state rather than a
          // crash or a blank screen.
          return JawwidEmptyView(
            icon: Icons.campaign_outlined,
            title: presented.title,
            body: presented.body ?? l10n.announcementUnavailableBody,
          );
        },
        data: (data) => _Body(announcement: data),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.announcement});

  final Announcement announcement;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return ListView(
      padding: const EdgeInsets.all(Spacing.spacing5),
      children: [
        if (announcement.priority == 'urgent')
          JawwidBanner(
            message: l10n.announcementUrgentBanner,
            icon: Icons.priority_high,
            tone: JawwidBannerTone.error,
          )
        else if (announcement.priority == 'important')
          JawwidBanner(
            message: l10n.announcementImportantBanner,
            icon: Icons.flag_outlined,
            tone: JawwidBannerTone.warning,
          ),
        const SizedBox(height: Spacing.spacing5),
        Text(
          announcement.title,
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: Spacing.spacing4),
        Text(announcement.body, style: theme.textTheme.bodyLarge),
        if (announcement.publishedAt != null) ...[
          const SizedBox(height: Spacing.spacing7),
          Text(
            MaterialLocalizations.of(context)
                .formatFullDate(announcement.publishedAt!.toLocal()),
            style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextMuted),
          ),
        ],
      ],
    );
  }
}

/// Family-keyed so two announcements do not share a cache entry.
final announcementProvider =
    FutureProvider.family<Announcement, String>((ref, announcementId) async {
  return ref.read(notificationRepositoryProvider).announcement(announcementId);
});
