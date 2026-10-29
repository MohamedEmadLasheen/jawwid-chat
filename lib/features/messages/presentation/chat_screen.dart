import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/media/media_picker.dart';
import '../../../core/realtime/chat_signal.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../design/widgets/trial_badge.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/supervision.dart';
import '../../../shared/models/trial.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/search_fold.dart';
import '../../../shared/utils/text_direction.dart';
import '../../calls/application/call_capability.dart';
import '../../calls/application/call_controller.dart';
import '../../calls/application/conversation_calls.dart';
import '../../calls/domain/call_timeline.dart';
import '../../calls/presentation/call_card.dart';
import '../../calls/presentation/calls_actions.dart';
import '../../conversations/application/conversations_controller.dart';
import '../../lessons/domain/lesson_menu.dart';
import '../../lessons/presentation/lesson_ticket_sheet.dart';
import '../../lessons/presentation/teacher_schedule_screen.dart';
import '../../supervision/presentation/supervision_ticket_sheet.dart';
import '../../trials/presentation/trial_report_sheet.dart';
import '../application/drafts_controller.dart';
import '../application/marks_providers.dart';
import '../application/messages_controller.dart';
import '../application/voice_composer_controller.dart';
import '../data/draft_store.dart';
import '../data/message_search_repository.dart';
import '../domain/typing_sender.dart';
import 'attachment_preview.dart';
import 'chat_theme_sheet.dart';
import 'forward_sheet.dart';
import 'media_viewer.dart';
import 'message_actions.dart';
import 'message_bubble.dart';
import 'message_composer.dart';
import 'message_info_sheet.dart';
import 'payment_lock_banner.dart';
import 'pinned_banner.dart';
import 'swipe_to_reply.dart';
import 'teacher_away_banner.dart';

