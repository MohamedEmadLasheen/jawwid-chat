import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/text_direction.dart';

/// At most this many destinations per forward (owner decision 2026-10-19).
const kForwardMaxTargets = 10;

/// Pick the chats to forward into (ported from the phase-7 sheet, 4913d0f).
///
/// The list is the user's OWN chat list, already scoped by the server to what
/// they may see; read-only chats are left out. The server authorizes every
/// destination again on submit -- this is a convenience, never the control.
///
/// Returns the chosen conversation ids, or null if the user cancelled.
Future<List<String>?> showForwardSheet(BuildContext context) {
  return showModalBottomSheet<List<String>>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => const FractionallySizedBox(heightFactor: 0.75, child: _ForwardSheet()),
  );
}

class _ForwardSheet extends ConsumerStatefulWidget {
  const _ForwardSheet();

  @override
  ConsumerState<_ForwardSheet> createState() => _ForwardSheetState();
}

class _ForwardSheetState extends ConsumerState<_ForwardSheet> {
  late final Future<List<Conversation>> _conversations;
  final _selected = <String>[];

  @override
  void initState() {
    super.initState();
    _conversations = ref
        .read(conversationRepositoryProvider)
        .list()
        .then((all) => all.where((c) => !c.isReadOnly).toList(growable: false));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final full = _selected.length >= kForwardMaxTargets;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
          child: Row(
            children: [
              Expanded(child: Text(l10n.forwardTitle, style: Theme.of(context).textTheme.titleMedium)),
              FilledButton(
                // The theme makes filled buttons full-width; in a Row that is an
                // infinite width, so this one sizes to its label.
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _selected.isEmpty ? null : () => Navigator.of(context).pop(List<String>.of(_selected)),
                child: Text(l10n.forwardSendTo(_selected.length)),
              ),
            ],
          ),
        ),
        if (full)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing1),
            child: Text(l10n.forwardMax, style: Theme.of(context).textTheme.bodySmall),
          ),
        const Divider(height: 1),
        Expanded(
          child: FutureBuilder<List<Conversation>>(
            future: _conversations,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const JawwidLoadingView();
              if (snapshot.hasError) {
                final message = ErrorPresenter.present(asAppErrorOf(snapshot.error!), l10n);
                return JawwidErrorView(title: message.title, body: message.body);
              }
              final conversations = snapshot.data ?? const <Conversation>[];
              if (conversations.isEmpty) {
                return JawwidEmptyView(title: l10n.forwardEmpty, body: '', icon: Icons.forward);
              }
              return ListView.builder(
                itemCount: conversations.length,
                itemBuilder: (context, index) {
                  final c = conversations[index];
                  final on = _selected.contains(c.id);
                  return CheckboxListTile(
                    value: on,
                    secondary: JawwidAvatar(displayName: c.title, imageUrl: c.avatarUrl, size: Sizes.avatarSm),
                    title: ContentText(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                    onChanged: !on && full
                        ? null
                        : (checked) => setState(() {
                              if (checked == true) {
                                _selected.add(c.id);
                              } else {
                                _selected.remove(c.id);
                              }
                            }),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
