import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../application/board_editor_controller.dart';
import '../application/boards_controller.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';
import 'board_canvas.dart';
import 'board_painter.dart';
import 'boards_screen.dart';

/// §10 2a/2b: whether this device edits. Shortest side at least 600 dp
/// (laptops and tablets); phones view. A UX gate, never a security control:
/// the server takes the owner's writes from any device.
///
/// It ships REPORT-ONLY ([kBoardEditGateEnforced] false): it logs what it would
/// decide and blocks nothing, until QA's device and browser matrix
/// (docs/mobile/evidence/pd39/compatibility.md) is signed off.
const bool kBoardEditGateEnforced = false;
const double kBoardEditMinShortestSide = 600;

enum EditGate { allowed, screenTooSmall }

EditGate boardEditGate(Size screen) => screen.shortestSide >= kBoardEditMinShortestSide ? EditGate.allowed : EditGate.screenTooSmall;

/// PD-39: one board, full screen (design §4).
class BoardEditorScreen extends ConsumerStatefulWidget {
  const BoardEditorScreen({super.key, required this.boardId});

  final String boardId;

  @override
  ConsumerState<BoardEditorScreen> createState() => _BoardEditorScreenState();
}

class _BoardEditorScreenState extends ConsumerState<BoardEditorScreen> {
  final _canvas = GlobalKey<BoardCanvasState>();
  final _view = BoardViewController();
  BoardTool _tool = BoardTool.pen;
  // Each kind of tool keeps its own colour: picking a Tajweed swatch for the
  // highlighter never turns the next pen stroke or text red.
  Color _ink = BoardPalette.ink;
  Color _highlight = BoardPalette.highlighter;
  Color _stampColor = BoardPalette.stampGold;

  Color get _color => switch (_tool) {
    BoardTool.highlighter => _highlight,
    BoardTool.stamp => _stampColor,
    _ => _ink,
  };

  void _setColor(Color c) => switch (_tool) {
    BoardTool.highlighter => _highlight = c,
    BoardTool.stamp => _stampColor = c,
    _ => _ink = c,
  };
  double _width = 6;
  StampKind _stamp = StampKind.star;
  bool _gateLogged = false;
  late final AppLifecycleListener _lifecycle;
  late final BoardEditorController _held;