/// One conversation.
///
/// The list is **reversed**, which is what makes the two hard requirements cheap: new
/// messages append at offset zero without disturbing anything the user is reading, and
/// loading older pages extends the far end so scroll position is preserved for free (§19).
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({
    super.key,
    required this.conversationId,
    required this.title,
    this.subtitle,
    this.avatarUrl,
    this.kind = ConversationKind.jawwidSupport,
    this.requiresApproval = false,
    this.isReadOnly = false,
    this.isTeacherSupervision = false,
    this.isTrialGroup = false,
    this.onOpenMembers,
    this.onOpenProfile,
    this.focusMessageId,
    this.conversation,
    this.startVoiceRecording = false,
    this.banner,
    this.onOpenSubscriptions,
  });

  final String conversationId;

  /// PD-30: the locked banner's "Go to Subscriptions", opened at that child. Null hides
  /// the button.
  final ValueChanged<String>? onOpenSubscriptions;

  /// A strip above the thread for something about THIS conversation (PD-20: Sales'
  /// "Join this group" on a trial group). Null for nothing.
  final Widget? banner;

  /// Open at this message (a search hit from the chats list): older history is
  /// loaded until it is on screen, then it is briefly highlighted.
  final String? focusMessageId;

  /// The conversation as the server described it (the route loads it). Needed
  /// to schedule a call from here; without it the header offers no schedule.
  final Conversation? conversation;
  final String title;

  /// e.g. the owner line on the Jawwid thread. Never an internal handler id.
  final String? subtitle;

  /// The header picture: the other person's photo in a 1:1, the child's in a
  /// group about them (a signed link from the server), or null for initials.
  final String? avatarUrl;

  final ConversationKind kind;
  final bool requiresApproval;
  final bool isReadOnly;

  /// PD-12: the teacher's private conversation with the Teachers department. Only here
  /// does "+" ask the server for supervision tickets.
  final bool isTeacherSupervision;

  /// PD-11 T4: the teacher's trial group with Sales. Only here does "+" ask the server
  /// for trial reports.
  final bool isTrialGroup;
  final VoidCallback? onOpenMembers;

  /// Tapping the header — avatar or name — opens the profile, or group info for a
  /// student group. The same gesture people already use in every other chat app.
  final VoidCallback? onOpenProfile;

  /// Start the ordinary voice recorder as soon as the screen is up — the call
  /// screen's "Record voice message". The usual review → send flow follows; a
  /// read-only conversation never starts one.
  final bool startVoiceRecording;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> with WidgetsBindingObserver {
  final _scrollController = ScrollController();

  /// One key per message, so jumping to a reply's original can actually find
  /// the widget. Keyed by the log's own identity — client id where we have one,
  /// server id otherwise — because a message that is still sending has no
  /// server id and a message from another device has no client id of ours.
  final _messageKeys = <String, GlobalKey>{};

  ReplyPreview? _replyingTo;

  /// The message currently tinted after being jumped to, and the timer that
  /// clears it. §6 and §9 both ask for a highlight that is *temporary*: a
  /// permanent one becomes part of the message.
  String? _highlightedKey;

  /// Select mode: the server ids of the chosen messages. Non-empty = selecting.
  final Set<String> _selected = {};
  bool get _selecting => _selected.isNotEmpty;

  void _toggleSelected(Message message) {
    final id = message.id;
    if (id == null || !canActOn(message)) return;
    setState(() {
      if (!_selected.remove(id)) _selected.add(id);
    });
  }
  Timer? _highlightTimer;

  // PD-37: who else is typing here. The server sends typing only between
  // seated members; an indicator not renewed within [_typingShowFor] lapses,
  // so a lost "stopped" cannot leave it up.
  StreamSubscription<TypingSignal>? _typingSub;
  // And what this person says: "typing" while the draft changes (HTTP).
  TypingSender? _typingSender;
  final Map<String, ({String name, DateTime until})> _typers = {};
  Timer? _typersLapse;
  static const _typingShowFor = Duration(seconds: 8);

  /// True when the user has scrolled away from the newest message. While true, arrivals must
  /// not auto-scroll (cross-platform §3).
  bool _isAwayFromBottom = false;
  int _unseenWhileAway = 0;
  int _lastSeenLength = 0;

  /// The highest sequence already reported as read, so the same watermark is
  /// not sent on every rebuild.
  int? _readThrough;

  // --- Search inside this chat (owner decision 2026-10-20) ---
  bool _searching = false;
  final _searchText = TextEditingController();
  Timer? _searchDebounce;
  String _searchedFor = '';
  List<Message> _hits = const [];
  bool _hitsMore = false;
  String? _hitsNextBefore;
  bool _searchLoading = false;
  int _hitIndex = 0;
  bool _focusDone = false;

  /// PD-30: the lock as learned from a refused send (`COMM.SUBSCRIPTION_LOCKED`) --
  /// the group locked after the screen opened. Wins over the conversation's own.
  PaymentLock? _lockFromRefusal;
  bool _lockLookup = false;

  /// What the screen draws for a payment lock: the newest word on it.
  PaymentLock? get _paymentLock => _lockFromRefusal ?? widget.conversation?.paymentLock;
  bool get _lockedForMe => _paymentLock?.readOnly ?? false;

  /// A send was refused because the group is locked: ask the server which child and
  /// why (the conversation says), and draw the banner instead of a failure to retry.
  /// Without an answer the banner still stands, naming no one.
  Future<void> _onLockedRefusal() async {
    if (_lockLookup || _lockFromRefusal != null) return;
    _lockLookup = true;
    final role = ref.read(currentRoleProvider);
    var lock = PaymentLock(readOnly: true, canPay: role == UserRole.parent);
    try {
      final fresh = await ref.read(conversationRepositoryProvider).byId(widget.conversationId);
      final described = fresh.paymentLock;
      if (described != null && described.readOnly) lock = described;
    } catch (_) {
      // The refusal already said enough: the group is locked for this viewer.
    }
    if (!mounted) return;
    // The call capability changed with the lock; ask again.
    ref.invalidate(callCapabilityProvider(widget.conversationId));
    setState(() => _lockFromRefusal = lock);
  }

  /// The term to mark in bubbles while searching.
  String? get _highlightTerm => _searching && isSearchable(_searchedFor) ? _searchedFor : null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController.addListener(_onScroll);
    _typingSub = ref.read(chatTypingChannelProvider)?.signals.listen(_onTyping);
    final typingOut = ref.read(typingRepositoryProvider);
    if (typingOut.isAvailable && !widget.isReadOnly) {
      _typingSender = TypingSender(
        send: (typing) => unawaited(typingOut.typing(widget.conversationId, typing).catchError((Object _) {})),
      );
    }
    // PD-36: opening the chat is seeing its mention; the "@" on the list row goes.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(ref.read(conversationsControllerProvider.notifier).markMentionsSeen(widget.conversationId));
    });
    if (widget.startVoiceRecording && !widget.isReadOnly) {
      // After the frame: the composer that renders the recording is built then,
      // and a provider must not be written during build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final voice = voiceComposerProvider(widget.conversationId);
        unawaited(ref.read(voice.notifier).start());
      });
    }
  }

  /// Report the conversation read up to the newest message on screen.
  ///
  /// Called after the frame rather than during build, because it writes to the
  /// conversations controller — and a provider written to mid-build throws.
  ///
  /// Only while the user is actually at the bottom: someone reading back
  /// through history has not read what arrived above them, and clearing the
  /// badge there would hide the very message they came back for.
  void _reportRead(MessagesState state) {
    if (_isAwayFromBottom) return;
    // PD-37: and only while the app is in front. A chat left open on a phone in
    // a pocket has not "read" what arrives -- it would turn the author's ticks
    // blue. Coming back to the app re-reports (didChangeAppLifecycleState).
    final life = WidgetsBinding.instance.lifecycleState;
    if (life != null && life != AppLifecycleState.resumed) return;

    final newest = state.log.highestSequence;
    if (newest == null) return;
    if (_readThrough != null && newest <= _readThrough!) return;

    _readThrough = newest;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(conversationsControllerProvider.notifier).markRead(
            widget.conversationId,
            throughSequence: newest,
          );
    });
  }

  void _onTyping(TypingSignal signal) {
    if (!mounted || signal.conversationId != widget.conversationId) return;
    // Another device of this same account, typing: not "someone else".
    if (signal.actorId == ref.read(viewerActorIdProvider)?.call()) return;
    setState(() {
      if (signal.typing) {
        _typers[signal.actorId] = (name: signal.displayName, until: AppClock.now().add(_typingShowFor));
      } else {
        _typers.remove(signal.actorId);
      }
    });
    _scheduleTypersLapse();
  }

  void _scheduleTypersLapse() {
    _typersLapse?.cancel();
    if (_typers.isEmpty) return;
    final soonest = _typers.values.map((t) => t.until).reduce((a, b) => a.isBefore(b) ? a : b);
    final wait = soonest.difference(AppClock.now());
    _typersLapse = Timer(wait.isNegative ? Duration.zero : wait, () {
      if (!mounted) return;
      final now = AppClock.now();
      setState(() => _typers.removeWhere((_, t) => !t.until.isAfter(now)));
      _scheduleTypersLapse();
    });
  }

  /// "Omar is typing…", "Omar and Noura are typing…", "3 people are typing…".
  String _typingLine(L10n l10n) {
    final names = _typers.values.map((t) => t.name).toList();
    return switch (names.length) {
      1 => l10n.typingOne(names[0]),
      2 => l10n.typingTwo(names[0], names[1]),
      _ => l10n.typingMany(names.length),
    };
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back in front: rebuild, so the newest message on screen is reported read.
    if (state == AppLifecycleState.resumed && mounted) setState(() {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _typingSender?.dispose();
    // Not awaited: on a broadcast stream a cancel can wait for the stream to close.
    final typingSub = _typingSub;
    if (typingSub != null) unawaited(typingSub.cancel());
    _typersLapse?.cancel();
    _highlightTimer?.cancel();
    _searchDebounce?.cancel();
    _searchText.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;

    // In a reversed list, offset 0 is the newest message.
    final away = _scrollController.offset > 120;
    if (away != _isAwayFromBottom) {
      setState(() {
        _isAwayFromBottom = away;
        if (!away) _unseenWhileAway = 0;
      });
    }

    // Approaching the far end means the user is reaching back in time.
    final position = _scrollController.position;
    if (position.pixels > position.maxScrollExtent - 400) {
      ref
          .read(messagesControllerProvider(widget.conversationId).notifier)
          .loadOlder();
    }
  }

  // --- Sending a photo or a file ---------------------------------------------------------

  /// Pick, review, then send.
  ///
  /// Three steps, and the middle one is not optional (§16). The pick can be
  /// cancelled, refused, or return something too large; the review can be
  /// backed out of. Only the third step enqueues anything, and once it does the
  /// attachment takes the same outbox, idempotency key and retry as a text
  /// message.
  Future<void> _attach() async {
    // PD-11: the lesson tickets the server offers here were prefetched when the
    // chat opened; a fetch still in flight or failed simply offers none.
    // PD-15: one "Lesson report" entry per lesson (its absence is inside it), and
    // only THE relevant lesson of each child here (lessonMenu).
    final lessons = lessonMenu(ref.read(lessonTicketsProvider(widget.conversationId)).value ?? const []);
    // Refetch behind the menu: the next "+" reflects anything another device closed.
    ref.invalidate(lessonTicketsProvider(widget.conversationId));
    final supervision = widget.isTeacherSupervision
        ? ref.read(supervisionTicketsProvider(widget.conversationId)).value ?? SupervisionTickets.none
        : SupervisionTickets.none;
    final trials = widget.isTrialGroup
        ? ref.read(trialTicketsProvider(widget.conversationId)).value ?? const <TrialTicket>[]
        : const <TrialTicket>[];
    if (widget.isTrialGroup) ref.invalidate(trialTicketsProvider(widget.conversationId));
    final choice = await showComposerMenu(
      context,
      tickets: lessons.tickets,
      otherUnreportedLessons: lessons.otherUnreported,
      moreLessons: lessons.more,
      supervisionTickets: supervision.kinds,
      trialTickets: trials,
    );
    if (choice == null || !mounted) return;
    final AttachmentSource source;
    switch (choice) {
      case TicketChoice(:final ticket):
        await _openTicket(ticket);
        return;
      case UnreportedLessonsChoice():
        openScheduleNeedingReport(context, ref);
        return;
      case MoreLessonsChoice(:final tickets):
        final picked = await showMoreLessonTickets(context, tickets);
        if (picked != null && mounted) await _openTicket(picked);
        return;
      case SupervisionChoice(:final kind):
        await _openSupervisionTicket(kind, supervision.learners);
        return;
      case TrialChoice(:final ticket):
        await _openTrialReport(ticket);
        return;
      case AttachmentChoice(source: final picked):
        source = picked;
    }

    final picker = ref.read(mediaPickerProvider);

    final PendingAttachment? picked;
    try {
      picked = switch (source) {
        AttachmentSource.camera => await picker.captureImage(),
        AttachmentSource.photo => await picker.pickImage(),
        AttachmentSource.file => await picker.pickFile(),
      };
    } on MediaPickException catch (failure) {
      if (mounted) _sayPickFailed(failure.reason, source);
      return;
    }

    // Null means the user backed out of the picker. Nothing went wrong, so
    // nothing is said.
    if (picked == null || !mounted) return;

    final draft = await showAttachmentPreview(context, attachment: picked);
    if (draft == null || !mounted) return;

    ref.read(messagesControllerProvider(widget.conversationId).notifier)
        .sendAttachment(
          draft.attachment,
          body: draft.caption,
          replyTo: _replyingTo,
        );

    setState(() => _replyingTo = null);
    if (_isAwayFromBottom) _jumpToNewest();
  }

  /// Open a lesson ticket's form. Its card arrives through the ordinary message path;
  /// the tickets are refetched because the one just used is no longer offered.
  Future<void> _openTicket(LessonTicket ticket) async {
    final sent = await openLessonTicket(context, ticket);
    if (!mounted) return;
    ref.invalidate(lessonTicketsProvider(widget.conversationId));
    if (!sent) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(L10n.of(context).ticketSent)));
    unawaited(ref.read(messagesControllerProvider(widget.conversationId).notifier).refreshLatest());
    if (_isAwayFromBottom) _jumpToNewest();
  }

  /// Open a PD-12 request. Its card arrives through the ordinary message path.
  Future<void> _openSupervisionTicket(SupervisionTicketKind kind, List<SupervisionLearner> learners) async {
    final sent = await showSupervisionTicketSheet(context, kind, learners: learners);
    if (!mounted || !sent) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(L10n.of(context).ticketSent)));
    unawaited(ref.read(messagesControllerProvider(widget.conversationId).notifier).refreshLatest());
    if (_isAwayFromBottom) _jumpToNewest();
  }

  /// Open a PD-11 T4 trial report. Its card arrives through the ordinary message path.
  Future<void> _openTrialReport(TrialTicket ticket) async {
    final sent = await showTrialReportSheet(context, ticket);
    if (!mounted || !sent) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(L10n.of(context).ticketSent)));
    ref.invalidate(trialTicketsProvider(widget.conversationId));
    unawaited(ref.read(messagesControllerProvider(widget.conversationId).notifier).refreshLatest());
    if (_isAwayFromBottom) _jumpToNewest();
  }

  /// Say what went wrong in the user's terms — never the platform's (§31).
  ///
  /// The SOURCE changes two of these sentences and nothing else. A refused
  /// camera and a refused photo library are different permissions with
  /// different switches behind them, and "Jawwid needs permission to open your
  /// photos" is simply untrue after a camera denial — it would send a parent to
  /// the wrong row in Settings. Likewise a device with no camera is not a
  /// device that "can't pick files".
  void _sayPickFailed(MediaPickFailure reason, AttachmentSource source) {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final isCamera = source == AttachmentSource.camera;

    final text = switch (reason) {
      MediaPickFailure.permissionDenied => isCamera
          ? l10n.cameraPermissionDenied
          : l10n.attachmentPermissionDenied,
      MediaPickFailure.tooLarge => l10n.attachmentTooLarge,
      MediaPickFailure.typeNotAllowed => l10n.attachmentTypeNotAllowed,
      MediaPickFailure.unsupported =>
        isCamera ? l10n.cameraUnavailable : l10n.attachmentUnsupported,
      MediaPickFailure.failed => l10n.attachmentPickFailed,
    };

    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(content: Text(text), behavior: SnackBarBehavior.floating),
    );
  }

  // --- Acting on a message ---------------------------------------------------------------

  /// Long press. The sheet decides what was asked for; this decides what to do.
  Future<void> _onLongPress(Message message) async {
    final controller =
        ref.read(messagesControllerProvider(widget.conversationId).notifier);

    final marks = ref.read(messageMarksRepositoryProvider);
    final info = ref.read(receiptRepositoryProvider);
    final result = await showMessageActions(
      context,
      message: message,
      withMarks: marks.isAvailable,
      withInfo: info.isAvailable,
    );
    if (result == null || !mounted) return;

    final reaction = result.reaction;
    if (reaction != null) {
      await _guard(() => controller.toggleReaction(message, reaction.emoji));
      return;
    }

    switch (result.action!) {
      case MessageAction.reply:
        setState(() => _replyingTo = _previewOf(message));
      case MessageAction.forward:
        final id = message.id;
        if (id != null) await _forward([id]);
      case MessageAction.select:
        _toggleSelected(message);
      case MessageAction.star:
        await _guard(() => _mark(message, star: true));
      case MessageAction.pin:
        await _guard(() => _mark(message, star: false));
      case MessageAction.copy:
        await _copy(message);
      case MessageAction.open:
        _openFirstAttachment(message);
      case MessageAction.info:
        await _showInfo(message);
      case MessageAction.deleteForMe:
        await _guard(() => controller.deleteForMe(message));
      case MessageAction.deleteForEveryone:
        await _guard(() => controller.deleteForEveryone(message));
    }
  }

  /// PD-37: who read the viewer's own message, who has it, who does not yet.
  Future<void> _showInfo(Message message) async {
    final id = message.id;
    if (id == null) return;
    final repository = ref.read(receiptRepositoryProvider);
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => MessageInfoSheet(load: repository.info(widget.conversationId, id)),
    );
  }

  /// Pick destinations and forward. The server checks the source is readable
  /// and each destination writable, and copies media; a refusal surfaces
  /// through [_guard].
  Future<void> _forward(List<String> messageIds) async {
    final targets = await showForwardSheet(context);
    if (targets == null || targets.isEmpty || !mounted) return;
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    await _guard(() async {
      await ref.read(messageMarksRepositoryProvider).forward(widget.conversationId, messageIds, targets);
      if (!mounted) return;
      setState(_selected.clear);
      messenger.showSnackBar(SnackBar(
        content: Text(l10n.forwardDone(targets.length)),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ));
    });
  }

  /// The selection bar's bulk actions, over the messages still on screen.
  Future<void> _bulk(MessagesState state, Future<void> Function(Message m) action) async {
    final chosen = state.log.messages.where((m) => m.id != null && _selected.contains(m.id)).toList();
    await _guard(() async {
      for (final m in chosen) {
        await action(m);
      }
    });
    if (mounted) setState(_selected.clear);
  }

  PreferredSizeWidget _selectionBar(MessagesState state) {
    final l10n = L10n.of(context);
    final marks = ref.read(messageMarksRepositoryProvider);
    final controller = ref.read(messagesControllerProvider(widget.conversationId).notifier);
    return AppBar(
      leading: IconButton(
        icon: const Icon(Icons.close),
        tooltip: l10n.cancelSelection,
        onPressed: () => setState(_selected.clear),
      ),
      title: Text(l10n.selectedCount(_selected.length)),
      actions: [
        IconButton(
          icon: const Icon(Icons.forward),
          tooltip: l10n.forwardAction,
          onPressed: () => _forward(_selected.toList()),
        ),
        IconButton(
          icon: const Icon(Icons.star_border),
          tooltip: l10n.starAction,
          onPressed: () => _bulk(state, (m) async {
            if (!m.isStarred) await marks.star(widget.conversationId, m.id!);
          }).then((_) => controller.refreshLatest()),
        ),
        IconButton(
          icon: const Icon(Icons.copy_outlined),
          tooltip: l10n.copyAction,
          onPressed: () async {
            final text = state.log.messages
                .where((m) => m.id != null && _selected.contains(m.id) && m.body.trim().isNotEmpty)
                .map((m) => m.body)
                .join('\n');
            await Clipboard.setData(ClipboardData(text: text));
            if (mounted) setState(_selected.clear);
          },
        ),
        IconButton(
          icon: const Icon(Icons.delete_outline),
          tooltip: l10n.deleteForMeAction,
          onPressed: () => _bulk(state, controller.deleteForMe),
        ),
      ],
    );
  }

  /// Star (private) or pin (for everyone here) -- toggled from the message's
  /// own state -- then re-read the page (the flags) and the pinned bar. The
  /// server decides who may pin; a refusal surfaces through [_guard].
  Future<void> _mark(Message message, {required bool star}) async {
    final id = message.id;
    if (id == null) return;
    final marks = ref.read(messageMarksRepositoryProvider);
    final conversationId = widget.conversationId;
    if (star) {
      await (message.isStarred ? marks.unstar(conversationId, id) : marks.star(conversationId, id));
    } else {
      await (message.isPinned ? marks.unpin(conversationId, id) : marks.pin(conversationId, id));
    }
    if (!mounted) return;
    ref.invalidate(pinnedMessagesProvider(conversationId));
    await ref.read(messagesControllerProvider(conversationId).notifier).refreshLatest();
  }

  /// Copy to the clipboard, and say so without a dialog (§11).
  Future<void> _copy(Message message) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    await Clipboard.setData(ClipboardData(text: message.body));
    if (!mounted) return;

    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(l10n.copiedConfirmation),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Run a controller action that may be refused, and say so if it is.
  ///
  /// Every one of these applies optimistically and rolls back on failure, so a
  /// bubble silently reappearing would read as a bug. The message is the
  /// localised one — never the code, never the status (§31).
  Future<void> _guard(Future<void> Function() action) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    try {
      await action();
    } on AppError catch (error) {
      if (!mounted) return;
      final message = ErrorPresenter.present(error, l10n);
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(
          content: Text(message.body ?? message.title),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// The quote to show in the composer when replying to [message].
  ///
  /// A message with no body — a photo, a voice note — still needs a line here,
  /// or the reply banner is a blank box with a name on it.
  ReplyPreview _previewOf(Message message) {
    final l10n = L10n.of(context);
    final body = message.body.trim();

    return ReplyPreview(
      messageId: message.id ?? message.clientMessageId,
      authorName: message.authorName,
      excerpt: body.isNotEmpty
          ? body
          : switch (message.attachments.firstOrNull?.kind ?? message.kind) {
              MessageKind.image => l10n.attachmentPhotoLabel,
              MessageKind.voice => l10n.attachmentVoiceLabel,
              MessageKind.file || MessageKind.video => l10n.attachmentFileLabel,
              _ => '',
            },
    );
  }

  /// Resolve the quote above a bubble.
  ///
  /// A message we just composed carries its own preview. One that came back
  /// from the server carries only an id, so the original is looked up in the
  /// log — and when it has not been paged in yet, a neutral placeholder stands
  /// in rather than a blank or, worse, the id.
  ReplyPreview? _resolveReply(Message message, MessagesState state) {
    if (message.replyTo != null) return message.replyTo;

    final targetId = message.replyToMessageId;
    if (targetId == null) return null;

    final l10n = L10n.of(context);
    final original = state.log.byServerId(targetId);
    if (original == null) {
      return ReplyPreview(
        messageId: targetId,
        authorName: l10n.replyOriginalUnavailable,
        excerpt: '',
      );
    }
    return _previewOf(original);
  }

  void _onSearchChanged(String text) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () => _runSearch(text.trim()));
    setState(() {});
  }

  Future<void> _runSearch(String query) async {
    if (!mounted) return;
    if (!isSearchable(query)) {
      setState(() {
        _searchedFor = query;
        _hits = const [];
        _hitsMore = false;
        _hitIndex = 0;
      });
      return;
    }
    setState(() => _searchLoading = true);
    MessageSearchPage? page;
    await _guard(() async {
      page = await ref.read(messageSearchRepositoryProvider).searchIn(widget.conversationId, query);
    });
    if (!mounted) return;
    setState(() => _searchLoading = false);
    final found = page;
    // A newer term was typed meanwhile: its own search will answer.
    if (found == null || _searchText.text.trim() != query) return;
    setState(() {
      _searchedFor = query;
      _hits = found.hits;
      _hitsMore = found.nextBefore != null;
      _hitsNextBefore = found.nextBefore;
      _hitIndex = 0;
    });
    final first = found.hits.firstOrNull?.id;
    if (first != null) await _revealMessage(first);
  }

  Future<void> _stepHit(int delta) async {
    if (_hits.isEmpty) return;
    // Older than every match loaded: fetch the next page of matches first.
    if (delta > 0 && _hitIndex >= _hits.length - 1 && _hitsMore && !_searchLoading) {
      final query = _searchedFor;
      setState(() => _searchLoading = true);
      MessageSearchPage? page;
      await _guard(() async {
        page = await ref
            .read(messageSearchRepositoryProvider)
            .searchIn(widget.conversationId, query, before: _hitsNextBefore);
      });
      if (!mounted) return;
      setState(() => _searchLoading = false);
      final more = page;
      if (more == null || _searchedFor != query) return;
      setState(() {
        _hits = [..._hits, ...more.hits];
        _hitsMore = more.nextBefore != null;
        _hitsNextBefore = more.nextBefore;
      });
    }
    final next = (_hitIndex + delta).clamp(0, _hits.length - 1);
    if (next == _hitIndex) return;
    setState(() => _hitIndex = next);
    final id = _hits[next].id;
    if (id != null) await _revealMessage(id);
  }

  void _closeSearch() {
    _searchDebounce?.cancel();
    _searchText.clear();
    setState(() {
      _searching = false;
      _searchedFor = '';
      _hits = const [];
      _hitsMore = false;
      _hitsNextBefore = null;
      _hitIndex = 0;
    });
  }

  /// The viewer's own look for this chat: this session's latest choice, else
  /// what the server said when the chat was opened.
  ChatAppearance get _appearance =>
      ref.watch(chatAppearanceProvider)[widget.conversationId] ??
      (themeKey: widget.conversation?.themeKey, wallpaperUrl: widget.conversation?.wallpaperUrl);

  /// The link the wallpaper was last refreshed for: one fresh fetch per failed
  /// link, so a photo that is really gone cannot loop.
  String? _wallpaperRefreshedFor;

  /// The wallpaper link failed (it is signed and expires 1-2 hours after the
  /// chat was loaded, and the route keeps the chat for the session): read the
  /// chat again for a fresh link.
  Future<void> _refreshWallpaper(String failedUrl) async {
    if (_wallpaperRefreshedFor == failedUrl) return;
    _wallpaperRefreshedFor = failedUrl;
    try {
      final fresh = await ref.read(conversationRepositoryProvider).byId(widget.conversationId);
      // Only a NEW link replaces the failed one. No link from the server (removed
      // elsewhere, or not known yet) changes nothing visible -- a photo that
      // fails already shows the preset -- and never overwrites this session's choice.
      final next = fresh.wallpaperUrl;
      if (!mounted || next == null || next == failedUrl) return;
      // The preset is the viewer's latest choice this session, else the server's.
      final themeKey = ref.read(chatAppearanceProvider)[widget.conversationId]?.themeKey ?? fresh.themeKey;
      ref
          .read(chatAppearanceProvider.notifier)
          .set(widget.conversationId, (themeKey: themeKey, wallpaperUrl: next));
    } catch (_) {
      // Offline or refused: the preset stays, as before.
    }
  }

  void _openTheme() {
    final store = ref.read(chatAppearanceProvider.notifier);
    unawaited(showChatThemeSheet(
      context,
      conversationId: widget.conversationId,
      current: ref.read(chatAppearanceProvider)[widget.conversationId] ??
          (themeKey: widget.conversation?.themeKey, wallpaperUrl: widget.conversation?.wallpaperUrl),
      onChanged: (next) => store.set(widget.conversationId, next),
    ));
  }

  /// Bring a message onto the screen for a search hit, paging back through
  /// older history until it is loaded. Bounded, and only for a hit the user
  /// asked to see -- unlike a reply's original (see [_jumpToMessage]).
  Future<void> _revealMessage(String messageId) async {
    final provider = messagesControllerProvider(widget.conversationId);
    final controller = ref.read(provider.notifier);
    // Bounded twice: pages loaded, and time spent waiting on a load already in
    // flight (a load that never settles must not keep this loop alive).
    var waits = 0;
    for (var page = 0; page < 40 && mounted; page++) {
      final state = ref.read(provider);
      if (state.log.byServerId(messageId) != null) break;
      if (!state.log.hasMoreOlder) return;
      if (state.isLoadingOlder) {
        if (++waits > 200) return; // 10 s
        await Future<void>.delayed(const Duration(milliseconds: 50));
        page--;
        continue;
      }
      await controller.loadOlder();
      if (ref.read(provider).olderError != null) return;
    }
    if (!mounted) return;
    final target = ref.read(provider).log.byServerId(messageId);
    if (target == null) return;
    // The list builds lazily: walk towards older messages until the target's
    // widget exists, then let [_jumpToMessage] centre and highlight it.
    for (var step = 0; step < 80 && mounted; step++) {
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted) return;
      if (_messageKeys[_keyOf(target)]?.currentContext != null) break;
      if (!_scrollController.hasClients) return;
      final position = _scrollController.position;
      if (position.pixels >= position.maxScrollExtent) break;
      _scrollController.jumpTo(
        (position.pixels + position.viewportDimension * 0.8).clamp(0.0, position.maxScrollExtent),
      );
    }
    if (mounted) _jumpToMessage(messageId, ref.read(provider));
  }

  PreferredSizeWidget _searchBar(L10n l10n) {
    final typed = _searchText.text.trim();
    final status = typed.isEmpty
        ? ''
        : !isSearchable(typed)
            ? l10n.searchTooShort
            : _searchLoading && _hits.isEmpty
                ? '…'
                : _hits.isEmpty
                    ? l10n.searchNoMatches
                    : l10n.searchPosition(_hitIndex + 1, '${_hits.length}${_hitsMore ? '+' : ''}');
    return AppBar(
      leading: IconButton(
        icon: const Icon(Icons.close),
        tooltip: l10n.searchClose,
        onPressed: _closeSearch,
      ),
      titleSpacing: 0,
      title: TextField(
        controller: _searchText,
        autofocus: true,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: l10n.searchMessagesHint,
          border: InputBorder.none,
        ),
        onChanged: _onSearchChanged,
        onSubmitted: (_) => _stepHit(1),
      ),
      actions: [
        Center(
          child: Text(status, style: Theme.of(context).textTheme.labelSmall),
        ),
        IconButton(
          icon: const Icon(Icons.keyboard_arrow_up),
          tooltip: l10n.searchOlder,
          onPressed: _hitIndex < _hits.length - 1 || (_hitsMore && !_searchLoading) ? () => _stepHit(1) : null,
        ),
        IconButton(
          icon: const Icon(Icons.keyboard_arrow_down),
          tooltip: l10n.searchNewer,
          onPressed: _hitIndex > 0 ? () => _stepHit(-1) : null,
        ),
      ],
    );
  }

  /// Scroll to a message and tint it briefly.
  ///
  /// Only works for a message already built into the list. Paging backwards
  /// until an arbitrarily old original is found would mean an unbounded number
  /// of requests on a mobile connection for a gesture the user can repeat, so
  /// an original that is not loaded simply does not move the viewport — nothing
  /// jumps, nothing lies.
  void _jumpToMessage(String messageId, MessagesState state) {
    final target = state.log.byServerId(messageId);
    if (target == null) return;

    final key = _messageKeys[_keyOf(target)];
    final targetContext = key?.currentContext;
    if (targetContext == null) return;

    _highlightTimer?.cancel();
    setState(() => _highlightedKey = _keyOf(target));

    Scrollable.ensureVisible(
      targetContext,
      duration: Motion.respecting(context, Motion.motionSlow),
      curve: Motion.easingStandard,
      alignment: 0.3,
    );

    _highlightTimer = Timer(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _highlightedKey = null);
    });
  }

  /// A photo opens here; a document is handed to the phone.
  ///
  /// The split is deliberate. A photo belongs in the conversation's own viewer,
  /// where the parent can swipe between the pictures of that message and come
  /// straight back (§18). A document belongs to whatever already opens
  /// documents on their phone — this app has no viewer and should not grow one.
  Future<void> _openAttachment(Message message, Attachment attachment) async {
    if (attachment.kind == MessageKind.image) {
      final photos = message.attachments
          .where((a) => a.kind == MessageKind.image)
          .toList(growable: false);

      await showMediaViewer(
        context,
        photos: photos,
        initialIndex: photos.indexOf(attachment),
        takenAt: message.createdAt,
      );
      return;
    }

    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final url = attachment.url;

    final opened = url == null
        ? false
        : await ref.read(attachmentOpenerProvider).open(url);

    if (opened || !mounted) return;

    // Nothing on the device could open it, or the signed URL has expired. Both
    // read the same to the parent, and neither is their problem to diagnose.
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(l10n.attachmentPickFailed),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _openFirstAttachment(Message message) {
    final first = message.attachments.firstWhereOrNull(
      (a) => a.kind == MessageKind.image || a.kind == MessageKind.file,
    );
    if (first != null) _openAttachment(message, first);
  }

  /// The log's identity for a message — the same rule [MessageLog] uses.
  static String _keyOf(Message message) => message.clientMessageId.isNotEmpty
      ? message.clientMessageId
      : (message.id ?? '');

  void _jumpToNewest() {
    setState(() {
      _unseenWhileAway = 0;
      _isAwayFromBottom = false;
    });
    _scrollController.animateTo(
      0,
      duration: Motion.respecting(context, Motion.motionBase),
      curve: Motion.easingStandard,
    );
  }

  /// PD-37: this chat's saved draft, for the composer to put back. Watches
  /// only whether the drafts have loaded, so the screen rebuilds once, not on
  /// every keystroke.
  Draft? _savedDraft() {
    if (!ref.watch(draftsProvider.select((d) => d.hasValue))) return null;
    return ref.read(draftsProvider).value?[widget.conversationId];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final controller =
        ref.read(messagesControllerProvider(widget.conversationId).notifier);
    final state = ref.watch(messagesControllerProvider(widget.conversationId));

    // PD-11: prefetch the lesson tickets so "+" opens without a round trip.
    ref.watch(lessonTicketsProvider(widget.conversationId));
    if (widget.isTeacherSupervision) ref.watch(supervisionTicketsProvider(widget.conversationId));
    if (widget.isTrialGroup) ref.watch(trialTicketsProvider(widget.conversationId));

    final voice = ref.watch(voiceComposerProvider(widget.conversationId));
    final voiceController =
        ref.read(voiceComposerProvider(widget.conversationId).notifier);

    // PD-30: a send refused because the group is locked shows the lock, not an error.
    if (!_lockedForMe &&
        state.log.messages.any((m) =>
            m.deliveryState == DeliveryState.failed && m.failureCode == BillingErrors.subscriptionLocked)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_onLockedRefusal());
      });
    }
    final paymentLock = _paymentLock;

    // Count arrivals while the user is reading history, so the pill can say there is
    // something new without ever moving the viewport under them.
    final length = state.log.length;
    if (_isAwayFromBottom && length > _lastSeenLength) {
      _unseenWhileAway += length - _lastSeenLength;
    }
    _lastSeenLength = length;

    _reportRead(state);

    // Opened at a message (a search hit): once the first page is in, go to it.
    final focus = widget.focusMessageId;
    if (focus != null && !_focusDone && !state.isLoadingInitial && !state.log.isEmpty) {
      _focusDone = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _revealMessage(focus);
      });
    }

    return PopScope(
      // Back leaves select mode first, as in every messaging app.
      canPop: !_selecting && !_searching,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (_selecting) {
          setState(_selected.clear);
        } else if (_searching) {
          _closeSearch();
        }
      },
      child: Scaffold(
      appBar: _selecting ? _selectionBar(state) : _searching ? _searchBar(l10n) : AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: widget.onOpenProfile,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing3,
              vertical: Spacing.spacing2,
            ),
            child: Row(
              children: [
                JawwidAvatar(
                  displayName: widget.title,
                  imageUrl: widget.avatarUrl,
                  size: Sizes.avatarSm,
                ),
                const SizedBox(width: Spacing.spacing3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: ContentText(
                              widget.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                          ),
                          // PD-32: a trial group says so beside its name.
                          if (widget.isTrialGroup) ...[
                            const SizedBox(width: Spacing.spacing2),
                            const TrialBadge(),
                          ],
                        ],
                      ),
                      if (widget.subtitle != null)
                        ContentText(
                          widget.subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: tokens.colorTextSecondary),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          // W7: the call affordance. ABSENT unless the server authorizes a call
          // for this conversation, never disabled — `screens/call.md` §4. The
          // answer is advisory and uncached; `POST /calls` decides again.
          // PD-30: a group locked for this viewer offers no call (the server
          // answers canCall:false with COMM.SUBSCRIPTION_LOCKED as well).
          if (!_lockedForMe)
            _CallAction(
              conversationId: widget.conversationId,
              title: widget.title,
              kind: widget.kind,
            ),
          if (ref.watch(messageSearchRepositoryProvider).isAvailable)
            IconButton(
              onPressed: () => setState(() => _searching = true),
              icon: const Icon(Icons.search),
              tooltip: l10n.searchInChat,
            ),
          if (widget.onOpenMembers != null)
            IconButton(
              onPressed: widget.onOpenMembers,
              icon: const Icon(Icons.group_outlined),
              tooltip: l10n.groupMembersTitle,
            ),
          if (widget.conversation != null)
            _ChatMoreMenu(
              conversation: widget.conversation!,
              onOpenTheme: ref.watch(chatThemeRepositoryProvider).isAvailable ? () => _openTheme() : null,
            ),
        ],
      ),
      // The list resizes; the composer does not translate (handoff §5.8).
      resizeToAvoidBottomInset: true,
      body: Column(
        children: [
          if (state.isOffline)
            JawwidBanner(
              message: l10n.messageQueuedOffline,
              tone: JawwidBannerTone.warning,
            ),
          ?widget.banner,
          TeacherAwayBanner(conversationId: widget.conversationId),
          PinnedBanner(
            conversationId: widget.conversationId,
            onJump: (messageId) => _jumpToMessage(messageId, state),
          ),
          Expanded(
            child: ChatBackground(
              appearance: _appearance,
              onPhotoFailed: (url) => unawaited(_refreshWallpaper(url)),
              child: _body(state, controller, l10n),
            ),
          ),
          // PD-37: who else is typing here, just above where this person types.
          if (_typers.isNotEmpty) TypingRow(text: _typingLine(L10n.of(context))),
          // PD-30: locked for payment -- the banner stands where the composer was.
          if (paymentLock != null && paymentLock.readOnly)
            PaymentLockBanner(lock: paymentLock, onOpenSubscriptions: widget.onOpenSubscriptions)
          else
          MessageComposer(
            onAttach: widget.isReadOnly ? null : _attach,
            onSend: (body) {
              controller.send(body, replyTo: _replyingTo);
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
            // PD-36: the @ list asks the server who it would accept here.
            mentionCandidates: ref.read(mentionRepositoryProvider).isAvailable
                ? (query) => ref.read(mentionRepositoryProvider).candidates(widget.conversationId, query)
                : null,
            onSendWithMentions: (body, mentions) {
              controller.send(body, replyTo: _replyingTo, mentions: mentions);
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
            replyingTo: _replyingTo,
            onCancelReply: () => setState(() => _replyingTo = null),
            // PD-37: "typing…" (a read-only chat says nothing), and the unsent
            // text kept as this chat's draft.
            // Keyed by the account: a switch with this chat open starts an
            // empty field with the NEW account's draft, never the last one's text.
            key: ValueKey(('composer', ref.watch(principalIdProvider))),
            initialDraft: _savedDraft(),
            onDraftChanged: _typingSender?.typed,
            onDraft: (draft) => ref.read(draftsProvider.notifier).set(widget.conversationId, draft),
            conversationId: widget.conversationId,
            voice: voice,
            onStartRecording: voiceController.start,
            onStopRecording: voiceController.stop,
            onCancelRecording: voiceController.cancel,
            onDismissVoiceFailure: voiceController.acknowledgeFailure,
            onSendRecording: () {
              // takeDraft() clears the draft as it hands it over, so a second
              // press cannot enqueue the same recording twice.
              final draft = voiceController.takeDraft();
              if (draft == null) return;
              controller.sendVoice(draft, replyTo: _replyingTo);
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
            isReadOnly: widget.isReadOnly,
            requiresApproval: widget.requiresApproval,
          ),
        ],
      ),
      ),
    );
  }

  Widget _body(
    MessagesState state,
    MessagesController controller,
    L10n l10n,
  ) {
    if (state.isLoadingInitial) {
      return JawwidLoadingView(label: l10n.tabChats);
    }

    final failure = state.initialError;
    if (failure != null) {
      final message = ErrorPresenter.present(failure, l10n);
      return JawwidErrorView(
        title: message.title,
        body: message.body,
        retryLabel: message.canRetry ? l10n.retryAction : null,
        onRetry: message.canRetry ? controller.loadInitial : null,
      );
    }

    // W7: the conversation's calls, derived from the authoritative call-history
    // record rather than persisted as system messages (see `call_timeline.dart`).
    // An empty list is the honest answer when calling is not wired or the fetch
    // failed, so the thread renders exactly as it did before.
    final calls = ref
            .watch(conversationCallsProvider(widget.conversationId))
            .asData
            ?.value ??
        const <CallHistoryEntry>[];

    if (state.isEmpty && calls.isEmpty) {
      return JawwidEmptyView(
        title: l10n.messagesEmptyTitle,
        body: l10n.messagesEmptyBody,
        icon: Icons.chat_bubble_outline,
      );
    }

    // Newest first, because the list is reversed.
    final ordered = mergeThread(messages: state.log.messages, calls: calls)
        .reversed
        .toList(growable: false);

    // WhatsApp's rule: wherever more than one other person speaks, each run of
    // their messages carries their picture and name. A group always does; so
    // does a thread that is formally 1:1 with "Jawwid" but answered by several
    // staff, or a trial or supervision chat with more than one colleague in it.
    final showsSenders = widget.kind == ConversationKind.studentGroup ||
        state.log.messages
                .where((m) => !m.isMine && !m.isSystem && m.authorId != null)
                .map((m) => m.authorId)
                .toSet()
                .length >
            1;

    return Stack(
      children: [
        ListView.builder(
          controller: _scrollController,
          reverse: true,
          padding: const EdgeInsets.symmetric(vertical: Spacing.spacing3),
          // Virtualised: only what is on screen is built (handoff §9).
          itemCount: ordered.length + (state.isLoadingOlder ? 1 : 0),
          itemBuilder: (context, index) {
            if (index >= ordered.length) {
              return const Padding(
                padding: EdgeInsets.all(Spacing.spacing5),
                child: Center(
                  child: SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              );
            }

            final item = ordered[index];
            // The *next* index is the older item, because the list is reversed.
            final olderItem = index + 1 < ordered.length ? ordered[index + 1] : null;
            final showDaySeparator =
                olderItem == null || !_sameDay(olderItem.at, item.at);

            // W7: a call is an event in the thread, not a turn in the
            // conversation — no author, no reply, no reaction.
            if (item is CallItem) {
              return Column(
                children: [
                  if (showDaySeparator) _DaySeparator(when: item.at),
                  CallCard(call: item.call),
                ],
              );
            }

            final message = (item as MessageItem).message;
            // Author grouping looks past call cards: two messages from the same
            // person with a call between them are still the same person talking.
            final older = ordered
                .skip(index + 1)
                .whereType<MessageItem>()
                .firstOrNull
                ?.message;

            final fromSomeoneElse =
                showsSenders && !message.isMine && !message.isSystem;
            final showAuthor = fromSomeoneElse &&
                (older == null ||
                    older.authorId != message.authorId ||
                    older.isSystem ||
                    showDaySeparator);

            final key = _keyOf(message);
            final reply = _resolveReply(message, state);

            return Column(
              children: [
                if (showDaySeparator) _DaySeparator(when: message.createdAt),
                // PD-37: swipe toward the trailing side to reply, as on WhatsApp
                // -- never from the leading edge, which is the back gesture's.
                SwipeToReply(
                  enabled: canActOn(message) && !_selecting && !widget.isReadOnly,
                  onReply: () => setState(() => _replyingTo = _previewOf(message)),
                  child: MessageBubble(
                  key: _messageKeys.putIfAbsent(key, GlobalKey.new),
                  message: message,
                  showAuthor: showAuthor,
                  reserveSenderColumn: fromSomeoneElse,
                  replyTo: reply,
                  highlight: _highlightTerm,
                  isHighlighted: _highlightedKey == key ||
                      (message.id != null && _selected.contains(message.id)),
                  onRetry: message.canRetry
                      ? () => controller.retry(message.clientMessageId)
                      : null,
                  onDiscard: message.canRetry
                      ? () => controller.discard(message.clientMessageId)
                      : null,
                  // Absent rather than inert on a message nothing can be done
                  // to, so a long press there is a no-op the user feels once
                  // instead of an empty sheet they have to dismiss.
                  onLongPress: !canActOn(message)
                      ? null
                      : _selecting
                          ? () => _toggleSelected(message)
                          : () => _onLongPress(message),
                  onTap: _selecting ? () => _toggleSelected(message) : null,
                  onTapReply: reply == null
                      ? null
                      : () => _jumpToMessage(reply.messageId, state),
                  onToggleReaction: message.id == null
                      ? null
                      : (emoji) =>
                          _guard(() => controller.toggleReaction(message, emoji)),
                  onOpenAttachment: (attachment) =>
                      _openAttachment(message, attachment),
                  ),
                ),
              ],
            );
          },
        ),
        if (_isAwayFromBottom && _unseenWhileAway > 0)
          PositionedDirectional(
            bottom: Spacing.spacing5,
            start: 0,
            end: 0,
            child: Center(
              child: _NewMessagesPill(
                count: _unseenWhileAway,
                onTap: _jumpToNewest,
              ),
            ),
          ),
      ],
    );
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

/// "New messages ↓" — the user is never scrolled without asking.
class _NewMessagesPill extends StatelessWidget {
  const _NewMessagesPill({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Material(
      color: tokens.colorBrandPrimary,
      borderRadius: const BorderRadius.all(Radii.radiusFull),
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(Radii.radiusFull),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing5,
            vertical: Spacing.spacing3,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // The arrow points to the newest message, which is downward in both
              // directions — this is not a mirroring glyph.
              Icon(Icons.arrow_downward, size: 16, color: tokens.colorBrandOnPrimary),
              const SizedBox(width: Spacing.spacing3),
              Text(
                l10n.unreadCount(count),
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: tokens.colorBrandOnPrimary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DaySeparator extends StatelessWidget {
  const _DaySeparator({required this.when});

  final DateTime when;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Spacing.spacing4),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing4,
            vertical: Spacing.spacing1,
          ),
          decoration: BoxDecoration(
            color: tokens.colorMessageSystemBg,
            borderRadius: const BorderRadius.all(Radii.radiusFull),
          ),
          child: Text(
            RelativeTime.forDaySeparator(
              when,
              AppClock.now(),
              locale: locale,
              todayLabel: l10n.todayLabel,
              yesterdayLabel: l10n.yesterdayLabel,
            ),
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: tokens.colorMessageSystemText),
          ),
        ),
      ),
    );
  }
}

