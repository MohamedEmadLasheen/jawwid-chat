import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';

/// Pick the conversations to forward a message into.
///
/// The list is the user's OWN chat list, which is already scoped by the server
/// to what they may see — so this offers no destination they could not
/// otherwise write to. The server authorizes each one again on submit; this is
/// a convenience, never the control.
///
/// Returns the chosen conversation ids, or null if the user cancelled.
Future<List<String>?> showForwardSheet(
  BuildContext context, {
  required String excludeConversationId,
}) {
  return showModalBottomSheet<List<String>>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => FractionallySizedBox(
      heightFactor: 0.7,
      child: _ForwardSheet(excludeConversationId: excludeConversationId),
    ),
  );
}

class _ForwardSheet extends ConsumerStatefulWidget {
  const _ForwardSheet({required this.excludeConversationId});

  final String excludeConversationId;

  @override
  ConsumerState<_ForwardSheet> createState() => _ForwardSheetState();
}

class _ForwardSheetState extends ConsumerState<_ForwardSheet> {
  late final Future<List<Conversation>> _conversations;
  final _selected = <String>{};

  @override
  void initState() {
    super.initState();
    _conversations = ref
        .read(conversationRepositoryProvider)
        .list()
        // Forwarding a message into the conversation it already lives in is a
        // no-op the user did not mean, and the server refuses it — so it is not
        // offered. Read-only conversations are excluded for the same reason.
        .then(
          (all) => all
              .where((c) => c.id != widget.excludeConversationId && !c.isReadOnly)
              .toList(growable: false),
        );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.forwardTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              TextButton(
                onPressed: _selected.isEmpty
                    ? null
                    : () => Navigator.of(context).pop(_selected.toList()),
                child: Text(l10n.forwardAction),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: FutureBuilder<List<Conversation>>(
            future: _conversations,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const JawwidLoadingView();
              }
              if (snapshot.hasError) {
                final message = ErrorPresenter.present(
                  asAppErrorOf(snapshot.error!),
                  l10n,
                );
                return JawwidErrorView(title: message.title, body: message.body);
              }

              final conversations = snapshot.data ?? const <Conversation>[];
              if (conversations.isEmpty) {
                return JawwidEmptyView(
                  title: l10n.forwardEmpty,
                  body: '',
                  icon: Icons.forward,
                );
              }

              return ListView.builder(
                itemCount: conversations.length,
                itemBuilder: (context, index) {
                  final conversation = conversations[index];
                  return CheckboxListTile(
                    value: _selected.contains(conversation.id),
                    title: Text(
                      conversation.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onChanged: (checked) => setState(() {
                      if (checked == true) {
                        _selected.add(conversation.id);
                      } else {
                        _selected.remove(conversation.id);
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
