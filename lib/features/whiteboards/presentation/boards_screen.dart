import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../application/boards_controller.dart';
import '../domain/board.dart';

/// PD-39: the teacher's Boards tab (design §2): the boards in use, newest
/// first, and Deleted boards -- restorable for 30 days, then deleted for good
/// within 60 days (§10 4d, 5a; §11.3). There is no permanent delete (§10 5b).
class BoardsScreen extends ConsumerStatefulWidget {
  const BoardsScreen({super.key});

  @override
  ConsumerState<BoardsScreen> createState() => _BoardsScreenState();
}

class _BoardsScreenState extends ConsumerState<BoardsScreen> {
  bool _deleted = false;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.boardsTitle),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(Spacing.pagePadding, 0, Spacing.pagePadding, Spacing.spacing3),
            child: SegmentedButton<bool>(
              segments: [
                ButtonSegment(value: false, label: Text(l10n.boardsInUse), icon: const Icon(Icons.dashboard_outlined)),
                ButtonSegment(value: true, label: Text(l10n.boardsDeleted), icon: const Icon(Icons.restore_from_trash_outlined)),
              ],
              selected: {_deleted},
              onSelectionChanged: (v) => setState(() => _deleted = v.first),
            ),
          ),
        ),
      ),
      floatingActionButton: _deleted
          ? null
          : FloatingActionButton.extended(onPressed: () => _create(context), icon: const Icon(Icons.add), label: Text(l10n.boardsNew)),
      body: _deleted ? const _DeletedBoards() : const _BoardsInUse(),
    );
  }

  Future<void> _create(BuildContext context) async {
    final l10n = L10n.of(context);
    final title = await askBoardTitle(context, title: l10n.boardsNew, action: l10n.boardsCreate, initial: l10n.boardsUntitled);
    if (title == null || !context.mounted) return;
    try {
      final id = await ref.read(boardsProvider.notifier).create(title);
      if (context.mounted) await context.push(Routes.board(id));
    } on Object catch (e) {
      if (context.mounted) _snack(context, ErrorPresenter.present(asAppErrorOf(e), l10n).title);
    }
  }
}

class _BoardsInUse extends ConsumerWidget {
  const _BoardsInUse();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final boards = ref.watch(boardsProvider);
    return boards.when(
      loading: () => const JawwidLoadingView(),
      error: (e, _) {
        final p = ErrorPresenter.present(asAppErrorOf(e), l10n);
        return JawwidErrorView(title: p.title, body: p.body, retryLabel: l10n.retryAction, onRetry: () => ref.invalidate(boardsProvider));
      },
      data: (list) => list.isEmpty
          ? JawwidEmptyView(title: l10n.boardsEmpty, icon: Icons.draw_outlined)
          : RefreshIndicator(
              onRefresh: () => ref.refresh(boardsProvider.future),
              child: GridView.builder(
                padding: const EdgeInsetsDirectional.fromSTEB(Spacing.pagePadding, Spacing.spacing5, Spacing.pagePadding, 96),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 360,
                  mainAxisSpacing: Spacing.spacing5,
                  crossAxisSpacing: Spacing.spacing5,
                  childAspectRatio: 1.45,
                ),
                itemCount: list.length,
                itemBuilder: (context, i) => _BoardCard(board: list[i]),
              ),
            ),
    );
  }
}

class _BoardCard extends ConsumerWidget {
  const _BoardCard({required this.board});

