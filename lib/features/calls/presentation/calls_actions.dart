import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../conversations/application/conversations_controller.dart';
import '../application/call_controller.dart';
import '../application/calls_controller.dart';
import '../application/upcoming_calls_controller.dart';
import '../data/scheduled_call_repository.dart';
import '../domain/scheduled_call.dart';
import 'call_member_picker.dart';
import 'schedule_call_sheet.dart';

/// The Calls tab's entry points (PD-13): Start call, New call link, Select a
/// member, Schedule call, and the Join that a scheduled call or a link offers.
///
/// EVERY ONE OF THESE ASKS THE SERVER. The capability answer read before an
/// action is advisory and only picks the words of a refusal; `POST /calls`,
/// `POST /scheduled-calls` and `POST /scheduled-calls/:id/join` decide again,
/// and a refusal from any of them is shown as a sentence, never a code.

// ------------------------------------------------------------------ helpers

/// The conversations already loaded for the chat list, flattened. Empty while
/// loading or on error: the Calls tab never fetches a second directory.
List<Conversation> loadedConversations(WidgetRef ref) {
  final sections = ref.watch(conversationsControllerProvider).value ?? const [];
  return [for (final section in sections) ...section.conversations];
}

/// [loadedConversations] for a callback, where watching is not allowed.
List<Conversation> loadedConversationsRead(WidgetRef ref) {
  final sections = ref.read(conversationsControllerProvider).value ?? const [];
  return [for (final section in sections) ...section.conversations];
}

Conversation? conversationById(List<Conversation> all, String id) {
  for (final c in all) {
    if (c.id == id) return c;
  }
  return null;
}

/// A group, for the picker's split and the call screen's wording. The server
/// decides what kind of call it actually is.
bool isGroupConversation(Conversation c) =>
    c.kind == ConversationKind.studentGroup || c.isTrialGroup;

/// The name a conversation is shown under, never empty.
String conversationLabel(L10n l10n, Conversation c) {
  final title = c
      .displayTitle(
        l10n.supervisionChatTitle,
        trialGroupLabel: l10n.trialGroupTitle,
      )
      .trim();
  return title.isEmpty ? l10n.callsUnnamed : title;
}

void showCallsSnack(BuildContext context, String message) {
  ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// The sentence for a refused call capability. The code picks it; it is never
/// rendered itself.
String capabilityRefusalMessage(L10n l10n, String? code) => switch (code) {
  ScheduledCallCodes.parentCannotStartGroupCall => l10n.callRefusedParentGroup,
  callsNotAvailableCode => l10n.callsUnavailableTitle,
  _ => l10n.callRefusedGeneric,
};

/// The sentence for a Join that did not put a call on screen, or null.
String? scheduledJoinMessage(L10n l10n, ScheduledJoinResult result) =>
    switch (result) {
      ScheduledJoinResult.joined => null,
      ScheduledJoinResult.notJoinable => l10n.scheduledJoinNotJoinable,
      ScheduledJoinResult.waitingForHost => l10n.scheduledJoinWaitingForHost,
      ScheduledJoinResult.notAllowed => l10n.callFailedNotAllowed,
      ScheduledJoinResult.busy => l10n.scheduledJoinBusy,
      ScheduledJoinResult.unavailable => l10n.callsUnavailableTitle,
      ScheduledJoinResult.network => l10n.callFailedNetwork,
    };

/// The sentence for a failed `POST /scheduled-calls`.
String scheduleFailureMessage(L10n l10n, Object error) {
  final appError = error is AppError
      ? error
      : const AppError(AppErrorKind.unknown);
  return switch (appError.code) {
    ScheduledCallCodes.parentCannotStartGroupCall =>
      l10n.callRefusedParentGroup,
    scheduledCallsNotAvailableCode => l10n.callsUnavailableTitle,
    _ when appError.kind == AppErrorKind.forbidden => l10n.callRefusedGeneric,
    _ => ErrorPresenter.present(appError, l10n).title,
  };
}

/// Ask the server, fresh, whether this conversation may be called now.
///
/// Read straight from the repository rather than through the cached-for-a-
/// screen `callCapabilityProvider`: this is asked once, at the moment of the
/// tap, and must not outlive it. Fails closed.
Future<CallCapability> checkCallCapability(
  WidgetRef ref,
  String conversationId,
) async {
  final CallRepository calls;
  try {
    calls = ref.read(callRepositoryProvider);
  } catch (_) {
    return const CallCapability(canCall: false, code: callsNotAvailableCode);
  }
  try {
    return await calls.capability(conversationId: conversationId);
  } catch (error) {
    return CallCapability(
      canCall: false,
      code: error is AppError ? error.code : null,
    );
  }
}

void openConversation(BuildContext context, String conversationId) {
  GoRouter.maybeOf(context)?.push(Routes.conversation(conversationId));
}

// -------------------------------------------------------------------- flows

/// Call one conversation now: capability first (for the words), then the one
/// call controller. The call screen appears through `CallPresenter`.
Future<void> callConversation(
  BuildContext context,
  WidgetRef ref,
  Conversation c,
) async {
  final l10n = L10n.of(context);
  final capability = await checkCallCapability(ref, c.id);
  if (!context.mounted) return;
  if (!capability.canCall) {
    showCallsSnack(context, capabilityRefusalMessage(l10n, capability.code));
    return;
  }
  await ref
      .read(callControllerProvider.notifier)
      .start(
        conversationId: c.id,
        peerLabel: conversationLabel(l10n, c),
        isGroup: isGroupConversation(c),
      );
}

/// Join a scheduled call or a link. A refusal is a snackbar; success is the
/// call screen.
Future<void> joinScheduledCall(
  BuildContext context,
  WidgetRef ref, {
  required String scheduledCallId,
  required String conversationId,
  required String peerLabel,
  required bool isGroup,
}) async {
  final l10n = L10n.of(context);
  final result = await ref
      .read(callControllerProvider.notifier)
      .joinScheduled(
        scheduledCallId: scheduledCallId,
        conversationId: conversationId,
        peerLabel: peerLabel,
        isGroup: isGroup,
      );
  if (!context.mounted) return;
  final message = scheduledJoinMessage(l10n, result);
  if (message != null) showCallsSnack(context, message);
}

Future<void> startCallFlow(BuildContext context, WidgetRef ref) async {
  final picked = await showCallMemberPicker(context, mode: CallPickerMode.call);
  if (picked == null || !context.mounted) return;
  await callConversation(context, ref, picked);
}

Future<void> scheduleFlow(
  BuildContext context,
  WidgetRef ref, {
  Conversation? conversation,
}) async {
  final picked =
      conversation ??
      await showCallMemberPicker(context, mode: CallPickerMode.schedule);
  if (picked == null || !context.mounted) return;
  final l10n = L10n.of(context);

  final capability = await checkCallCapability(ref, picked.id);
  if (!context.mounted) return;
  if (!capability.canCall) {
    showCallsSnack(context, capabilityRefusalMessage(l10n, capability.code));
    return;
  }

  final created = await showScheduleCallSheet(context, conversation: picked);
  if (created == null || !context.mounted) return;
  unawaited(ref.read(upcomingCallsControllerProvider.notifier).refresh());
  showCallsSnack(
    context,
    l10n.callSchedulePosted(conversationLabel(l10n, picked)),
  );
}

Future<void> newLinkFlow(BuildContext context, WidgetRef ref) async {
  final picked = await showCallMemberPicker(context, mode: CallPickerMode.link);
  if (picked == null || !context.mounted) return;
  final l10n = L10n.of(context);

  final capability = await checkCallCapability(ref, picked.id);
  if (!context.mounted) return;
  if (!capability.canCall) {
    showCallsSnack(context, capabilityRefusalMessage(l10n, capability.code));
    return;
  }

  final ScheduledCall link;
  try {
    link = await resolveScheduledCallRepository(
      () => ref.read(scheduledCallRepositoryProvider),
    ).create(conversationId: picked.id, kind: ScheduledCallKind.link);
  } catch (error) {
    if (context.mounted) {
      showCallsSnack(context, scheduleFailureMessage(l10n, error));
    }
    return;
  }
  if (!context.mounted) return;
  unawaited(ref.read(upcomingCallsControllerProvider.notifier).refresh());

  final label = conversationLabel(l10n, picked);
  final choice = await showModalBottomSheet<_LinkChoice>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (sheetContext) => _LinkPostedSheet(chatLabel: label),
  );
  if (!context.mounted) return;
  switch (choice) {
    case _LinkChoice.join:
      await joinScheduledCall(
        context,
        ref,
        scheduledCallId: link.id,
        conversationId: link.conversationId,
        peerLabel: label,
        isGroup: isGroupConversation(picked),
      );
    case _LinkChoice.openChat:
      openConversation(context, picked.id);
    case null:
      break;
  }
}

