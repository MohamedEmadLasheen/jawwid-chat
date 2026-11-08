import 'dart:async';
import 'dart:developer' as developer;
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/media/media_picker.dart';
import '../../../core/orientation/orientation_policy.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../rewards/presentation/reward_tray.dart';
import '../application/board_editor_controller.dart';
import '../application/board_export.dart';
import '../application/board_image_import.dart';
import '../application/boards_controller.dart';
import '../data/board_emoji_font.dart';
import '../data/board_images.dart';
import '../data/quran_text_repository.dart';
import '../data/whiteboards_repository.dart';
import '../domain/board_elements.dart';
import '../domain/board_emoji.dart';
import '../domain/board_page.dart';
import 'board_canvas.dart';
import 'board_painter.dart';
import 'boards_screen.dart';
import 'verse_picker.dart';

/// §10 2a/2b: whether this device edits. Shortest side at least 600 dp
/// (laptops and tablets); phones view. A UX gate, never a security control:
/// the server takes the owner's writes from any device.
///
/// It ships REPORT-ONLY ([kBoardEditGateEnforced] false): it logs what it would
/// decide and blocks nothing, until QA's device and browser matrix
/// (docs/mobile/evidence/pd39/compatibility.md) is signed off.
const bool kBoardEditGateEnforced = false;