  @override
  void initState() {
    super.initState();
    _held = ref.read(boardEditorProvider(widget.boardId).notifier);
    // Going to the background may be the app's last moment: the draft is
    // written and a save is tried (review of #293).
    _lifecycle = AppLifecycleListener(
      onStateChange: (s) {
        if (s == AppLifecycleState.inactive || s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
          unawaited(_held.persistNow());
          unawaited(_held.flush());
        }
      },
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    // Leaving the board: the draft is written now; the controller stays alive
    // (its keep-alive) until every page is on the server.
    unawaited(_held.persistNow());
    unawaited(_held.flush());
    _view.dispose();
    super.dispose();
  }

  BoardEditorController get _controller => ref.read(boardEditorProvider(widget.boardId).notifier);

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final editor = ref.watch(boardEditorProvider(widget.boardId));
    ref.listen(boardEditorProvider(widget.boardId), (prev, next) {
      final s = next.value;
      if (s != null && s.notice == EditorNotice.saveFirst) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.boardSaveFirst)));
        _controller.acknowledgeNotice();
      }
    });
    return PopScope(
      onPopInvokedWithResult: (_, _) {
        unawaited(_controller.persistNow());
        unawaited(_controller.flush());
      },
      child: editor.when(
        loading: () => Scaffold(appBar: AppBar(), body: const JawwidLoadingView()),
        error: (e, _) {
          final p = ErrorPresenter.present(asAppErrorOf(e), l10n);
          return Scaffold(
            appBar: AppBar(),
            body: JawwidErrorView(
              title: p.title,
              body: p.body,
              retryLabel: l10n.retryAction,
              onRetry: () => ref.invalidate(boardEditorProvider(widget.boardId)),
            ),
          );
        },
        data: (s) => _editor(context, s),
      ),
    );
  }

  Widget _editor(BuildContext context, EditorState s) {
    final l10n = L10n.of(context);
    final gate = boardEditGate(MediaQuery.sizeOf(context));
    if (!_gateLogged) {
      _gateLogged = true;
      developer.log('board edit gate: ${gate.name} (web: $kIsWeb, enforced: $kBoardEditGateEnforced)', name: 'whiteboard.edit_gate');
    }
    final blockedByDevice = kBoardEditGateEnforced && gate != EditGate.allowed;
    final editable = s.canEdit && !blockedByDevice;
    final page = s.page;
    final canvas = BoardCanvas(
      key: _canvas,
      page: page,
      tool: editable ? _tool : BoardTool.hand,
      style: ToolStyle(color: _color, width: _width, stamp: _stamp, stampText: _stampText(l10n)),
      readOnly: !editable,
      view: _view,
      onCommit: _controller.commit,
      onRequestText: ({initial}) => _askText(context, initial),
      placeholderLabel: (e) => e.kind == 'verse' ? l10n.boardVersePlaceholder : l10n.boardElementUnknown,
    );
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true): _controller.undo,
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true): _controller.undo,
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true, shift: true): _controller.redo,
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true, shift: true): _controller.redo,
        const SingleActivator(LogicalKeyboardKey.delete): _deleteSelection,
        const SingleActivator(LogicalKeyboardKey.backspace): _deleteSelection,
        const SingleActivator(LogicalKeyboardKey.escape): () => _canvas.currentState?.clearSelection(),
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          appBar: AppBar(
            title: InkWell(
              onTap: editable ? () => _rename(context, s) : null,
              child: Text(s.board.title, overflow: TextOverflow.ellipsis),
            ),
            actions: [
              _SaveChip(status: s.save, readOnly: !s.canEdit),
              if (editable) ...[
                IconButton(tooltip: l10n.boardUndo, onPressed: s.canUndo ? _controller.undo : null, icon: const Icon(Icons.undo)),
                IconButton(tooltip: l10n.boardRedo, onPressed: s.canRedo ? _controller.redo : null, icon: const Icon(Icons.redo)),
                _BoardMenu(onDelete: () => _moveToTrash(context, s)),
              ],
            ],
          ),
          body: Column(
            children: [
              if (s.save == SaveStatus.conflict) _ConflictBanner(onReload: _controller.reload, onCopy: () => _saveAsCopy(context, s)),
              if (s.save == SaveStatus.failed) _FailedBanner(code: s.failureCode),
              if (s.draftStale)
                MaterialBanner(
                  leading: const Icon(Icons.history),
                  content: Text(l10n.boardDraftStale),
                  actions: [
                    TextButton(onPressed: _controller.discardStaleDraft, child: Text(l10n.boardDraftStaleDiscard)),
                    FilledButton(onPressed: _controller.keepStaleDraft, child: Text(l10n.boardDraftStaleKeep)),
                  ],
                ),
              if (s.draftNotKept && s.save != SaveStatus.saved)
                MaterialBanner(
                  leading: const Icon(Icons.sd_card_alert_outlined),
                  content: Text(l10n.boardDraftNotKept),
                  actions: const [SizedBox.shrink()],
                ),
              if (s.canEdit && blockedByDevice)
                MaterialBanner(content: Text(l10n.boardEditNeedsLargerScreen), actions: const [SizedBox.shrink()]),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, c) {
                    final wide = c.maxWidth >= 700;
                    final tools = editable
                        ? _ToolPanel(
                            vertical: wide,
                            tool: _tool,
                            color: _color,
                            width: _width,
                            stamp: _stamp,
                            page: page,
                            onTool: (t) => setState(() {
                              _tool = t;
                              _width = _defaultWidth(t);
                            }),
                            onColor: (c) => setState(() => _setColor(c)),
                            onWidth: (w) => setState(() => _width = w),
                            onStamp: (k) => setState(() {
                              _stamp = k;
                              _stampColor = k.index >= StampKind.excellentAr.index ? BoardPalette.stampGreen : BoardPalette.stampGold;
                            }),
                            onDelete: _deleteSelection,
                            onLayout: _controller.setLayout,
                            onBackground: _controller.setBackground,
                          )
                        : null;
                    final view = Stack(
                      children: [
                        Positioned.fill(
                          child: ColoredBox(color: JawwidTokens.of(context).colorSurfaceMuted, child: canvas),
                        ),
                        PositionedDirectional(
                          end: Spacing.spacing4,
                          bottom: Spacing.spacing4,
                          child: _ZoomControls(view: _view),
                        ),
                      ],
                    );
                    return wide
                        ? Row(
                            children: [
                              ?tools,
                              Expanded(child: view),
                            ],
                          )
                        : Column(
                            children: [
                              Expanded(child: view),
                              ?tools,
                            ],
                          );
                  },
                ),
              ),
              _PageBar(state: s, editable: editable),
            ],
          ),
        ),
      ),
    );
  }

  String? _stampText(L10n l10n) => switch (_stamp) {
    StampKind.excellentAr || StampKind.excellentEn => l10n.boardStampExcellent,
    StampKind.wellDoneAr || StampKind.wellDoneEn => l10n.boardStampWellDone,
    _ => null,
  };

  double _defaultWidth(BoardTool t) => switch (t) {
    BoardTool.highlighter => 30,
    BoardTool.text => 6,
    _ => _width > 16 ? 6 : _width,
  };

  void _deleteSelection() {
    final c = _canvas.currentState;
    final s = ref.read(boardEditorProvider(widget.boardId)).value;
    if (c == null || s == null || c.selection.isEmpty) return;
    final gone = c.selection;
    _controller.commit([
      for (final e in s.page.elements)
        if (!gone.contains(e.id)) e,
    ]);
    c.clearSelection();
  }

  Future<String?> _askText(BuildContext context, String? initial) {
    final l10n = L10n.of(context);
    final controller = TextEditingController(text: initial ?? '');
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.boardTextTitle),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: 1,
          maxLines: 6,
          maxLength: 2000,
          decoration: InputDecoration(hintText: l10n.boardTextHint),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.boardsCancel)),
          FilledButton(onPressed: () => Navigator.of(context).pop(controller.text), child: Text(l10n.boardsSave)),
        ],
      ),
    );
  }

  /// §10 5a: to Deleted boards, restorable for 30 days; then back to the list.
  Future<void> _moveToTrash(BuildContext context, EditorState s) async {
    final l10n = L10n.of(context);
    if (!await confirmMoveToTrash(context, s.board.title) || !context.mounted) return;
    await _controller.flush();
    final latest = ref.read(boardEditorProvider(widget.boardId)).value ?? s;
    try {
      await ref.read(boardsProvider.notifier).moveToTrash(latest.board);
      if (context.mounted) context.pop();
    } on Object catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ErrorPresenter.present(asAppErrorOf(e), l10n).title)));
      }
    }
  }

  Future<void> _rename(BuildContext context, EditorState s) async {
    final l10n = L10n.of(context);
    final title = await askBoardTitle(context, title: l10n.boardsRename, action: l10n.boardsSave, initial: s.board.title);
    if (title != null) await _controller.rename(title);
  }

  Future<void> _saveAsCopy(BuildContext context, EditorState s) async {
    final l10n = L10n.of(context);
    final id = await _controller.saveAsCopy(l10n.boardCopyTitle(s.board.title));
    if (id != null && context.mounted) context.pushReplacement(Routes.board(id));
  }
}