/// The chat's "more" menu: Chat theme (when this build has a theme server) and
/// Schedule call (owner request 2026-10-20: schedule from inside the chat). The
/// latter is offered under the SAME server answer that draws the call button --
/// absent, not disabled, when the viewer may not start a call here (PD-7,
/// non-members). The menu itself is absent when it would be empty.
class _ChatMoreMenu extends ConsumerWidget {
  const _ChatMoreMenu({required this.conversation, this.onOpenTheme});

  final Conversation conversation;

  /// Chat theme (the viewer's own background); null when this build has no theme server.
  final VoidCallback? onOpenTheme;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canSchedule = ref.watch(canCallProvider(conversation.id));
    if (!canSchedule && onOpenTheme == null) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert),
      onSelected: (choice) {
        // The flow asks the server again, opens the sheet, and confirms that
        // the card was posted in this chat.
        if (choice == 'schedule') unawaited(scheduleFlow(context, ref, conversation: conversation));
        if (choice == 'theme') onOpenTheme?.call();
      },
      itemBuilder: (context) => [
        if (onOpenTheme != null)
          PopupMenuItem<String>(
            value: 'theme',
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.palette_outlined),
              title: Text(l10n.chatThemeAction),
            ),
          ),
        if (canSchedule)
          PopupMenuItem<String>(
          value: 'schedule',
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event_outlined),
            title: Text(l10n.callActionSchedule),
          ),
        ),
      ],
    );
  }
}

