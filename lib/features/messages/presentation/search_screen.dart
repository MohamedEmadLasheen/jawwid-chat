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

  Future<void> _run() async {
    final query = _query;
    setState(() {
      _isSearching = true;
      _error = null;
    });

    try {
      final messages = await ref.read(messageRepositoryProvider).search(
            MessageSearchQuery(text: query, conversationId: widget.conversationId),
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
      body: _body(l10n),
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