Future<void> selectMemberFlow(BuildContext context, WidgetRef ref) async {
  final picked = await showCallMemberPicker(
    context,
    mode: CallPickerMode.select,
  );
  if (picked == null || !context.mounted) return;
  final l10n = L10n.of(context);

  final choice = await showModalBottomSheet<_MemberChoice>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
            child: Text(
              conversationLabel(l10n, picked),
              style: Theme.of(sheetContext).textTheme.titleMedium,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: Spacing.spacing3),
          ListTile(
            leading: const Icon(Icons.call_outlined),
            title: Text(l10n.callVoice),
            onTap: () => Navigator.of(sheetContext).pop(_MemberChoice.call),
          ),
          ListTile(
            leading: const Icon(Icons.chat_bubble_outline),
            title: Text(l10n.callMessage),
            onTap: () => Navigator.of(sheetContext).pop(_MemberChoice.message),
          ),
          ListTile(
            leading: const Icon(Icons.event_outlined),
            title: Text(l10n.callActionSchedule),
            onTap: () => Navigator.of(sheetContext).pop(_MemberChoice.schedule),
          ),
        ],
      ),
    ),
  );
  if (!context.mounted) return;
  switch (choice) {
    case _MemberChoice.call:
      await callConversation(context, ref, picked);
    case _MemberChoice.message:
      openConversation(context, picked.id);
    case _MemberChoice.schedule:
      await scheduleFlow(context, ref, conversation: picked);
    case null:
      break;
  }
}

enum _MemberChoice { call, message, schedule }

enum _LinkChoice { join, openChat }

/// "Call link posted in `chat`". The card in that chat IS the link: there is no
/// URL to copy on the phone, and no guest access.
class _LinkPostedSheet extends StatelessWidget {
  const _LinkPostedSheet({required this.chatLabel});

  final String chatLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing5,
          vertical: Spacing.spacing3,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(
              Icons.link,
              size: Spacing.spacing8,
              color: tokens.colorBrandPrimary,
            ),
            const SizedBox(height: Spacing.spacing4),
            Text(
              l10n.callLinkPosted(chatLabel),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: Spacing.spacing6),
            FilledButton.icon(
              icon: const Icon(Icons.call_outlined),
              label: Text(l10n.callLinkJoinNow),
              onPressed: () => Navigator.of(context).pop(_LinkChoice.join),
            ),
            const SizedBox(height: Spacing.spacing3),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(_LinkChoice.openChat),
              child: Text(l10n.callLinkOpenChat),
            ),
          ],
        ),
      ),
    );
  }
}
