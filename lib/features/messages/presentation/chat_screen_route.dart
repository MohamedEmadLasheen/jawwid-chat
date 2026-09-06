import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import 'chat_screen.dart';

/// Resolves a conversation id — which may have arrived from a deep link or a notification —
/// into the header data [ChatScreen] needs.
///
/// The lookup goes to the backend rather than to a local cache so an unauthorized or deleted
/// id fails here, with a safe error, instead of opening an empty thread (§52, §74).
final _conversationProvider =
    FutureProvider.family<Conversation, String>((ref, conversationId) {
  return ref.read(conversationRepositoryProvider).byId(conversationId);
});

class ChatScreenRoute extends ConsumerWidget {
  const ChatScreenRoute({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final conversation = ref.watch(_conversationProvider(conversationId));

    return switch (conversation) {
      AsyncLoading() => Scaffold(
          appBar: AppBar(),
          body: const JawwidLoadingView(),
        ),
      AsyncError(:final error) => Scaffold(
          appBar: AppBar(),
          body: Builder(
            builder: (context) {
              final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
              return JawwidErrorView(
                title: message.title,
                body: message.body,
                retryLabel: message.canRetry ? l10n.retryAction : null,
                onRetry: message.canRetry
                    ? () => ref.invalidate(_conversationProvider(conversationId))
                    : null,
              );
            },
          ),
        ),
      AsyncData(:final value) => ChatScreen(
          conversationId: conversationId,
          title: value.title,
          // "Handled by …" comes from the backend verbatim; the client never derives it and
          // never shows an internal handler id (decision D3).
          subtitle: value.handledByLabel == null
              ? null
              : l10n.handledBy(value.handledByLabel!),
          kind: value.kind,
          requiresApproval: value.requiresApproval,
          isReadOnly: value.isReadOnly,
        ),
    };
  }
}