class _SaveChip extends StatelessWidget {
  const _SaveChip({required this.status, required this.readOnly});

  final SaveStatus status;
  final bool readOnly;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final (label, color, icon) = readOnly
        ? (l10n.boardReadOnly, tokens.colorTextSecondary, Icons.visibility_outlined)
        : switch (status) {
            SaveStatus.saved => (l10n.boardSaved, tokens.colorStatusSuccessFg, Icons.cloud_done_outlined),
            SaveStatus.saving => (l10n.boardSaving, tokens.colorTextSecondary, Icons.cloud_upload_outlined),
            SaveStatus.dirty || SaveStatus.offline => (l10n.boardUnsaved, tokens.colorStatusWarningFg, Icons.cloud_off_outlined),
            SaveStatus.conflict || SaveStatus.failed => (l10n.boardUnsaved, tokens.colorStatusDangerFg, Icons.error_outline),
          };
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: Spacing.spacing3),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: Spacing.spacing2),
          Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color)),
        ],
      ),
    );
  }
}

class _ConflictBanner extends StatelessWidget {
  const _ConflictBanner({required this.onReload, required this.onCopy});

  final VoidCallback onReload;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return MaterialBanner(
      leading: const Icon(Icons.sync_problem_outlined),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.boardConflictTitle, style: Theme.of(context).textTheme.titleSmall),
          Text(l10n.boardConflictBody),
        ],
      ),
      actions: [
        TextButton(onPressed: onReload, child: Text(l10n.boardConflictReload)),
        FilledButton(onPressed: onCopy, child: Text(l10n.boardConflictCopy)),
      ],
    );
  }
}

