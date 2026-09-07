import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';

/// The reader's story feed.
///
/// Read-only, by construction rather than by convention. [UserRole] on this
/// client is `parent | teacher`, so there is no publishing surface here and no
/// repository method that could reach one -- composing and publishing a story
/// live in the operations console, which is what the roles that may publish
/// sign in to.
///
/// The feed is exactly what the server returned. There is no filtering here,
/// because there is nothing to filter: the server resolves the audience and a
/// story this reader is not in the audience of is not in the response.
class StoriesScreen extends ConsumerWidget {
  const StoriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final feed = ref.watch(storyFeedProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.storiesTitle)),
      body: feed.when(
        loading: () => const JawwidLoadingView(),
        error: (_, _) => JawwidErrorView(
          title: l10n.storiesEmpty,
          onRetry: () => ref.invalidate(storyFeedProvider),
        ),
        data: (stories) => stories.isEmpty
            ? JawwidEmptyView(
                title: l10n.storiesEmpty,
                icon: Icons.auto_awesome_outlined,
              )
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(storyFeedProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(Spacing.spacing4),
                  itemCount: stories.length,
                  itemBuilder: (context, index) => _StoryCard(
                    story: stories[index],
                    // Marking viewed is idempotent server-side, so a rebuild
                    // that fires it twice costs one wasted request and changes
                    // nothing.
                    onSeen: () => ref
                        .read(storyRepositoryProvider)
                        .markViewed(stories[index].id),
                  ),
                ),
              ),
      ),
    );
  }
}

class _StoryCard extends StatefulWidget {
  const _StoryCard({required this.story, required this.onSeen});

  final Story story;
  final Future<void> Function() onSeen;

  @override
  State<_StoryCard> createState() => _StoryCardState();
}

class _StoryCardState extends State<_StoryCard> {
  @override
  void initState() {
    super.initState();
    // A view is recorded when the card is built, and failures are swallowed:
    // a view is telemetry, and a parent must never see an error because we
    // could not record that they read something.
    if (!widget.story.viewed) {
      widget.onSeen().catchError((_) {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = L10n.of(context);
    final story = widget.story;

    return Card(
      margin: const EdgeInsets.only(bottom: Spacing.spacing4),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.storyFrom, style: theme.textTheme.labelSmall),
            if (story.title != null) ...[
              const SizedBox(height: Spacing.spacing2),
              Text(story.title!, style: theme.textTheme.titleMedium),
            ],
            if (story.mediaUrl != null) ...[
              const SizedBox(height: Spacing.spacing3),
              ClipRRect(
                borderRadius: Radii.card,
                child: Image.network(
                  story.mediaUrl!,
                  // The URL is signed and short-lived. An expired one is a
                  // normal outcome, not an error worth alarming anybody with.
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            ],
            if (story.body != null) ...[
              const SizedBox(height: Spacing.spacing3),
              Text(story.body!, style: theme.textTheme.bodyMedium),
            ],
          ],
        ),
      ),
    );
  }
}
