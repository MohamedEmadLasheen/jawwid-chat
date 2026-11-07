import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/legal/legal_links.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/user_role.dart';
import '../../profile/domain/profile_view.dart';
import '../application/blocks_controller.dart';
import '../application/direct_counterpart.dart';
import '../data/block_repository.dart';

/// PD-57 (WP-2B): every Block and Unblock surface of the app, built on one confirmation each
/// so the promise ("lessons continue, the academy is told") and the error wording cannot
/// drift between the profile, a member row, a hidden message, the composer and Settings.

/// The name to say, or "this person" when the server sent none. Never an id.
String blockDisplayName(String name, L10n l10n) => name.trim().isEmpty ? l10n.blockPersonFallbackName : name.trim();

/// A calm sentence for each refusal of the contract; anything else is the generic one.
/// The server's own message is never shown.
///
/// [supportEmail] is the build's support address (null or empty when there is none): a person
/// who cannot be blocked (the official account, a manager, the Super Admin) cannot be reported
/// either, so the sentence points to support instead.
String blockErrorText(AppError error, L10n l10n, {String? supportEmail}) => switch (error.code) {
  BlockErrors.notAllowed =>
    (supportEmail == null || supportEmail.isEmpty)
        ? l10n.blockErrorNotAllowed
        : l10n.blockErrorNotAllowedWithEmail(supportEmail),
  BlockErrors.noSharedConversation => l10n.blockErrorNoSharedConversation,
  BlockErrors.rateLimited => l10n.blockErrorRateLimited,
  BlockErrors.termsNotAccepted => l10n.blockErrorTerms,
  _ => switch (error.kind) {
    AppErrorKind.rateLimited => l10n.blockErrorRateLimited,
    _ => l10n.blockErrorGeneric,
  },
};

void _say(ScaffoldMessengerState? messenger, String text) {
  messenger
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}

/// Asks first, then blocks [subject]. Completes true once blocked (a calm SnackBar says so),
/// false when the user backed out. A refusal is answered inside the dialog.
Future<bool> confirmAndBlock(BuildContext context, {required BlockSubject subject, required String name}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final l10n = L10n.of(context);
  final done =
      await showDialog<bool>(
        context: context,
        useRootNavigator: true,
        builder: (_) => BlockConfirmDialog(subject: subject, name: name),
      ) ??
      false;
  if (done) _say(messenger, l10n.blockedSnack(blockDisplayName(name, l10n)));
  return done;
}

/// Asks first, then removes [block]. Completes true once unblocked.
Future<bool> confirmAndUnblock(BuildContext context, {required PersonBlock block, String name = ''}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final l10n = L10n.of(context);
  final said = block.name.isNotEmpty ? block.name : name;
  final done =
      await showDialog<bool>(
        context: context,
        useRootNavigator: true,
        builder: (_) => UnblockConfirmDialog(block: block, name: said),
      ) ??
      false;
  if (done) _say(messenger, l10n.unblockedSnack(blockDisplayName(said, l10n)));
  return done;
}

/// Unblock by the person (a hidden message knows its author, not the block id).
Future<bool> confirmAndUnblockPerson(
  BuildContext context,
  WidgetRef ref, {
  required String? personId,
  String name = '',
}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final l10n = L10n.of(context);
  final notifier = ref.read(blocksProvider.notifier);
  try {
    await ref.read(blocksProvider.future);
  } catch (_) {
    // Answered below: no block found means the generic, calm sentence.
  }
  var block = notifier.blockFor(personId);
  if (block == null) {
    // The list may be older than the thread: read it once more before giving up.
    ref.invalidate(blocksProvider);
    try {
      await ref.read(blocksProvider.future);
    } catch (_) {}
    block = notifier.blockFor(personId);
  }
  if (block == null) {
    _say(messenger, l10n.unblockErrorGeneric);
    return false;
  }
  if (!context.mounted) return false;
  return confirmAndUnblock(context, block: block, name: name);
}

/// The confirmation before blocking. It does the block itself, so a refusal is answered
/// here, inline, and the user can try again or cancel.
class BlockConfirmDialog extends ConsumerStatefulWidget {
  const BlockConfirmDialog({super.key, required this.subject, required this.name});

  final BlockSubject subject;
  final String name;

  @override
  ConsumerState<BlockConfirmDialog> createState() => _BlockConfirmDialogState();
}

class _BlockConfirmDialogState extends ConsumerState<BlockConfirmDialog> {
  bool _busy = false;
  String? _error;

