import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/search_text.dart';
import '../../../shared/utils/text_direction.dart';
import '../../conversations/application/conversations_controller.dart';
import '../../conversations/presentation/chat_search_field.dart';
import 'calls_actions.dart';

/// What the picker was opened for. It only changes the sheet's title: every
/// mode picks one of the user's own conversations, and what happens next is
/// the caller's (and then the server's).
enum CallPickerMode { call, select, link, schedule }

/// Pick one of this user's conversations, or null.
///
/// THE USER'S OWN CONVERSATIONS, AND NOTHING ELSE. There is no directory of
/// people here and no way to reach a stranger: the list is the chat list the
/// server already scoped to this actor, split into People (1:1s, named after the
/// other side) and Groups. Read-only conversations are left out -- nothing can
/// be started in them. Search is by name only.
Future<Conversation?> showCallMemberPicker(
  BuildContext context, {
  required CallPickerMode mode,
}) {
  return showModalBottomSheet<Conversation>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (sheetContext) => CallMemberPicker(mode: mode),
  );
}

/// Whether a conversation may be offered at all. Not a permission check -- the
/// server decides that on the tap -- only the exclusion of conversations in
/// which nothing new can happen.
bool pickable(Conversation c) =>
    !c.isArchived &&
    !c.isReadOnly &&
    c.kind != ConversationKind.teacherParentDirect;

class CallMemberPicker extends ConsumerStatefulWidget {
  const CallMemberPicker({super.key, required this.mode});

  final CallPickerMode mode;

  @override
  ConsumerState<CallMemberPicker> createState() => _CallMemberPickerState();
}

class _CallMemberPickerState extends ConsumerState<CallMemberPicker> {
  final _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(conversationsControllerProvider);

    final title = switch (widget.mode) {
      CallPickerMode.call => l10n.callActionStart,
      CallPickerMode.select => l10n.callActionSelectMember,
      CallPickerMode.link => l10n.callActionNewLink,
      CallPickerMode.schedule => l10n.callActionSchedule,
    };

    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.8,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
            child: Text(title, style: theme.textTheme.titleLarge),
          ),
          ChatSearchField(
            controller: _search,
            hintText: l10n.callsSearchHint,
            onChanged: (value) => setState(() => _query = value),
            onClear: () {
              _search.clear();
              setState(() => _query = '');
            },
          ),
          Expanded(
            child: switch (state) {
              AsyncError(:final error) when !state.hasValue => _PickerError(
                error: error,
              ),
              AsyncValue(:final value?) => _list(context, l10n, [
                for (final section in value) ...section.conversations,
              ]),
              _ => const JawwidLoadingView(),
            },
          ),
        ],
      ),
    );
  }

  Widget _list(BuildContext context, L10n l10n, List<Conversation> all) {
    final candidates = all.where(pickable).toList(growable: false);
    if (candidates.isEmpty) {
      return JawwidEmptyView(
        icon: Icons.forum_outlined,
        title: l10n.callPickerEmpty,
      );
    }

    final matches = candidates
        .where((c) => SearchText.matches(conversationLabel(l10n, c), _query))
        .toList(growable: false);
    if (matches.isEmpty) {
      return JawwidEmptyView(
        icon: Icons.search_off,
        title: l10n.callPickerNoMatch,
      );
    }

    final people = matches.where((c) => !isGroupConversation(c)).toList();
    final groups = matches.where(isGroupConversation).toList();

    return ListView(
      children: [
        if (people.isNotEmpty) ...[
          _Header(text: l10n.callPickerPeople),
          for (final c in people) _PickerRow(conversation: c),
        ],
        if (groups.isNotEmpty) ...[
          _Header(text: l10n.callPickerGroups),
          for (final c in groups) _PickerRow(conversation: c),
        ],
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(
        start: Spacing.spacing5,
        end: Spacing.spacing5,
        top: Spacing.spacing4,
        bottom: Spacing.spacing2,
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelLarge
            ?.copyWith(color: JawwidTokens.of(context).colorTextSecondary),
      ),
    );
  }
}

class _PickerRow extends StatelessWidget {
  const _PickerRow({required this.conversation});

  final Conversation conversation;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final label = conversationLabel(l10n, conversation);

    return ListTile(
      leading: JawwidAvatar(
        displayName: label,
        imageUrl: conversation.avatarUrl,
        size: Sizes.avatarMd,
      ),
      title: ContentText(label, maxLines: 1, overflow: TextOverflow.ellipsis),
      onTap: () => Navigator.of(context).pop(conversation),
    );
  }
}

class _PickerError extends ConsumerWidget {
  const _PickerError({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final message = ErrorPresenter.present(
      error is AppError
          ? error as AppError
          : const AppError(AppErrorKind.unknown),
      l10n,
    );
    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry
          ? () => ref.read(conversationsControllerProvider.notifier).refresh()
          : null,
    );
  }
}
