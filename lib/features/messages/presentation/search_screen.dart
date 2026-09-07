import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/relative_time.dart';

/// Search across chats and messages.
///
/// EVERY result comes from the server. Nothing here filters a cached list:
/// filtering locally would look like search while silently covering only what
/// happened to be fetched, and — worse — it would be the beginnings of a
/// client-side directory, which the client is not allowed to assemble. The
/// backend scopes both queries to what this actor may read, so a message in
/// another family's conversation is not a result that is hidden; it is not a
/// candidate at all.
///
/// Optionally scoped to one conversation, which is how "search in this chat"
/// works — the same endpoint with a conversation id the server authorizes.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.conversationId, this.conversationTitle});

  /// Set to search inside one conversation only.
  final String? conversationId;
  final String? conversationTitle;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen>
    with SingleTickerProviderStateMixin {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  late final TabController _tabs;
  Timer? _debounce;

  String _query = '';

  /// Sender and date filters (§23). The backend supports both; exposing them
  /// only in a scoped search would be arbitrary, so they apply to either.
  String? _authorId;
  DateTime? _from;
  DateTime? _to;
  bool _showFilters = false;

  bool _isSearching = false;
  Object? _error;
  List<Conversation> _conversations = const [];
  List<MessageSearchHit> _messages = const [];

  bool get _isScoped => widget.conversationId != null;

  @override
  void initState() {
    super.initState();
    // A conversation-scoped search has no chat tab to offer: the chat is given.
    _tabs = TabController(length: _isScoped ? 1 : 2, vsync: this);
    _controller.addListener(_onQueryChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.removeListener(_onQueryChanged);
    _controller.dispose();
    _focus.dispose();
    _tabs.dispose();
    super.dispose();
  }

  /// Debounced, so a typist does not issue one query per keystroke against a
  /// full-text index on the network this audience is on.
  void _onQueryChanged() {
    final next = _controller.text.trim();
    if (next == _query) return;
    _query = next;

    _debounce?.cancel();
    if (next.length < 2) {
      setState(() {
        _conversations = const [];
        _messages = const [];
        _isSearching = false;
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), _run);
  }

  /// Apply a filter change immediately: the user has already told us what they
  /// want, and waiting for another keystroke to honour it would read as broken.
  void _applyFilters(void Function() change) {
    setState(change);
    if (_query.length >= 2) unawaited(_run());
  }

  Future<void> _run() async {
    final query = _query;
    setState(() {
      _isSearching = true;
      _error = null;
    });

    try {
      final messages = await ref.read(messageRepositoryProvider).search(
            MessageSearchQuery(
              text: query,
              conversationId: widget.conversationId,
              authorId: _authorId,
              from: _from,
              to: _to,
            ),
          );
      final conversations = _isScoped
          ? const <Conversation>[]
          : await ref.read(conversationRepositoryProvider).search(query);

      // The user may have typed on while this was in flight; a stale response
      // must not replace the results for what they are now looking at.
      if (!mounted || query != _query) return;
      setState(() {
        _messages = messages;
        _conversations = conversations;
        _isSearching = false;
      });
    } catch (error) {
      if (!mounted || query != _query) return;
      setState(() {
        _error = error;
        _isSearching = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          focusNode: _focus,
          textInputAction: TextInputAction.search,
          // Content decides its own direction, so an Arabic user searching for
          // an English word keeps a sane caret.
          textDirection: null,
          decoration: InputDecoration(
            border: InputBorder.none,
            hintText: _isScoped ? l10n.searchMessagesHint : l10n.searchHint,
          ),
        ),
        actions: [
          if (_controller.text.isNotEmpty)
            IconButton(
              onPressed: _controller.clear,
              icon: const Icon(Icons.close),
              tooltip: l10n.cancelAction,
            ),
        ],
        bottom: _isScoped
            ? null
            : TabBar(
                controller: _tabs,
                tabs: [
                  Tab(text: l10n.searchTabChats),
                  Tab(text: l10n.searchTabMessages),
                ],
              ),
      ),
      body: Column(
        children: [
          _FilterBar(
            isOpen: _showFilters,
            onToggle: () => setState(() => _showFilters = !_showFilters),
            conversationId: widget.conversationId,
            authorId: _authorId,
            from: _from,
            to: _to,
            onAuthorChanged: (id) => _applyFilters(() => _authorId = id),
            onFromChanged: (date) => _applyFilters(() => _from = date),
            onToChanged: (date) => _applyFilters(() => _to = date),
            onClear: () => _applyFilters(() {
              _authorId = null;
              _from = null;
              _to = null;
            }),
          ),
          Expanded(child: _body(l10n)),
        ],
      ),
    );
  }

  Widget _body(L10n l10n) {
    if (_query.length < 2) {
      return JawwidEmptyView(
        title: l10n.searchMinimumLength,
        body: '',
        icon: Icons.search,
      );
    }
    if (_isSearching && _messages.isEmpty && _conversations.isEmpty) {
      return const JawwidLoadingView();
    }

    final failure = _error;
    if (failure != null) {
      final message = ErrorPresenter.present(asAppErrorOf(failure), l10n);
      return JawwidErrorView(
        title: message.title,
        body: message.body,
        retryLabel: l10n.retryAction,
        onRetry: _run,
      );
    }

    if (_isScoped) return _messageResults(l10n);

    return TabBarView(
      controller: _tabs,
      children: [_conversationResults(l10n), _messageResults(l10n)],
    );
  }

  Widget _conversationResults(L10n l10n) {
    if (_conversations.isEmpty) {
      return JawwidEmptyView(title: l10n.searchEmpty, body: '', icon: Icons.search_off);
    }

    return ListView.builder(
      itemCount: _conversations.length,
      itemBuilder: (context, index) {
        final conversation = _conversations[index];
        return ListTile(
          title: Text(conversation.title, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: conversation.lastMessagePreview.isEmpty
              ? null
              : Text(
                  conversation.lastMessagePreview,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
          onTap: () => context.push(Routes.conversation(conversation.id)),
        );
      },
    );
  }

  Widget _messageResults(L10n l10n) {
    if (_messages.isEmpty) {
      return JawwidEmptyView(title: l10n.searchEmpty, body: '', icon: Icons.search_off);
    }

    final locale = Localizations.localeOf(context).toLanguageTag();

    return ListView.builder(
      itemCount: _messages.length,
      itemBuilder: (context, index) {
        final hit = _messages[index];
        return ListTile(
          title: Text(
            hit.message.body,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            // A message body resolves its own base direction per paragraph, so
            // a mixed Arabic/English result reads correctly either way.
            textDirection: null,
          ),
          subtitle: Row(
            children: [
              if (!_isScoped && hit.conversationTitle.isNotEmpty) ...[
                Flexible(
                  child: Text(
                    hit.conversationTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
                const SizedBox(width: Spacing.spacing2),
              ],
              Text(
                RelativeTime.forBubble(hit.message.createdAt, locale: locale),
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
          onTap: () => context.push(Routes.conversation(hit.conversationId)),
        );
      },
    );
  }
}

/// Sender and date filters.
///
/// Collapsed by default: most searches are a word, and a row of controls above
/// every result list would cost more than it earns. Opening it is one tap, and
/// an active filter is visible on the closed bar so a narrowed search never
/// looks like an empty one.
///
/// The sender picker offers the conversation's own participants when the search
/// is scoped to one, and nothing otherwise — a global list of everybody this
/// user could filter by would be a directory, and the client does not assemble
/// one.
class _FilterBar extends ConsumerWidget {
  const _FilterBar({
    required this.isOpen,
    required this.onToggle,
    required this.conversationId,
    required this.authorId,
    required this.from,
    required this.to,
    required this.onAuthorChanged,
    required this.onFromChanged,
    required this.onToChanged,
    required this.onClear,
  });

  final bool isOpen;
  final VoidCallback onToggle;
  final String? conversationId;
  final String? authorId;
  final DateTime? from;
  final DateTime? to;
  final ValueChanged<String?> onAuthorChanged;
  final ValueChanged<DateTime?> onFromChanged;
  final ValueChanged<DateTime?> onToChanged;
  final VoidCallback onClear;

  bool get _hasActiveFilter => authorId != null || from != null || to != null;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Container(
      color: theme.colorScheme.surfaceContainerHighest,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.spacing5,
                vertical: Spacing.spacing3,
              ),
              child: Row(
                children: [
                  Icon(
                    isOpen ? Icons.expand_less : Icons.tune,
                    size: 18,
                    color: _hasActiveFilter
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: Spacing.spacing3),
                  Text(
                    l10n.searchFilters,
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: _hasActiveFilter ? theme.colorScheme.primary : null,
                      fontWeight: _hasActiveFilter ? FontWeight.w700 : null,
                    ),
                  ),
                  const Spacer(),
                  if (_hasActiveFilter)
                    TextButton(
                      onPressed: onClear,
                      child: Text(l10n.searchClearFilters),
                    ),
                ],
              ),
            ),
          ),
          if (isOpen)
            Padding(
              // Directional, not physical: a physical LTRB inset puts the
              // padding on the wrong side in Arabic, which is what the
              // directionality guard exists to catch.
              padding: const EdgeInsetsDirectional.only(
                start: Spacing.spacing5,
                end: Spacing.spacing5,
                bottom: Spacing.spacing3,
              ),
              child: Wrap(
                spacing: Spacing.spacing3,
                runSpacing: Spacing.spacing2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (conversationId != null)
                    _SenderPicker(
                      conversationId: conversationId!,
                      selected: authorId,
                      onChanged: onAuthorChanged,
                    ),
                  _DateChip(
                    label: l10n.searchFromDate,
                    value: from,
                    locale: locale,
                    onChanged: onFromChanged,
                  ),
                  _DateChip(
                    label: l10n.searchToDate,
                    value: to,
                    locale: locale,
                    onChanged: onToChanged,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Filter by who wrote it.
///
/// The candidates are the conversation's OWN members, resolved by the server on
/// the conversation payload. There is no global people picker: assembling one
/// would mean the client holding a directory of actors, which §41 forbids.
class _SenderPicker extends ConsumerWidget {
  const _SenderPicker({
    required this.conversationId,
    required this.selected,
    required this.onChanged,
  });

  final String conversationId;
  final String? selected;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final conversation = ref.watch(_conversationMembersProvider(conversationId));

    return conversation.maybeWhen(
      data: (members) => DropdownButton<String?>(
        value: selected,
        hint: Text(l10n.searchAnySender),
        underline: const SizedBox.shrink(),
        items: [
          DropdownMenuItem<String?>(value: null, child: Text(l10n.searchAnySender)),
          for (final member in members)
            DropdownMenuItem<String?>(
              value: member.id,
              child: Text(member.displayName),
            ),
        ],
        onChanged: onChanged,
      ),
      // No members yet, or the lookup failed: offer nothing rather than an
      // empty picker that looks broken. The text search still works.
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// The conversation's members, for the sender filter.
final _conversationMembersProvider =
    FutureProvider.family<List<GroupMember>, String>((ref, conversationId) async {
  final group = await ref.read(groupRepositoryProvider).group(conversationId);
  return group.members;
});

class _DateChip extends StatelessWidget {
  const _DateChip({
    required this.label,
    required this.value,
    required this.locale,
    required this.onChanged,
  });

  final String label;
  final DateTime? value;
  final String locale;
  final ValueChanged<DateTime?> onChanged;

  @override
  Widget build(BuildContext context) {
    final selected = value;

    return InputChip(
      label: Text(
        selected == null
            ? label
            : '$label ${RelativeTime.forDaySeparator(selected, DateTime.now(), locale: locale, todayLabel: L10n.of(context).todayLabel, yesterdayLabel: L10n.of(context).yesterdayLabel)}',
      ),
      selected: selected != null,
      onSelected: (_) async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: selected ?? now,
          // A conversation cannot predate the product, and a future date
          // filters nothing — so the range is bounded rather than infinite.
          firstDate: DateTime(now.year - 5),
          lastDate: now,
        );
        if (picked != null) onChanged(picked);
      },
      onDeleted: selected == null ? null : () => onChanged(null),
    );
  }
}