class _FailedBanner extends StatelessWidget {
  const _FailedBanner({required this.code});

  final String? code;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final text = switch (code) {
      kPageFullCode => l10n.boardPageFull,
      'COMM.WHITEBOARD_LIMIT' => l10n.boardFailedLimit,
      'COMM.WHITEBOARD_INVALID' => l10n.boardFailedInvalid,
      _ => l10n.boardFailedOther,
    };
    return MaterialBanner(leading: const Icon(Icons.error_outline), content: Text(text), actions: const [SizedBox.shrink()]);
  }
}

class _BoardMenu extends StatelessWidget {
  const _BoardMenu({required this.onDelete});

  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return PopupMenuButton<String>(
      tooltip: l10n.boardMore,
      itemBuilder: (_) => [PopupMenuItem(value: 'delete', child: Text(l10n.boardsDelete))],
      onSelected: (v) {
        if (v == 'delete') onDelete();
      },
    );
  }
}

/// The tools, colours and widths; on a wide screen a rail at the start edge,
/// on a narrow one a scrolling bar under the page.
class _ToolPanel extends StatelessWidget {
  const _ToolPanel({
    required this.vertical,
    required this.tool,
    required this.color,
    required this.width,
    required this.stamp,
    required this.page,
    required this.onTool,
    required this.onColor,
    required this.onWidth,
    required this.onStamp,
    required this.onDelete,
    required this.onLayout,
    required this.onBackground,
  });

