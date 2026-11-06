import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/blocks_controller.dart';
import '../data/block_repository.dart';
import 'block_actions.dart';

/// PD-57: Settings -> Blocked people. The signed-in user's own blocks, each with Unblock.
class BlockedPeopleScreen extends ConsumerWidget {
  const BlockedPeopleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(blocksProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.blockedPeopleTitle)),
      body: switch (state) {
        AsyncData(:final value) when value.isEmpty => JawwidEmptyView(
          title: l10n.blockedPeopleEmptyTitle,
          body: l10n.blockedPeopleEmptyBody,
          icon: Icons.block,
        ),
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(blocksProvider);
            await ref.read(blocksProvider.future);
          },
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(vertical: Spacing.spacing3),
            itemCount: value.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (_, i) => _BlockedRow(block: value[i]),
          ),
        ),
        // Never the server's words: one calm sentence and a retry.
        AsyncError() => JawwidErrorView(
          title: l10n.blockedPeopleLoadError,
          retryLabel: l10n.retryAction,
          onRetry: () => ref.invalidate(blocksProvider),
        ),
        _ => const JawwidLoadingView(),
      },
    );
  }
}

class _BlockedRow extends StatelessWidget {
  const _BlockedRow({required this.block});

  final PersonBlock block;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final name = blockDisplayName(block.name, l10n);
    final at = block.createdAt;
    final locale = Localizations.localeOf(context).toString();

    return ListTile(
      key: ValueKey('blocked-person-${block.id}'),
      leading: JawwidAvatar(displayName: name, imageUrl: block.avatarUrl, size: Sizes.avatarMd),
      title: ContentText(name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: at == null
          ? null
          : Text(
              l10n.blockedPeopleSince(DateFormat.yMMMd(locale).format(at.toLocal())),
              style: TextStyle(color: tokens.colorTextSecondary),
            ),
      trailing: TextButton(
        key: ValueKey('blocked-unblock-${block.id}'),
        onPressed: () => confirmAndUnblock(context, block: block),
        child: Tooltip(message: '${l10n.unblockAction}: $name', child: Text(l10n.unblockAction)),
      ),
    );
  }
}