  Future<void> _confirm() async {
    final l10n = L10n.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(blocksProvider.notifier).block(widget.subject, name: widget.name);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = blockErrorText(
          asAppErrorOf(error),
          l10n,
          supportEmail: ref.read(supportContactProvider).emailAddress,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    return AlertDialog(
      title: Text(l10n.blockConfirmTitle(blockDisplayName(widget.name, l10n))),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.blockConfirmBody, style: theme.textTheme.bodyMedium),
            const SizedBox(height: Spacing.spacing3),
            _Point(icon: Icons.school_outlined, text: l10n.blockConfirmLessons),
            const SizedBox(height: Spacing.spacing2),
            _Point(icon: Icons.support_agent_outlined, text: l10n.blockConfirmAcademy),
            if (_error != null) _InlineError(key: const ValueKey('block-error'), text: _error!, tokens: tokens),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const ValueKey('block-cancel'),
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.cancelAction),
        ),
        FilledButton(
          key: const ValueKey('block-confirm'),
          onPressed: _busy ? null : _confirm,
          child: _busy
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(l10n.blockAction),
        ),
      ],
    );
  }
}

/// The confirmation before unblocking; it unblocks itself and answers a failure inline.
class UnblockConfirmDialog extends ConsumerStatefulWidget {
  const UnblockConfirmDialog({super.key, required this.block, required this.name});

  final PersonBlock block;
  final String name;

  @override
  ConsumerState<UnblockConfirmDialog> createState() => _UnblockConfirmDialogState();
}

class _UnblockConfirmDialogState extends ConsumerState<UnblockConfirmDialog> {
  bool _busy = false;
  String? _error;

  Future<void> _confirm() async {
    final l10n = L10n.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(blocksProvider.notifier).unblock(widget.block.id);
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = l10n.unblockErrorGeneric;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    return AlertDialog(
      title: Text(l10n.unblockConfirmTitle(blockDisplayName(widget.name, l10n))),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.unblockConfirmBody),
          if (_error != null) _InlineError(key: const ValueKey('unblock-error'), text: _error!, tokens: tokens),
        ],
      ),
      actions: [
        TextButton(
          key: const ValueKey('unblock-cancel'),
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.cancelAction),
        ),
        FilledButton(
          key: const ValueKey('unblock-confirm'),
          onPressed: _busy ? null : _confirm,
          child: _busy
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(l10n.unblockAction),
        ),
      ],
    );
  }
}

class _Point extends StatelessWidget {
  const _Point({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(child: Icon(icon, size: 20, color: JawwidTokens.of(context).colorTextSecondary)),
        const SizedBox(width: Spacing.spacing3),
        Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
      ],
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({super.key, required this.text, required this.tokens});

  final String text;
  final JawwidTokens tokens;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(top: Spacing.spacing3),
        padding: const EdgeInsets.all(Spacing.spacing3),
        decoration: BoxDecoration(
          color: tokens.colorStatusInfoBg,
          borderRadius: const BorderRadius.all(Radii.radiusMd),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.info_outline, size: 20, color: tokens.colorStatusInfoFg),
            const SizedBox(width: Spacing.spacing3),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium)),
          ],
        ),
      ),
    );
  }
}

/// Whether this viewer may be offered Block for [person] in this build, and the person's
/// block when they are already blocked. Nothing is offered while the list is first loading.
({bool offer, PersonBlock? block}) _blockStateFor(WidgetRef ref, ProfilePerson person) {
  if (!ref.watch(blockRepositoryProvider).isAvailable) return (offer: false, block: null);
  final allowed = mayBlockPerson(
    person: person,
    viewerId: ref.watch(principalIdProvider),
    viewerRole: ref.watch(currentRoleProvider),
  );
  if (!allowed) return (offer: false, block: null);
  final state = ref.watch(blocksProvider);
  final blocks = state.value;
  // Unknown (the list failed): offer Block; a second block answers the existing one (200).
  if (blocks == null) return (offer: !state.isLoading, block: null);
  PersonBlock? block;
  for (final b in blocks) {
    if (b.subject.id == person.id) block = b;
  }
  return (offer: true, block: block);
}

/// "Block this person" (or "Unblock this person") on a one-to-one profile.
class BlockPersonTile extends ConsumerWidget {
  const BlockPersonTile({super.key, required this.person});

  final ProfilePerson person;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = _blockStateFor(ref, person);
    if (!s.offer) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final block = s.block;
    if (block != null) {
      return ListTile(
        key: const ValueKey('profile-unblock-person'),
        leading: const Icon(Icons.do_not_disturb_off_outlined),
        title: Text(l10n.unblockPersonAction),
        onTap: () => confirmAndUnblock(context, block: block, name: person.displayName),
      );
    }
    return ListTile(
      key: const ValueKey('profile-block-person'),
      leading: const Icon(Icons.block),
      title: Text(l10n.blockPersonAction),
      onTap: () => confirmAndBlock(
        context,
        subject: BlockSubject(kind: blockSubjectKind(person)!, id: person.id),
        name: person.displayName,
      ),
    );
  }
}