  final bool vertical;
  final BoardTool tool;
  final Color color;
  final double width;
  final StampKind stamp;
  final BoardPage page;
  final ValueChanged<BoardTool> onTool;
  final ValueChanged<Color> onColor;
  final ValueChanged<double> onWidth;
  final ValueChanged<StampKind> onStamp;
  final VoidCallback onDelete;
  final ValueChanged<PageLayout> onLayout;
  final ValueChanged<PageBackground> onBackground;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    Widget toolButton(BoardTool t, IconData icon, String label) => IconButton(
      tooltip: label,
      isSelected: tool == t,
      style: IconButton.styleFrom(backgroundColor: tool == t ? tokens.colorBrandPrimary.withValues(alpha: 0.14) : null),
      onPressed: () => onTool(t),
      icon: Icon(icon, color: tool == t ? tokens.colorBrandPrimary : tokens.colorTextPrimary),
    );
    Widget swatch(Color c, String label) => Semantics(
      button: true,
      selected: c == color,
      label: label,
      child: Tooltip(
        message: label,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: () => onColor(c),
          child: Container(
            width: 28,
            height: 28,
            margin: const EdgeInsets.all(Spacing.spacing1),
            decoration: BoxDecoration(
              color: c,
              shape: BoxShape.circle,
              border: Border.all(color: c == color ? tokens.colorBrandPrimary : tokens.colorBorderDefault, width: c == color ? 3 : 1),
            ),
          ),
        ),
      ),
    );
    final widths = tool == BoardTool.highlighter ? const [18.0, 30.0, 44.0] : const [3.0, 6.0, 10.0, 16.0];
    final children = <Widget>[
      toolButton(BoardTool.select, Icons.near_me_outlined, l10n.boardToolSelect),
      toolButton(BoardTool.hand, Icons.pan_tool_outlined, l10n.boardToolHand),
      toolButton(BoardTool.pen, Icons.edit_outlined, l10n.boardToolPen),
      toolButton(BoardTool.highlighter, Icons.border_color_outlined, l10n.boardToolHighlighter),
      toolButton(BoardTool.eraser, Icons.cleaning_services_outlined, l10n.boardToolEraser),
      toolButton(BoardTool.areaEraser, Icons.auto_fix_normal_outlined, l10n.boardToolAreaEraser),
      toolButton(BoardTool.text, Icons.text_fields, l10n.boardToolText),
      toolButton(BoardTool.rect, Icons.crop_square, l10n.boardToolRect),
      toolButton(BoardTool.ellipse, Icons.circle_outlined, l10n.boardToolEllipse),
      toolButton(BoardTool.triangle, Icons.change_history, l10n.boardToolTriangle),
      toolButton(BoardTool.line, Icons.horizontal_rule, l10n.boardToolLine),
      toolButton(BoardTool.arrow, Icons.arrow_right_alt, l10n.boardToolArrow),
      toolButton(BoardTool.stamp, Icons.star_outline, l10n.boardToolStamp),
      const Divider(height: Spacing.spacing4),
      if (tool == BoardTool.highlighter) ...[
        swatch(BoardPalette.highlighter, l10n.boardToolHighlighter),
        swatch(BoardPalette.tajweedMadd, l10n.boardTajweedMadd),
        swatch(BoardPalette.tajweedGhunnah, l10n.boardTajweedGhunnah),
        swatch(BoardPalette.tajweedIkhfa, l10n.boardTajweedIkhfa),
        swatch(BoardPalette.tajweedIzhar, l10n.boardTajweedIzhar),
      ] else if (tool == BoardTool.stamp) ...[
        for (final k in StampKind.values.where((k) => k != StampKind.excellentEn && k != StampKind.wellDoneEn))
          IconButton(
            isSelected: stamp == k,
            tooltip: switch (k) {
              StampKind.excellentAr => l10n.boardStampExcellent,
              StampKind.wellDoneAr => l10n.boardStampWellDone,
              _ => l10n.boardToolStamp,
            },
            onPressed: () => onStamp(k),
            icon: switch (k) {
              StampKind.excellentAr => Text(
                l10n.boardStampExcellent,
                style: const TextStyle(fontFamily: kBoardFont, fontWeight: FontWeight.w600),
              ),
              StampKind.wellDoneAr => Text(
                l10n.boardStampWellDone,
                style: const TextStyle(fontFamily: kBoardFont, fontWeight: FontWeight.w600),
              ),
              _ => Icon(kStampIcons[k]),
            },
          ),
      ] else
        for (final c in BoardPalette.pens) swatch(c, l10n.boardColour),
      if (tool != BoardTool.stamp && tool != BoardTool.select && tool != BoardTool.hand) ...[
        const Divider(height: Spacing.spacing4),
        for (final w in widths)
          IconButton(
            tooltip: l10n.boardThickness,
            isSelected: width == w,
            onPressed: () => onWidth(w),
            icon: Container(
              width: 22,
              height: (w / 2).clamp(2, 14),
              decoration: BoxDecoration(
                color: width == w ? tokens.colorBrandPrimary : tokens.colorTextSecondary,
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
      ],
      if (tool == BoardTool.select)
        IconButton(tooltip: l10n.boardDeleteSelection, onPressed: onDelete, icon: const Icon(Icons.delete_outline)),
      const Divider(height: Spacing.spacing4),
      PopupMenuButton<PageLayout>(
        tooltip: l10n.boardLayout,
        icon: const Icon(Icons.format_line_spacing),
        onSelected: onLayout,
        itemBuilder: (_) => [
          for (final l in PageLayout.values) CheckedPopupMenuItem(value: l, checked: page.layout == l, child: Text(_layoutName(l10n, l))),
        ],
      ),
      PopupMenuButton<PageBackground>(
        tooltip: l10n.boardBackground,
        icon: const Icon(Icons.format_color_fill),
        onSelected: onBackground,
        itemBuilder: (_) => [
          for (final b in PageBackground.values)
            CheckedPopupMenuItem(value: b, checked: page.background == b, child: Text(_backgroundName(l10n, b))),
        ],
      ),
    ];
    final surface = tokens.colorSurfaceRaised;
    return Material(
      color: surface,
      elevation: 1,
      child: vertical
          ? SizedBox(
              width: 64,
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(vertical: Spacing.spacing3),
                child: Column(children: children),
              ),
            )
          : SizedBox(
              height: 56,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing3),
                child: Row(children: [for (final c in children) c is Divider ? const VerticalDivider(width: Spacing.spacing4) : c]),
              ),
            ),
    );
  }
}

