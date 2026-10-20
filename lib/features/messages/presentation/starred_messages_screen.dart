import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../data/message_marks_repository.dart';

/// The first page of the viewer's starred messages; session-scoped.
final starredFirstPageProvider = FutureProvider.autoDispose<StarredPage>((ref) async {
  ref.watch(principalIdProvider);
  return ref.watch(messageMarksRepositoryProvider).starred();
});

/// "Starred messages": the viewer's own bookmarks, newest first, across every
/// conversation they may still read (the server drops the rest). Tapping one
/// opens its conversation.
class StarredMessagesScreen extends ConsumerStatefulWidget {
  const StarredMessagesScreen({super.key});

  @override
  ConsumerState<StarredMessagesScreen> createState() => _StarredMessagesScreenState();
}

class _StarredMessagesScreenState extends ConsumerState<StarredMessagesScreen> {
  final List<StarredMessage> _more = [];
  String? _cursor;
  bool _loadingMore = false;

  Future<void> _loadMore(String before) async {
    setState(() => _loadingMore = true);
    try {
      final page = await ref.read(messageMarksRepositoryProvider).starred(before: before);
      if (!mounted) return;
      setState(() {
        _more.addAll(page.items);
        _cursor = page.nextBefore ?? '';
      });
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final first = ref.watch(starredFirstPageProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.starredMessagesTitle)),
      body: switch (first) {
        AsyncLoading() => const JawwidLoadingView(),
        AsyncError() => JawwidEmptyView(
            title: l10n.starredMessagesTitle,
            body: l10n.starredMessagesEmpty,
            icon: Icons.star_border,
          ),
        AsyncData(:final value) => () {
            final items = [...value.items, ..._more];
            final next = _cursor == null ? value.nextBefore : (_cursor!.isEmpty ? null : _cursor);
            if (items.isEmpty) {
              return JawwidEmptyView(
                title: l10n.starredMessagesTitle,
                body: l10n.starredMessagesEmpty,
                icon: Icons.star_border,
              );
            }
            return ListView.separated(
              itemCount: items.length + (next != null ? 1 : 0),
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, i) {
                if (i == items.length) {
                  return Padding(
                    padding: const EdgeInsets.all(Spacing.spacing4),
                    child: Center(
                      child: _loadingMore
                          ? const CircularProgressIndicator(strokeWidth: 2)
                          : TextButton(
                              onPressed: () => _loadMore(next!),
                              child: Text(MaterialLocalizations.of(context).moreButtonTooltip),
                            ),
                    ),
                  );
                }
                return _StarredTile(item: items[i]);
              },
            );
          }(),
      },
    );
  }
}

class _StarredTile extends StatelessWidget {
  const _StarredTile({required this.item});

  final StarredMessage item;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final m = item.message;
    final author = m.authorName.isNotEmpty ? m.authorName : l10n.groupMemberUnresolved;

    return ListTile(
      onTap: () => context.push(Routes.conversation(item.conversationId)),
      leading: JawwidAvatar(displayName: author, imageUrl: m.authorAvatarUrl, size: Sizes.avatarSm),
      title: Row(
        children: [
          Expanded(child: ContentText(author, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall)),
          Text(RelativeTime.forBubble(m.createdAt, locale: locale), style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
        ],
      ),
      subtitle: ContentText(
        _preview(m, l10n),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextSecondary),
      ),
      trailing: Icon(Icons.star, size: 16, color: tokens.colorTextSecondary),
    );
  }

  static String _preview(Message message, L10n l10n) {
    final body = message.body.trim();
    if (body.isNotEmpty) return body;
    return switch (message.attachments.firstOrNull?.kind ?? message.kind) {
      MessageKind.image => l10n.attachmentPhotoLabel,
      MessageKind.voice => l10n.attachmentVoiceLabel,
      _ => l10n.attachmentFileLabel,
    };
  }
}