/// The call affordance in the conversation header (W7).
///
/// ABSENT, NOT DISABLED, wherever the server does not authorize a call —
/// `screens/call.md` §4 — who may call is live server data the client must never
/// infer (PD-7: never a direct teacher<->parent call). Loading, an error and a
/// refusal all render nothing, so there is no state in which this offers a call
/// the server would refuse.
///
/// TAPPING IT IS NOT PERMISSION EITHER. `CallController.start` posts to `/calls`,
/// which decides again from scratch; a relationship revoked between the answer and
/// the tap is refused there and shown as a plain "not available".
class _CallAction extends ConsumerWidget {
  const _CallAction({
    required this.conversationId,
    required this.title,
    required this.kind,
  });

  final String conversationId;

  /// The display name already on the header, reused as the call's label so the
  /// call screen names the same person the thread does. Never an id.
  final String title;

  /// A Student Group call is a group call. Taken from the conversation the header
  /// already describes rather than guessed from the participant count.
  final ConversationKind kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(canCallProvider(conversationId))) {
      return const SizedBox.shrink();
    }

    final l10n = L10n.of(context);
    return IconButton(
      icon: const Icon(Icons.call_outlined),
      tooltip: l10n.callVoice,
      // STARTING IS ALL THIS DOES. It does not navigate: `CallPresenter` watches
      // the controller and puts the call on screen, which is the same path an
      // INCOMING call takes. One navigator for both means a call cannot end up on
      // screen twice, and a header button cannot leave the user on a call screen
      // for a call that was never started.
      onPressed: () => unawaited(
        ref.read(callControllerProvider.notifier).start(
              conversationId: conversationId,
              peerLabel: title,
              isGroup: kind == ConversationKind.studentGroup,
            ),
      ),
    );
  }
}