String _layoutName(L10n l10n, PageLayout l) => switch (l) {
  PageLayout.plain => l10n.boardLayoutPlain,
  PageLayout.ruled => l10n.boardLayoutRuled,
  PageLayout.narrowRuled => l10n.boardLayoutNarrowRuled,
  PageLayout.grid => l10n.boardLayoutGrid,
  PageLayout.arabicLines => l10n.boardLayoutArabicLines,
};

String _backgroundName(L10n l10n, PageBackground b) => switch (b) {
  PageBackground.white => l10n.boardBackgroundWhite,
  PageBackground.cream => l10n.boardBackgroundCream,
  PageBackground.grey => l10n.boardBackgroundGrey,
  PageBackground.green => l10n.boardBackgroundGreen,
  PageBackground.dark => l10n.boardBackgroundDark,
};

class _ZoomControls extends StatelessWidget {
  const _ZoomControls({required this.view});

  final BoardViewController view;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return Material(
      elevation: 2,
      borderRadius: const BorderRadius.all(Radii.radiusLg),
      color: JawwidTokens.of(context).colorSurfaceRaised,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(tooltip: l10n.boardZoomOut, onPressed: () => view.zoomBy(1 / 1.25), icon: const Icon(Icons.zoom_out)),
          IconButton(tooltip: l10n.boardZoomFit, onPressed: view.fit, icon: const Icon(Icons.fit_screen_outlined)),
          IconButton(tooltip: l10n.boardZoomIn, onPressed: () => view.zoomBy(1.25), icon: const Icon(Icons.zoom_in)),
        ],
      ),
    );
  }
}

/// The page strip: thumbnails, and add / duplicate / delete / move a page.
class _PageBar extends ConsumerWidget {
  const _PageBar({required this.state, required this.editable});

  final EditorState state;
  final bool editable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final c = ref.read(boardEditorProvider(state.board.id).notifier);
    final last = state.pages.length - 1;
    return Material(
      color: tokens.colorSurfaceRaised,
      elevation: 2,
      child: SizedBox(
        height: 96,
        child: Row(
          children: [
            Expanded(
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.all(Spacing.spacing3),
                itemCount: state.pages.length,
                separatorBuilder: (_, _) => const SizedBox(width: Spacing.spacing3),
                itemBuilder: (context, i) => Semantics(
                  button: true,
                  selected: i == state.current,
                  label: l10n.boardPageOf('${i + 1}', '${state.pages.length}'),
                  child: InkWell(
                    onTap: () => c.goTo(i),
                    child: Container(
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: i == state.current ? tokens.colorBrandPrimary : tokens.colorBorderSubtle,
                          width: i == state.current ? 3 : 1,
                        ),
                      ),
                      child: Directionality(
                        textDirection: TextDirection.ltr,
                        child: CustomPaint(
                          size: const Size(128, 72),
                          painter: BoardPagePainter(page: state.pages[i]),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Text(l10n.boardPageOf('${state.current + 1}', '${state.pages.length}'), style: Theme.of(context).textTheme.labelMedium),
            if (editable) ...[
              IconButton(
                tooltip: l10n.boardAddPage,
                onPressed: state.pages.length >= 50 ? null : c.addPage,
                icon: const Icon(Icons.note_add_outlined),
              ),
              PopupMenuButton<String>(
                tooltip: l10n.boardMore,
                onSelected: (v) => switch (v) {
                  'duplicate' => c.duplicatePage(),
                  'delete' => c.deletePage(),
                  'earlier' => c.movePage(state.current, state.current - 1),
                  'later' => c.movePage(state.current, state.current + 1),
                  _ => Future<void>.value(),
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: 'duplicate', enabled: state.pages.length < 50, child: Text(l10n.boardDuplicatePage)),
                  PopupMenuItem(value: 'earlier', enabled: state.current > 0, child: Text(l10n.boardMovePageEarlier)),
                  PopupMenuItem(value: 'later', enabled: state.current < last, child: Text(l10n.boardMovePageLater)),
                  PopupMenuItem(value: 'delete', enabled: state.pages.length > 1, child: Text(l10n.boardDeletePage)),
                ],
              ),
            ],
            const SizedBox(width: Spacing.spacing3),
          ],
        ),
      ),
    );
  }
}