  final BoardSummary board;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final text = Theme.of(context).textTheme;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(Routes.board(board.id)),
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing2, Spacing.spacing4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.draw_outlined, color: tokens.colorBrandPrimary),
                  const SizedBox(width: Spacing.spacing3),
                  Expanded(
                    child: Text(board.title, style: text.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ),
                  PopupMenuButton<String>(
                    tooltip: l10n.boardMore,
                    onSelected: (v) => _act(context, ref, v),
                    itemBuilder: (_) => [
                      PopupMenuItem(value: 'rename', child: Text(l10n.boardsRename)),
                      PopupMenuItem(value: 'duplicate', child: Text(l10n.boardsDuplicate)),
                      PopupMenuItem(value: 'delete', child: Text(l10n.boardsDelete)),
                    ],
                  ),
                ],
              ),
              const Spacer(),
              Text(l10n.boardsPages('${board.pageCount}'), style: text.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
              Text(
                l10n.boardsUpdated(DateFormat.yMMMd(locale).format(board.updatedAt)),
                style: text.bodySmall?.copyWith(color: tokens.colorTextSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _act(BuildContext context, WidgetRef ref, String action) async {
    final l10n = L10n.of(context);
    final boards = ref.read(boardsProvider.notifier);
    try {
      switch (action) {
        case 'rename':
          final title = await askBoardTitle(context, title: l10n.boardsRename, action: l10n.boardsSave, initial: board.title);
          if (title != null) await boards.rename(board, title);
        case 'duplicate':
          await boards.duplicate(board);
        case 'delete':
          if (await confirmMoveToTrash(context, board.title) && context.mounted) {
            await boards.moveToTrash(board);
            if (context.mounted) _snack(context, l10n.boardsMovedToTrash);
          }
      }
    } on Object catch (e) {
      if (context.mounted) _snack(context, ErrorPresenter.present(asAppErrorOf(e), l10n).title);
    }
  }
}

class _DeletedBoards extends ConsumerWidget {
  const _DeletedBoards();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final deleted = ref.watch(deletedBoardsProvider);
    final footer = Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.pagePadding, Spacing.spacing5, Spacing.pagePadding, Spacing.spacing7),
      child: Text(l10n.boardsDeletedFooter, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
    );
    return deleted.when(
      loading: () => const JawwidLoadingView(),
      error: (e, _) {
        final p = ErrorPresenter.present(asAppErrorOf(e), l10n);
        return JawwidErrorView(
          title: p.title,
          body: p.body,
          retryLabel: l10n.retryAction,
          onRetry: () => ref.invalidate(deletedBoardsProvider),
        );
      },
      data: (list) => ListView(
        children: [
          if (list.isEmpty)
            Padding(
              padding: const EdgeInsets.all(Spacing.spacing7),
              child: JawwidEmptyView(title: l10n.boardsDeletedEmpty),
            ),
          for (final b in list)
            ListTile(
              leading: const Icon(Icons.draw_outlined),
              title: Text(b.title),
              subtitle: Text(
                l10n.boardsDeletedOnUntil(
                  DateFormat.yMMMd(locale).format(b.trashedAt ?? b.updatedAt),
                  b.purgeAfter == null ? '' : DateFormat.yMMMd(locale).format(b.purgeAfter!),
                ),
              ),
              trailing: TextButton(
                onPressed: () async {
                  try {
                    await ref.read(deletedBoardsProvider.notifier).restore(b);
                    if (context.mounted) _snack(context, l10n.boardsRestored);
                  } on Object catch (e) {
                    if (context.mounted) _snack(context, ErrorPresenter.present(asAppErrorOf(e), l10n).title);
                  }
                },
                child: Text(l10n.boardsRestore),
              ),
            ),
          footer,
        ],
      ),
    );
  }
}

/// The board name: 1–120 characters.
Future<String?> askBoardTitle(BuildContext context, {required String title, required String action, required String initial}) {
  final l10n = L10n.of(context);
  final controller = TextEditingController(text: initial)..selection = TextSelection(baseOffset: 0, extentOffset: initial.length);
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        maxLength: 120,
        decoration: InputDecoration(labelText: l10n.boardsTitleLabel),
        onSubmitted: (v) => Navigator.of(context).pop(v.trim().isEmpty ? null : v.trim()),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.boardsCancel)),
        FilledButton(
          onPressed: () {
            final v = controller.text.trim();
            Navigator.of(context).pop(v.isEmpty ? null : v);
          },
          child: Text(action),
        ),
      ],
    ),
  );
}

/// §10 5a: says where the board goes and until when it can come back.
Future<bool> confirmMoveToTrash(BuildContext context, String title) async {
  final l10n = L10n.of(context);
  final locale = Localizations.localeOf(context).toLanguageTag();
  final until = DateFormat.yMMMd(locale).format(DateTime.now().add(const Duration(days: 30)));
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.boardsDeleteTitle(title)),
      content: Text(l10n.boardsDeleteBody(until)),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.boardsCancel)),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(l10n.boardsDelete)),
      ],
    ),
  );
  return ok ?? false;
}

void _snack(BuildContext context, String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