/// TEACHER-020: the height of iOS's status-bar strip (points), which takes a touch of its own
/// when the status bar is hidden. The full-screen header stays below it.
const double kIosStatusBarStrip = 20;
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
  /// PD-55 (4): the emoji an emoji stamp places, as last chosen.
  String _emoji = kBoardEmoji.first.emoji[2];
  bool _gateLogged = false;
  /// PD-55: the board takes the whole screen; the tools float, and fold away.
  bool _fullScreen = false;
  bool _toolsOpen = true;
  late final AppLifecycleListener _lifecycle;
  late final BoardEditorController _held;

  @override
  void initState() {
    super.initState();
    _held = ref.read(boardEditorProvider(widget.boardId).notifier);
    // PD-55 (4): the portal's emoji font, fetched once; the pages redraw when it lands.
    boardEmojiFontReady.addListener(_emojiFontChanged);
    unawaited(loadBoardEmojiFont());
    // Going to the background may be the app's last moment: the draft is
    // written and a save is tried (review of #293).
    _lifecycle = AppLifecycleListener(
      onStateChange: (s) {
        if (s == AppLifecycleState.inactive || s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
          // A text being typed is part of the board: finished first, then kept (review of #384).
          _canvas.currentState?.finishTextEdit();
          unawaited(_held.persistNow());
          unawaited(_held.flush());
        }
      },
    );
  }

  void _setFullScreen(bool on) {
    if (_fullScreen == on) return;
    setState(() {
      _fullScreen = on;
      _toolsOpen = true;
    });
    _view.fit();
    _systemBars(hidden: on);
    // LR-39 / PD-55 rev2: only the full-screen board may turn to landscape.
    unawaited(on ? allowBoardFullScreenOrientations() : lockAppOrientation());
  }

  /// The status and navigation bars go with the app bar (a phone or tablet; a browser keeps its own).
  void _systemBars({required bool hidden}) {
    if (kIsWeb) return;
    unawaited(
      hidden
          ? SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky)
          : SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: SystemUiOverlay.values),
    );
  }

  void _emojiFontChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    boardEmojiFontReady.removeListener(_emojiFontChanged);
    if (_fullScreen) {
      _systemBars(hidden: false);
      unawaited(lockAppOrientation());
    }
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
      // In full screen, Back leaves full screen first, then the board.
      canPop: !_fullScreen,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          _setFullScreen(false);
          return;
        }
        _canvas.currentState?.finishTextEdit();
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
    // The verses' texts: fetched once per range, for every page (the strip
    // draws them too); the cache's identity changes when one arrives.
    final versesVersion = ref.watch(verseCacheProvider);
    final verseCache = ref.read(verseCacheProvider.notifier);
    // The board's images: signed with the board, decoded once each (PR-4).
    final imagesVersion = ref.watch(boardImagesProvider(widget.boardId));
    final images = ref.read(boardImagesProvider(widget.boardId).notifier);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      verseCache.ensure(s.pages.expand((p) => p.elements));
      images
        ..seed(s.assets)
        ..ensure(s.pages.expand((p) => p.elements));
    });
    String label(BoardElement e) => switch (e) {
      VerseElement() => switch (verseCache.lookup(e).status) {
        VerseStatus.changed => l10n.boardVerseChanged,
        VerseStatus.unavailable => l10n.boardVerseUnavailable,
        _ => l10n.boardVerseLoading,
      },
      ImageElement() => images.lookup(e.assetId).status == BoardImageStatus.unavailable ? l10n.boardImageUnavailable : l10n.boardImageLoading,
      _ => l10n.boardElementUnknown,
    };
    final canvas = BoardCanvas(
      key: _canvas,
      page: page,
      tool: editable ? _tool : BoardTool.hand,
      style: ToolStyle(color: _color, width: _width, stamp: _stamp, stampText: _stampText(l10n)),
      readOnly: !editable,
      view: _view,
      onCommit: _controller.commit,
      onCommitTo: _controller.commitTo,
      placeholderLabel: label,
      verses: verseCache.lookup,
      versesVersion: versesVersion,
      images: images.lookup,
      imagesVersion: imagesVersion,
    );
    Widget toolPanel(bool vertical) => _ToolPanel(
      vertical: vertical,
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
        _stampColor = _isTextStamp(k) ? BoardPalette.stampGreen : BoardPalette.stampGold;
      }),
      onEmoji: () => _pickEmoji(context),
      emoji: _emoji,
      onDelete: _deleteSelection,
      onVerse: () => _insertVerse(context),
      onRewards: () => _openRewards(context),
      onImage: s.imagesSupported ? () => _insertImage(context) : null,
      onLayout: _controller.setLayout,
      onBackground: _controller.setBackground,
    );
    final banners = <Widget>[
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
    ];
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true): _controller.undo,
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true): _controller.undo,
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true, shift: true): _controller.redo,
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true, shift: true): _controller.redo,
        // PD-55: copy, paste, duplicate. Inside a text being typed, Ctrl/Cmd+C and V
        // are the text's own (handled before these); D is held back here.
        const SingleActivator(LogicalKeyboardKey.keyC, control: true): () => _onSelection((c) => c.copySelection()),
        const SingleActivator(LogicalKeyboardKey.keyC, meta: true): () => _onSelection((c) => c.copySelection()),
        const SingleActivator(LogicalKeyboardKey.keyV, control: true): () => _onSelection((c) => c.paste()),
        const SingleActivator(LogicalKeyboardKey.keyV, meta: true): () => _onSelection((c) => c.paste()),
        const SingleActivator(LogicalKeyboardKey.keyD, control: true): () => _onSelection((c) => c.duplicateSelection()),
        const SingleActivator(LogicalKeyboardKey.keyD, meta: true): () => _onSelection((c) => c.duplicateSelection()),
        const SingleActivator(LogicalKeyboardKey.delete): _deleteSelection,
        const SingleActivator(LogicalKeyboardKey.backspace): _deleteSelection,
        const SingleActivator(LogicalKeyboardKey.escape): () => _canvas.currentState?.clearSelection(),
      },
      child: Focus(
        autofocus: true,
        child: _fullScreen
            ? _fullScreenEditor(context, s, editable: editable, canvas: canvas, banners: banners, tools: toolPanel)
            : Scaffold(
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
                _BoardMenu(
                  onDelete: () => _moveToTrash(context, s),
                  onExportPng: () => _exportPng(context, label),
                  onExportPdf: () => _exportPdf(context, label),
                ),
              ],
            ],
          ),
          body: Column(
            children: [
              ...banners,
              Expanded(
                child: LayoutBuilder(
                  builder: (context, c) {
                    final wide = c.maxWidth >= 700;
                    final tools = editable ? toolPanel(wide) : null;
                    final view = Stack(
                      children: [
                        Positioned.fill(
                          child: ColoredBox(color: JawwidTokens.of(context).colorSurfaceMuted, child: canvas),
                        ),
                        PositionedDirectional(
                          end: Spacing.spacing4,
                          bottom: Spacing.spacing4,
                          child: _ZoomControls(view: _view, onFullScreen: () => _setFullScreen(true)),
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
              _PageBar(
                state: s,
                editable: editable,
                verses: verseCache.lookup,
                versesVersion: versesVersion,
                images: images.lookup,
                imagesVersion: imagesVersion,
                placeholderLabel: label,
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// PD-55: the board on the whole screen. What the app bar and the page strip
  /// held floats over the page: leave full screen, undo and redo, the save
  /// state, and the page. The tools float at the bottom (a phone) or along the
  /// start edge (wider), and fold down to one button.
  Widget _fullScreenEditor(
    BuildContext context,
    EditorState s, {
    required bool editable,
    required Widget canvas,
    required List<Widget> banners,
    required Widget Function(bool vertical) tools,
  }) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final wide = MediaQuery.sizeOf(context).width >= 700;
    final last = s.pages.length - 1;
    final toolsOpen = editable && _toolsOpen;
    final hideTools = IconButton(
      key: const ValueKey('board-hide-tools'),
      tooltip: l10n.boardHideTools,
      onPressed: () => setState(() => _toolsOpen = false),
      icon: const Icon(Icons.expand_more),
    );
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: ColoredBox(color: tokens.colorSurfaceMuted, child: canvas)),
          SafeArea(
            // TEACHER-020: with the status bar hidden (immersive), a device with no notch
            // reports a safe area of 0, and the header's buttons would sit in the top
            // strip where iOS keeps the touch for its own gestures. Keep them below it.
            minimum: EdgeInsets.only(top: defaultTargetPlatform == TargetPlatform.iOS ? kIosStatusBarStrip : 0),
            child: Stack(
              children: [
                PositionedDirectional(
                  top: Spacing.spacing2,
                  start: Spacing.spacing2,
                  end: Spacing.spacing2,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        spacing: Spacing.spacing2,
                        runSpacing: Spacing.spacing2,
                        children: [
                          _Floating(
                            children: [
                              // Back leaves the board itself (the system Back leaves full screen first).
                              if (Navigator.of(context).canPop())
                                BackButton(key: const ValueKey('board-full-screen-back'), onPressed: () => Navigator.of(context).pop()),
                              IconButton(
                                key: const ValueKey('board-exit-full-screen'),
                                tooltip: l10n.boardExitFullScreen,
                                onPressed: () => _setFullScreen(false),
                                icon: const Icon(Icons.fullscreen_exit),
                              ),
                              if (editable) ...[
                                IconButton(tooltip: l10n.boardUndo, onPressed: s.canUndo ? _controller.undo : null, icon: const Icon(Icons.undo)),
                                IconButton(tooltip: l10n.boardRedo, onPressed: s.canRedo ? _controller.redo : null, icon: const Icon(Icons.redo)),
                              ],
                            ],
                          ),
                          _Floating(
                            children: [
                              _SaveChip(status: s.save, readOnly: !s.canEdit),
                              IconButton(
                                tooltip: l10n.boardPreviousPage,
                                onPressed: s.current > 0 ? () => _controller.goTo(s.current - 1) : null,
                                icon: const Icon(Icons.navigate_before),
                              ),
                              Semantics(
                                label: l10n.boardPageOf('${s.current + 1}', '${s.pages.length}'),
                                excludeSemantics: true,
                                child: Text(
                                  key: const ValueKey('board-page-indicator'),
                                  '${s.current + 1} / ${s.pages.length}',
                                  style: Theme.of(context).textTheme.labelLarge,
                                ),
                              ),
                              IconButton(
                                tooltip: l10n.boardNextPage,
                                onPressed: s.current < last ? () => _controller.goTo(s.current + 1) : null,
                                icon: const Icon(Icons.navigate_next),
                              ),
                            ],
                          ),
                        ],
                      ),
                      ...banners,
                    ],
                  ),
                ),
                if (toolsOpen && wide)
                  PositionedDirectional(
                    start: Spacing.spacing2,
                    top: 72,
                    bottom: Spacing.spacing2,
                    child: _Floating(vertical: true, children: [Flexible(child: tools(true)), hideTools]),
                  ),
                if (toolsOpen && !wide)
                  PositionedDirectional(
                    start: Spacing.spacing2,
                    end: Spacing.spacing2,
                    bottom: Spacing.spacing2,
                    child: _Floating(children: [Expanded(child: tools(false)), hideTools]),
                  ),
                if (editable && !toolsOpen)
                  PositionedDirectional(
                    start: Spacing.spacing3,
                    bottom: Spacing.spacing3,
                    child: _Floating(
                      children: [
                        IconButton(
                          key: const ValueKey('board-show-tools'),
                          tooltip: l10n.boardShowTools,
                          onPressed: () => setState(() => _toolsOpen = true),
                          icon: const Icon(Icons.brush_outlined),
                        ),
                      ],
                    ),
                  ),
                PositionedDirectional(
                  end: Spacing.spacing3,
                  bottom: toolsOpen && !wide ? 56 + Spacing.spacing5 : Spacing.spacing3,
                  child: _ZoomControls(view: _view),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static bool _isTextStamp(StampKind k) =>
      const {StampKind.excellentAr, StampKind.wellDoneAr, StampKind.excellentEn, StampKind.wellDoneEn, StampKind.praise}.contains(k);

  String? _stampText(L10n l10n) => switch (_stamp) {
    StampKind.excellentAr || StampKind.excellentEn => l10n.boardStampExcellent,
    StampKind.wellDoneAr || StampKind.wellDoneEn => l10n.boardStampWellDone,
    StampKind.emoji => _emoji,
    _ => null,
  };

  /// PD-55 (4): the emoji picker -- a short, chosen list (kBoardEmoji), in
  /// groups. Choosing one makes the stamp tool place it.
  Future<void> _pickEmoji(BuildContext context) async {
    final picked = await showModalBottomSheet<String>(context: context, showDragHandle: true, builder: (_) => const _EmojiPicker());
    if (picked == null || !mounted) return;
    setState(() {
      _emoji = picked;
      _stamp = StampKind.emoji;
      _tool = BoardTool.stamp;
    });
  }

  double _defaultWidth(BoardTool t) => switch (t) {
    BoardTool.highlighter => 30,
    BoardTool.text => 6,
    _ => _width > 16 ? 6 : _width,
  };

  /// PD-55: the reward tray over the board. A reward lands in the middle of the view.
  void _openRewards(BuildContext context) {
    final canvas = _canvas.currentState;
    if (canvas == null) return;
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (_) => RewardTray(place: canvas.placeStampInView, boardId: widget.boardId, closeOnPlace: true),
      ),
    );
  }

  /// A selection action from a shortcut or the panel -- never while a text is being typed.
  void _onSelection(void Function(BoardCanvasState canvas) act) {
    final c = _canvas.currentState;
    if (c == null || c.isEditingText) return;
    act(c);
  }

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

  /// §4.3: a verse from the shared, verified dataset, as a reference; placed in
  /// the middle of the page, as wide as most of it.
  Future<void> _insertVerse(BuildContext context) async {
    final picked = await pickVerse(context);
    final s = ref.read(boardEditorProvider(widget.boardId)).value;
    if (picked == null || s == null || !mounted) return;
    final page = s.page.size;
    // As wide as most of the page: 1400 on a wide page, the page less its margins on a tall one.
    final width = math.min(1400.0, page.width - 120), size = 64.0;
    final height = verseHeight(picked.text, size, width);
    final verse = VerseElement(
      id: 'v${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}',
      surah: picked.surah,
      fromAyah: picked.from,
      toAyah: picked.to,
      datasetId: picked.text.datasetId,
      rangeSha256: picked.text.rangeSha256,
      rect: Rect.fromLTWH(
        (page.width - width) / 2,
        ((page.height - height) / 2).clamp(24, double.infinity),
        width,
        height,
      ),
      fontSize: size,
      color: _ink,
    );
    ref.read(verseCacheProvider.notifier).remember(verse, picked.text);
    _controller.commit([...s.page.elements, verse]);
  }

  /// PR-4 (§4.4): a picture from the device, checked and uploaded, then placed
  /// in the middle of the page it was started on. Every way it can fail says
  /// so plainly.
  ///
  /// After each await the screen may be gone (the teacher left mid-upload):
  /// `mounted` is checked before `ref` is touched again, and a picture that
  /// is then not placed is let go (review of #328).
  Future<void> _insertImage(BuildContext context) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    void say(String text) => messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
    PreparedImage? prepared;
    try {
      final picked = await ref.read(mediaPickerProvider).pickImage();
      if (picked == null || !mounted) return;
      final startedOn = ref.read(boardEditorProvider(widget.boardId)).value?.page;
      if (startedOn == null) return;
      final pageId = startedOn.id;
      say(l10n.boardImageAdding);
      final bytes = await ref.read(boardImageBytesProvider)(picked.filePath);
      if (!mounted) return;
      prepared = await prepareBoardImage(bytes);
      if (!mounted) return;
      final asset = await uploadBoardImage(ref.read(whiteboardsRepositoryProvider), ref.read(boardUploaderProvider), widget.boardId, prepared);
      if (!mounted) return;
      ref.read(boardImagesProvider(widget.boardId).notifier).remember(asset, prepared.image);
      final placed = prepared;
      prepared = null; // the board's images hold it now
      _controller.addTo(pageId, placeBoardImage(asset.id, placed.width, placed.height, page: startedOn.size));
      messenger.hideCurrentSnackBar();
    } on MediaPickException catch (e) {
      say(switch (e.reason) {
        MediaPickFailure.permissionDenied => l10n.attachmentPermissionDenied,
        MediaPickFailure.tooLarge => l10n.boardImageTooLarge,
        MediaPickFailure.typeNotAllowed => l10n.boardImageNotImage,
        MediaPickFailure.unsupported => l10n.attachmentUnsupported,
        MediaPickFailure.failed => l10n.boardImageFailed,
      });
    } on ImageImportException catch (e) {
      if (e.outcome == ImageImportOutcome.imagesOff && mounted) _controller.imagesOff();
      say(switch (e.outcome) {
        ImageImportOutcome.imagesOff => l10n.boardImageOff,
        ImageImportOutcome.tooLarge => l10n.boardImageTooLarge,
        ImageImportOutcome.notAnImage => l10n.boardImageNotImage,
        _ => l10n.boardImageFailed,
      });
    } on Object {
      say(l10n.boardImageFailed);
    } finally {
      prepared?.image.dispose();
    }
  }

  /// What a page is drawn with, as the editor draws it.
  PageInk _pageInk(String Function(BoardElement) label) => PageInk(
    verses: ref.read(verseCacheProvider.notifier).lookup,
    images: ref.read(boardImagesProvider(widget.boardId).notifier).lookup,
    label: label,
  );

  /// PR-4 (§4.6): the page on screen as a PNG, drawn here and saved here.
  Future<void> _exportPng(BuildContext context, String Function(BoardElement) label) =>
      _export(context, (s) async {
        final ink = _pageInk(label);
        await settleForExport([s.page], ink);
        final png = await renderPagePng(s.page, ink);
        return ref.read(exportSaverProvider)(png, exportName('${s.board.title} ${s.current + 1}', 'png'), 'image/png');
      });

  /// PR-4 (§4.6): every page drawn here, the PDF made by the server from them.
  Future<void> _exportPdf(BuildContext context, String Function(BoardElement) label) =>
      _export(context, (s) async {
        final ink = _pageInk(label);
        await settleForExport(s.pages, ink);
        final pngs = [for (final p in s.pages) await renderPagePng(p, ink)];
        // Closing the editor mid-export lets the export go on the server.
        final pdf = await exportPdf(ref.read(whiteboardsRepositoryProvider), ref.read(boardUploaderProvider), widget.boardId, pngs, cancelled: () => !mounted);
        return ref.read(exportSaverProvider)(pdf, exportName(s.board.title, 'pdf'), 'application/pdf');
      });

  /// One export at a time (review of #335): a second tap while one is drawn
  /// and sent would draw everything twice and take a second worker.
  bool _exporting = false;

  Future<void> _export(BuildContext context, Future<ExportOutcome> Function(EditorState s) run) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    void say(String text) => messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
    if (_exporting) return;
    // Nowhere to save it here: said before a page is drawn or the server asked.
    if (!ref.read(exportHereProvider)) return say(l10n.boardExportNotHere);
    final s = ref.read(boardEditorProvider(widget.boardId)).value;
    if (s == null) return;
    _exporting = true;
    say(l10n.boardExporting);
    ExportOutcome outcome;
    try {
      outcome = await run(s);
    } on ExportException catch (e) {
      outcome = e.outcome;
    } on Object {
      outcome = ExportOutcome.failed;
    } finally {
      _exporting = false;
    }
    if (!mounted) return;
    switch (outcome) {
      case ExportOutcome.cancelled:
        messenger.hideCurrentSnackBar();
      case ExportOutcome.saved:
        say(l10n.boardExportSaved);
      case ExportOutcome.exportsOff:
        say(l10n.boardExportOff);
      case ExportOutcome.busy:
        say(l10n.boardExportBusy);
      case ExportOutcome.inProgress:
        say(l10n.boardExportInProgress);
      case ExportOutcome.expired:
        say(l10n.boardExportExpired);
      case ExportOutcome.tooLarge:
        say(l10n.boardExportTooLarge);
      case ExportOutcome.notHere:
        say(l10n.boardExportNotHere);
      case ExportOutcome.failed:
        say(l10n.boardExportFailed);
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
  const _BoardMenu({required this.onDelete, required this.onExportPng, required this.onExportPdf});

  final VoidCallback onDelete;
  final VoidCallback onExportPng;
  final VoidCallback onExportPdf;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return PopupMenuButton<String>(
      tooltip: l10n.boardMore,
      itemBuilder: (_) => [
        PopupMenuItem(value: 'png', child: Text(l10n.boardExportPng)),
        PopupMenuItem(value: 'pdf', child: Text(l10n.boardExportPdf)),
        const PopupMenuDivider(),
        PopupMenuItem(value: 'delete', child: Text(l10n.boardsDelete)),
      ],
      onSelected: (v) => switch (v) {
        'png' => onExportPng(),
        'pdf' => onExportPdf(),
        'delete' => onDelete(),
        _ => null,
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
    required this.onEmoji,
    required this.emoji,
    required this.onDelete,
    required this.onVerse,
    required this.onRewards,
    required this.onImage,
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

  /// PD-55 (4): opens the emoji picker; [emoji] is the one last chosen.
  final VoidCallback onEmoji;
  final String emoji;
  final VoidCallback onDelete;
  final VoidCallback onVerse;

  /// PD-55: the reward tray.
  final VoidCallback onRewards;
  /// Null where the server has no images (or said they are off): no button.
  final VoidCallback? onImage;
  final ValueChanged<PageLayout> onLayout;
  final ValueChanged<PageBackground> onBackground;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    Widget toolButton(BoardTool t, IconData icon, String label) =>
        _KidToolButton(tooltip: label, icon: icon, tint: _toolTint(t), selected: tool == t, onPressed: () => onTool(t));
    Widget swatch(Color c, String label) => Semantics(
      button: true,
      selected: c == color,
      label: label,
      child: Tooltip(
        message: label,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: () => onColor(c),
          // PD-55 Phase 1 (2): a big round drop of the colour; the chosen one has a tick.
          child: AnimatedContainer(
            duration: Motion.respecting(context, Motion.motionFast),
            width: 36,
            height: 36,
            margin: const EdgeInsets.all(Spacing.spacing2),
            decoration: BoxDecoration(
              color: c,
              shape: BoxShape.circle,
              border: Border.all(color: c == color ? tokens.colorBrandPrimary : tokens.colorBorderDefault, width: c == color ? 3 : 1),
            ),
            child: c == color ? Icon(Icons.check_rounded, size: 20, color: c.computeLuminance() > 0.5 ? BoardPalette.ink : BoardPalette.onTool) : null,
          ),
        ),
      ),
    );
    final widths = tool == BoardTool.highlighter ? const [18.0, 30.0, 44.0] : const [3.0, 6.0, 10.0, 16.0];
    final children = <Widget>[
      toolButton(BoardTool.select, Icons.near_me_rounded, l10n.boardToolSelect),
      toolButton(BoardTool.hand, Icons.pan_tool_rounded, l10n.boardToolHand),
      toolButton(BoardTool.pen, Icons.edit_rounded, l10n.boardToolPen),
      toolButton(BoardTool.highlighter, Icons.border_color_rounded, l10n.boardToolHighlighter),
      toolButton(BoardTool.eraser, Icons.cleaning_services_rounded, l10n.boardToolEraser),
      toolButton(BoardTool.areaEraser, Icons.auto_fix_normal_rounded, l10n.boardToolAreaEraser),
      toolButton(BoardTool.text, Icons.text_fields_rounded, l10n.boardToolText),
      toolButton(BoardTool.rect, Icons.crop_square_rounded, l10n.boardToolRect),
      toolButton(BoardTool.ellipse, Icons.circle_outlined, l10n.boardToolEllipse),
      toolButton(BoardTool.triangle, Icons.change_history_rounded, l10n.boardToolTriangle),
      toolButton(BoardTool.line, Icons.horizontal_rule_rounded, l10n.boardToolLine),
      toolButton(BoardTool.arrow, Icons.arrow_right_alt_rounded, l10n.boardToolArrow),
      toolButton(BoardTool.stamp, Icons.star_rounded, l10n.boardToolStamp),
      toolButton(BoardTool.laser, Icons.highlight_rounded, l10n.boardToolLaser),
      _KidToolButton(tooltip: l10n.boardToolVerse, icon: Icons.menu_book_rounded, tint: BoardPalette.toolInsert, onPressed: onVerse),
      if (onImage != null) _KidToolButton(tooltip: l10n.boardToolImage, icon: Icons.image_rounded, tint: BoardPalette.toolInsert, onPressed: onImage),
      // PD-55: after the inserts, so nothing PD-39 placed moves; the floating dock (PR-6) regroups.
      _KidToolButton(
        key: const ValueKey('board-rewards'),
        tooltip: l10n.rewardTrayTitle,
        icon: Icons.emoji_events_rounded,
        tint: BoardPalette.toolReward,
        onPressed: onRewards,
      ),
      const Divider(height: Spacing.spacing4),
      if (tool == BoardTool.highlighter) ...[
        swatch(BoardPalette.highlighter, l10n.boardToolHighlighter),
        swatch(BoardPalette.tajweedMadd, l10n.boardTajweedMadd),
        swatch(BoardPalette.tajweedGhunnah, l10n.boardTajweedGhunnah),
        swatch(BoardPalette.tajweedIkhfa, l10n.boardTajweedIkhfa),
        swatch(BoardPalette.tajweedIzhar, l10n.boardTajweedIzhar),
      ] else if (tool == BoardTool.stamp) ...[
        // PD-39's own stamps; PD-55's stickers and praise live in the reward tray.
        // PD-55 (4): the emoji picker first, then PD-39's stamps and the reward
        // stickers -- icons only, generic encouragement, no faces.
        IconButton(
          key: const ValueKey('board-emoji'),
          isSelected: stamp == StampKind.emoji,
          tooltip: l10n.boardEmoji,
          onPressed: onEmoji,
          icon: Text(emoji, style: const TextStyle(fontFamily: kIsWeb ? kBoardEmojiFont : null, fontSize: 22, height: 1)),
        ),
        for (final k in const [
          StampKind.star,
          StampKind.check,
          StampKind.heart,
          StampKind.thumbsUp,
          StampKind.medal,
          StampKind.trophy,
          StampKind.rocket,
          StampKind.sun,
          StampKind.rainbow,
          StampKind.crown,
          StampKind.balloon,
          StampKind.excellentAr,
          StampKind.wellDoneAr,
        ])
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
          // PD-55 Phase 1 (2): a dot as fat as the line it draws.
          IconButton(
            tooltip: l10n.boardThickness,
            isSelected: width == w,
            onPressed: () => onWidth(w),
            icon: AnimatedContainer(
              duration: Motion.respecting(context, Motion.motionFast),
              width: (w * 0.75).clamp(6, 26),
              height: (w * 0.75).clamp(6, 26),
              decoration: BoxDecoration(color: width == w ? _toolTint(tool) : tokens.colorTextSecondary, shape: BoxShape.circle),
            ),
          ),
      ],
      if (tool == BoardTool.select)
        _KidToolButton(tooltip: l10n.boardDeleteSelection, icon: Icons.delete_rounded, tint: BoardPalette.toolErase, onPressed: onDelete),
      const Divider(height: Spacing.spacing4),
      PopupMenuButton<PageLayout>(
        tooltip: l10n.boardLayout,
        icon: const Icon(Icons.format_line_spacing),
        onSelected: onLayout,
        itemBuilder: (_) => [
          // PD-55: as pictures, the four a teacher reaches for first, then the rest.
          for (final l in _layoutOrder)
            PopupMenuItem(
              value: l,
              child: Semantics(
                selected: page.layout == l,
                child: Row(
                  children: [
                    SizedBox(width: 24, child: page.layout == l ? const Icon(Icons.check, size: 20) : null),
                    const SizedBox(width: Spacing.spacing2),
                    KeyedSubtree(
                      key: ValueKey('layout-thumb-${l.wire}'),
                      child: _LayoutThumbnail(layout: l, background: page.background),
                    ),
                    const SizedBox(width: Spacing.spacing3),
                    Flexible(child: Text(_layoutName(l10n, l))),
                  ],
                ),
              ),
            ),
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

/// PD-55 Phase 1 (2): each tool's colour, by what it does.
Color _toolTint(BoardTool t) => switch (t) {
  BoardTool.select || BoardTool.hand => BoardPalette.toolMove,
  BoardTool.pen || BoardTool.highlighter => BoardPalette.toolDraw,
  BoardTool.eraser || BoardTool.areaEraser => BoardPalette.toolErase,
  BoardTool.text => BoardPalette.toolText,
  BoardTool.stamp => BoardPalette.toolReward,
  BoardTool.laser => BoardPalette.toolPoint,
  _ => BoardPalette.toolShape,
};

/// PD-55 Phase 1 (2): a tool for small hands -- a big rounded square (48 pt to touch),
/// a light wash of its colour; chosen, it fills with that colour, its icon turns
/// white and it grows a little (not with "reduce motion"). Same tooltip, same
/// semantics as before: tests and screen readers find it as they did.
class _KidToolButton extends StatelessWidget {
  const _KidToolButton({super.key, required this.tooltip, required this.icon, required this.tint, required this.onPressed, this.selected});

  final String tooltip;
  final IconData icon;
  final Color tint;
  final VoidCallback? onPressed;

  /// Null for an action (insert a verse, open the rewards), which is never "chosen".
  final bool? selected;

  @override
  Widget build(BuildContext context) {
    final on = selected ?? false;
    final tokens = JawwidTokens.of(context);
    // A 44 pt tile in a 48 pt touch target: the panel keeps PD-39's 48 pt rhythm, so
    // nothing below moves further down, and the tiles have air between them.
    return AnimatedScale(
      scale: on ? 1.08 : 1,
      duration: Motion.respecting(context, Motion.motionFast),
      curve: Motion.easingStandard,
      child: IconButton(
        tooltip: tooltip,
        isSelected: selected,
        onPressed: onPressed,
        style: IconButton.styleFrom(
          fixedSize: const Size.square(44),
          tapTargetSize: MaterialTapTargetSize.padded,
          backgroundColor: on ? tint : tint.withValues(alpha: 0.12),
          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radii.radiusLg)),
        ),
        icon: Icon(icon, size: 26, color: on ? BoardPalette.onTool : tokens.colorTextPrimary),
      ),
    );
  }
}

const _layoutOrder = [
  PageLayout.plain,
  PageLayout.arabicLines,
  PageLayout.grid,
  PageLayout.dotted,
  PageLayout.ruled,
  PageLayout.narrowRuled,
];

/// PD-55 (4): the emoji picker -- kBoardEmoji in its groups, a tap answers one.
class _EmojiPicker extends StatelessWidget {
  const _EmojiPicker();

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    String name(String key) => switch (key) {
      'smileys' => l10n.boardEmojiSmileys,
      'animals' => l10n.boardEmojiAnimals,
      'nature' => l10n.boardEmojiNature,
      'food' => l10n.boardEmojiFood,
      'school' => l10n.boardEmojiSchool,
      _ => l10n.boardEmojiSymbols,
    };
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.6),
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing2),
          children: [
            Text(l10n.boardEmojiPick, style: Theme.of(context).textTheme.titleMedium),
            for (final g in kBoardEmoji) ...[
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing4, bottom: Spacing.spacing2),
                child: Text(name(g.key), style: Theme.of(context).textTheme.labelLarge),
              ),
              Wrap(
                spacing: Spacing.spacing2,
                runSpacing: Spacing.spacing2,
                children: [
                  for (final e in g.emoji)
                    Semantics(
                      button: true,
                      label: e,
                      child: InkWell(
                        key: ValueKey('emoji-$e'),
                        borderRadius: const BorderRadius.all(Radii.radiusMd),
                        onTap: () => Navigator.of(context).pop(e),
                        child: SizedBox.square(
                          dimension: 52,
                          child: Center(
                            child: Text(e, style: const TextStyle(fontFamily: kIsWeb ? kBoardEmojiFont : null, fontSize: 32, height: 1)),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// PD-55: a page layout in miniature, drawn by the same painter as the page.
class _LayoutThumbnail extends StatelessWidget {
  const _LayoutThumbnail({required this.layout, required this.background});

  final PageLayout layout;
  final PageBackground background;

  @override
  Widget build(BuildContext context) => Container(
    width: 64,
    height: 36,
    decoration: BoxDecoration(border: Border.all(color: JawwidTokens.of(context).colorBorderDefault)),
    child: CustomPaint(painter: _LayoutThumbnailPainter(layout, background)),
  );
}

class _LayoutThumbnailPainter extends CustomPainter {
  _LayoutThumbnailPainter(this.layout, this.background);

  final PageLayout layout;
  final PageBackground background;

  @override
  void paint(Canvas canvas, Size size) {
    // A quarter of the page at a larger scale, so the rulings can be told apart.
    canvas
      ..save()
      ..clipRect(Offset.zero & size)
      ..scale(size.width * 2 / kBoardPageSize.width);
    paintBackground(canvas, layout, background);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_LayoutThumbnailPainter old) => old.layout != layout || old.background != background;
}

String _layoutName(L10n l10n, PageLayout l) => switch (l) {
  PageLayout.plain => l10n.boardLayoutPlain,
  PageLayout.ruled => l10n.boardLayoutRuled,
  PageLayout.narrowRuled => l10n.boardLayoutNarrowRuled,
  PageLayout.grid => l10n.boardLayoutGrid,
  PageLayout.arabicLines => l10n.boardLayoutArabicLines,
  PageLayout.dotted => l10n.boardLayoutDotted,
};

String _backgroundName(L10n l10n, PageBackground b) => switch (b) {
  PageBackground.white => l10n.boardBackgroundWhite,
  PageBackground.cream => l10n.boardBackgroundCream,
  PageBackground.grey => l10n.boardBackgroundGrey,
  PageBackground.green => l10n.boardBackgroundGreen,
  PageBackground.dark => l10n.boardBackgroundDark,
};

/// PD-55: a group of controls floating over the full-screen board.
class _Floating extends StatelessWidget {
  const _Floating({required this.children, this.vertical = false});

  final List<Widget> children;
  final bool vertical;

  @override
  Widget build(BuildContext context) => Material(
    elevation: 3,
    borderRadius: const BorderRadius.all(Radii.radiusLg),
    clipBehavior: Clip.antiAlias,
    color: JawwidTokens.of(context).colorSurfaceRaised,
    child: Padding(
      padding: const EdgeInsets.all(Spacing.spacing1),
      child: vertical ? Column(mainAxisSize: MainAxisSize.min, children: children) : Row(mainAxisSize: MainAxisSize.min, children: children),
    ),
  );
}


class _ZoomControls extends StatelessWidget {
  const _ZoomControls({required this.view, this.onFullScreen});

  final BoardViewController view;
  /// PD-55: where the board can go full screen (null once it is).
  final VoidCallback? onFullScreen;

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
          if (onFullScreen != null) IconButton(tooltip: l10n.boardFullScreen, onPressed: onFullScreen, icon: const Icon(Icons.fullscreen)),
        ],
      ),
    );
  }
}

/// The page strip: thumbnails, and add / duplicate / delete / move a page.
class _PageBar extends ConsumerWidget {
  const _PageBar({
    required this.state,
    required this.editable,
    this.verses,
    this.versesVersion,
    this.images,
    this.imagesVersion,
    this.placeholderLabel,
  });

  final EditorState state;
  final bool editable;
  final VerseSource? verses;
  final Object? versesVersion;
  final BoardImageSource? images;
  final Object? imagesVersion;
  final String Function(BoardElement element)? placeholderLabel;

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
                          // Each page in its own frame: 16:9, or 9:16 when tall (PD-55).
                          size: Size(72 * state.pages[i].size.width / state.pages[i].size.height, 72),
                          painter: BoardPagePainter(
                            page: state.pages[i],
                            verses: verses,
                            versesVersion: versesVersion,
                            images: images,
                            imagesVersion: imagesVersion,
                            placeholderLabel: placeholderLabel,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Text(l10n.boardPageOf('${state.current + 1}', '${state.pages.length}'), style: Theme.of(context).textTheme.labelMedium),
            if (editable) ...[
              // PD-55: a new page is wide or tall; its shape is for good.
              PopupMenuButton<PageShape>(
                tooltip: l10n.boardAddPage,
                enabled: state.pages.length < 50,
                icon: const Icon(Icons.note_add_outlined),
                onSelected: (shape) => c.addPage(shape: shape),
                itemBuilder: (_) => [
                  PopupMenuItem(
                    value: PageShape.wide,
                    child: ListTile(leading: const Icon(Icons.crop_landscape), title: Text(l10n.boardWidePage)),
                  ),
                  PopupMenuItem(
                    value: PageShape.tall,
                    child: ListTile(leading: const Icon(Icons.crop_portrait), title: Text(l10n.boardTallPage)),
                  ),
                ],
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