/// The 1:1 profile's Block row, for the conversation's other person (resolved from the
/// conversation's members; nothing is shown until that person is known).
class ConversationBlockTile extends ConsumerWidget {
  const ConversationBlockTile({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(blockRepositoryProvider).isAvailable) return const SizedBox.shrink();
    // A staff viewer never blocks: skip the lookup altogether.
    final role = ref.watch(currentRoleProvider);
    if (role == null || role == UserRole.sales) return const SizedBox.shrink();
    final person = ref.watch(directCounterpartProvider(conversationId)).value;
    if (person == null) return const SizedBox.shrink();
    return BlockPersonTile(person: person);
  }
}

/// Block / Unblock as an icon on a group member row, beside Report.
class MemberBlockButton extends ConsumerWidget {
  const MemberBlockButton({super.key, required this.member, required this.name});

  final ProfilePerson member;

  /// The name the row shows (its own neutral fallback when the server sent none).
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = _blockStateFor(ref, member);
    if (!s.offer) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final block = s.block;
    if (block != null) {
      return IconButton(
        key: ValueKey('member-unblock-${member.id}'),
        onPressed: () => confirmAndUnblock(context, block: block, name: member.displayName),
        icon: const Icon(Icons.do_not_disturb_off_outlined),
        tooltip: '${l10n.unblockAction}: $name',
      );
    }
    return IconButton(
      key: ValueKey('member-block-${member.id}'),
      onPressed: () => confirmAndBlock(
        context,
        subject: BlockSubject(kind: blockSubjectKind(member)!, id: member.id),
        name: member.displayName,
      ),
      icon: const Icon(Icons.block),
      tooltip: '${l10n.blockAction}: $name',
    );
  }
}

/// A message hidden because the viewer blocked its author: one line, with Unblock.
class HiddenByBlockLine extends ConsumerWidget {
  const HiddenByBlockLine({super.key, required this.message});

  final Message message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final canUnblock = ref.watch(blockRepositoryProvider).isAvailable && (message.authorId?.isNotEmpty ?? false);
    return Container(
      key: ValueKey('hidden-by-block-${message.id ?? message.clientMessageId}'),
      padding: const EdgeInsetsDirectional.only(
        start: Spacing.spacing3,
        end: Spacing.spacing1,
        top: Spacing.spacing1,
        bottom: Spacing.spacing1,
      ),
      decoration: BoxDecoration(
        color: tokens.colorSurfaceMuted,
        border: Border.all(color: tokens.colorBorderSubtle),
        borderRadius: const BorderRadius.all(Radii.radiusMd),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(child: Icon(Icons.block, size: 16, color: tokens.colorTextSecondary)),
          const SizedBox(width: Spacing.spacing2),
          Flexible(
            child: Text(
              l10n.hiddenByBlockPlaceholder,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary, fontStyle: FontStyle.italic),
            ),
          ),
          if (canUnblock)
            TextButton(
              key: const ValueKey('hidden-by-block-unblock'),
              onPressed: () =>
                  confirmAndUnblockPerson(context, ref, personId: message.authorId, name: message.authorName),
              child: Text(l10n.unblockAction),
            )
          else
            const SizedBox(width: Spacing.spacing2),
        ],
      ),
    );
  }
}

/// Shows [child] (the composer) unless this is a direct conversation with someone the viewer
/// blocked; then "You blocked {name}. Unblock to write." stands where it was.
///
/// [kind], when the screen already knows it, skips the member lookup for a group.
class BlockedComposerGate extends ConsumerWidget {
  const BlockedComposerGate({super.key, required this.conversationId, required this.child, this.kind});

  final String conversationId;
  final ConversationKind? kind;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(blockRepositoryProvider).isAvailable) return child;
    if (kind != null && !kind!.isDirect) return child;
    final blocks = ref.watch(blocksProvider).value ?? const <PersonBlock>[];
    if (blocks.isEmpty) return child;
    final person = ref.watch(directCounterpartProvider(conversationId)).value;
    if (person == null) return child;
    PersonBlock? block;
    for (final b in blocks) {
      if (b.subject.id == person.id) block = b;
    }
    if (block == null) return child;

    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final name = block.name.isNotEmpty ? block.name : person.displayName;
    final found = block;
    return SafeArea(
      top: false,
      child: Container(
        key: const ValueKey('blocked-composer'),
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing2),
        decoration: BoxDecoration(
          color: tokens.colorSurfaceDefault,
          border: Border(top: BorderSide(color: tokens.colorBorderSubtle)),
        ),
        child: Row(
          children: [
            ExcludeSemantics(child: Icon(Icons.block, size: 20, color: tokens.colorTextSecondary)),
            const SizedBox(width: Spacing.spacing3),
            Expanded(
              child: Text(l10n.blockedComposerNotice(blockDisplayName(name, l10n)), style: theme.textTheme.bodyMedium),
            ),
            TextButton(
              key: const ValueKey('blocked-composer-unblock'),
              onPressed: () => confirmAndUnblock(context, block: found, name: name),
              child: Text(l10n.unblockAction),
            ),
          ],
        ),
      ),
    );
  }
}
