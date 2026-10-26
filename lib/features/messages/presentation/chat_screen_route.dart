import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../trials/presentation/trial_group_join_banner.dart';
import 'chat_screen.dart';
import 'system_message_text.dart' show coverDay;

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
  const ChatScreenRoute({
    super.key,
    required this.conversationId,
    this.focusMessageId,
    this.startVoiceRecording = false,
  });

  final String conversationId;

  /// Open at this message (a search hit); see [ChatScreen.focusMessageId].
  final String? focusMessageId;

  /// Opened by "Record voice message" on the call screen (`?voice=1`).
  final bool startVoiceRecording;

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
          focusMessageId: focusMessageId,
          conversation: value,
          // PD-12: the server titles a supervision conversation for its staff side;
          // the teacher reads it as their supervision chat.
          title: value.displayTitle(l10n.supervisionChatTitle, trialGroupLabel: l10n.trialGroupTitle),
          avatarUrl: value.avatarUrl,
          isTeacherSupervision: value.isTeacherSupervision,
          isTrialGroup: value.isTrialGroup,
          onOpenProfile: () =>
              context.push(Routes.conversationProfile(conversationId)),
          // Two different things, and never invented.
          //
          // On the family's own thread with Jawwid: "Handled by …", supplied by
          // the backend verbatim. The client never derives it and never shows an
          // internal handler id (decision D3). This is what tells a parent that
          // the Academy conversation is currently being answered by their
          // assigned supervisor — the product has one persistent family thread,
          // not an Academy one and a Supervisor one, and the header says which
          // person is behind it right now.
          //
          // On a Student Group: which child it is about. A parent with two
          // children must never have to work that out from a title (§27). Null
          // when the backend has not said — `ConversationDto` carries no
          // learner today — rather than guessed at from the title string.
          subtitle: switch (value) {
            Conversation(isTeacherSupervision: true) => l10n.supervisionChatSubtitle,
            Conversation(isTrialGroup: true) => l10n.trialGroupSubtitle,
            // PD-33: the supervisor is away; the parent is told who answers, until when.
            Conversation(cover: final cover?) =>
              l10n.conversationCoverLine(cover.coverName, coverDay(cover.until, l10n)),
            Conversation(handledByLabel: final handler?) =>
              l10n.handledBy(handler),
            Conversation(learner: final learner?) =>
              '${l10n.groupLearnerLabel} · ${learner.displayName}',
            _ => null,
          },
          kind: value.kind,
          requiresApproval: value.requiresApproval,
          isReadOnly: value.isReadOnly,
          startVoiceRecording: startVoiceRecording,
          // PD-20: Sales sees every trial group but must join one to take part in it.
          banner: value.isTrialGroup
              ? TrialGroupJoinBanner(
                  conversationId: conversationId,
                  onJoined: () => ref.invalidate(_conversationProvider(conversationId)),
                )
              : null,
        ),
    };
  }
}
