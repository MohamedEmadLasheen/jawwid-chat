import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/app_clock.dart';
import 'lesson_ticket_sheet.dart';
import 'slot_chip_picker.dart';

/// PD-31: "Change lesson time" -- one entry per child, for the family and the teacher.
/// It asks first: **this lesson only**, or **every week**.
///
/// * This lesson only: pick an upcoming lesson, then a free time. Instant, before the
///   lesson starts; it is neither an apology nor a violation. The server keeps the
///   family's limits (one move per lesson, a few a month, not too close to the start)
///   and says which one refused, before anything is picked.
/// * Every week: the child's current weekly times as cards; change, remove or add one,
///   and say from when. A request -- the supervision team confirms it.
///
/// Who may do either is the server's answer: the ticket is offered by it, and each
/// write is decided again.
Future<bool> showChangeLessonTimeSheet(BuildContext context, LessonTicket ticket) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => ChangeLessonTimeSheet(ticket: ticket),
  );
  return sent == true;
}

/// How far ahead "this lesson only" lists the child's lessons.
const changeTimeWindow = Duration(days: 28);

enum _Step { scope, lessons, slots, weekly }

class ChangeLessonTimeSheet extends ConsumerStatefulWidget {
  const ChangeLessonTimeSheet({super.key, required this.ticket});

  final LessonTicket ticket;

  @override
  ConsumerState<ChangeLessonTimeSheet> createState() => _ChangeLessonTimeSheetState();
}

class _ChangeLessonTimeSheetState extends ConsumerState<ChangeLessonTimeSheet> {
  _Step _step = _Step.scope;
  bool _sending = false;
  String? _error;

  // This lesson only.
  List<ScheduledLesson>? _lessons;
  ScheduledLesson? _lesson;
  MoveOffer? _offer;
  DateTime? _picked;
  Object? _loadError;

  // Every week.
  ScheduleOptions? _weekly;
  final _replaced = <WeeklyKey, WeeklyOption>{};
  final _removed = <WeeklyKey>{};
  final _added = <WeeklyOption>[];

  /// The weekly picker is open: for the current time [_editing] replaces, or to add one.
  WeeklyKey? _editing;
  bool _adding = false;
  int _fromWeek = 0;
  final _note = TextEditingController();

  String get _learnerId => widget.ticket.learnerId;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _go(_Step step) => setState(() {
        _step = step;
        _error = null;
        _loadError = null;
      });

  // ------------------------------------------------------------------
  // This lesson only
  // ------------------------------------------------------------------

  Future<void> _loadLessons() async {
    _go(_Step.lessons);
    setState(() => _lessons = null);
    try {
      final now = DateTime.now();
      final all = await ref.read(lessonRepositoryProvider).learnerLessons(_learnerId, now, now.add(changeTimeWindow));
      if (!mounted) return;
      setState(() => _lessons = [
            for (final l in all..sort((a, b) => a.startsAt.compareTo(b.startsAt)))
              if (l.outcome == null && l.startsAt.isAfter(now)) l,
          ]);
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  Future<void> _pickLesson(ScheduledLesson lesson) async {
    _lesson = lesson;
    _go(_Step.slots);
    await _loadOffer();
  }

  Future<void> _loadOffer() async {
    setState(() {
      _offer = null;
      _picked = null;
      _loadError = null;
    });
    try {
      final offer = await ref.read(lessonRepositoryProvider).moveSlots(_lesson!.id);
      if (mounted) setState(() => _offer = offer);
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  Future<void> _move() async {
    final picked = _picked;
    if (picked == null || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(lessonRepositoryProvider).moveLesson(_lesson!.id, picked);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final l10n = L10n.of(context);
      // Show what is true now: a refusal (a limit, the lesson started, paused lessons)
      // explains itself once reloaded; a time no longer offered was just taken.
      await _loadOffer();
      if (!mounted) return;
      final offer = _offer;
      setState(() {
        _sending = false;
        _error = offer == null || offer.refusal != null || offer.isLocked
            ? (offer == null ? ticketErrorText(l10n, e) : null)
            : (offer.slots.any((s) => s.isAtSameMomentAs(picked)) ? ticketErrorText(l10n, e) : l10n.changeTimeTaken);
      });
    }
  }

  // ------------------------------------------------------------------
  // Every week
  // ------------------------------------------------------------------

  Future<void> _loadWeekly() async {
    _go(_Step.weekly);
    setState(() => _weekly = null);
    try {
      final options = await ref.read(lessonRepositoryProvider).scheduleOptions(_learnerId);
      if (mounted) setState(() => _weekly = options);
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  bool get _changed => _replaced.isNotEmpty || _removed.isNotEmpty || _added.isNotEmpty;

  /// The FULL new weekly set: what is kept, what replaces, what is added.
  List<WeeklyKey> get _newSet => [
        for (final c in _weekly?.current ?? const <GroupChildSlot>[])
          if (!_removed.contains(c.key)) _replaced[c.key]?.key ?? c.key,
        for (final a in _added) a.key,
      ];

  /// The first lesson the change touches: the next of a time that changes or stops,
  /// else the next of a time that is added. "From" is offered from it, a week apart.
  DateTime? get _anchor {
    final touched = [
      for (final c in _weekly?.current ?? const <GroupChildSlot>[])
        if ((_replaced.containsKey(c.key) || _removed.contains(c.key)) && c.nextStartsAt != null) c.nextStartsAt!,
    ];
    final candidates = touched.isNotEmpty ? touched : [for (final a in _added) a.nextStartsAt];
    if (candidates.isEmpty) return null;
    return candidates.reduce((a, b) => a.isBefore(b) ? a : b);
  }

  DateTime? get _from => _anchor?.add(Duration(days: 7 * _fromWeek));

  void _pickWeekly(WeeklyOption o) => setState(() {
        if (_editing != null) {
          _replaced[_editing!] = o;
          _removed.remove(_editing);
        } else {
          _added.add(o);
        }
        _editing = null;
        _adding = false;
        _fromWeek = 0;
      });

  Future<void> _sendWeekly() async {
    final from = _from;
    if (!_changed || _newSet.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final note = _note.text.trim();
      await ref.read(lessonRepositoryProvider).requestScheduleChange(
            _learnerId,
            _newSet,
            effectiveFrom: from == null ? null : teacherDate(from, _weekly?.timezone),
            note: note.isEmpty ? null : note,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = ticketErrorText(L10n.of(context), e);
      });
    }
  }

  // ------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final body = switch (_step) {
      _Step.scope => _scope(context),
      _Step.lessons => _lessonList(context),
      _Step.slots => _slots(context),
      _Step.weekly => _weeklyBody(context),
    };
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  if (_step != _Step.scope)
                    IconButton(
                      key: const ValueKey('change-time-back'),
                      tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                      onPressed: _sending
                          ? null
                          : () => _step == _Step.slots ? _go(_Step.lessons) : _go(_Step.scope),
                      icon: const BackButtonIcon(),
                    ),
                  Expanded(child: Text(l10n.ticketChangeLessonTime, style: theme.textTheme.titleLarge)),
                ],
              ),
              if (widget.ticket.learnerName.isNotEmpty)
                Text(
                  l10n.ticketFor(widget.ticket.learnerName),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              const SizedBox(height: Spacing.spacing4),
              body,
              if (_error != null) ...[
                const SizedBox(height: Spacing.spacing2),
                Text(_error!, key: const ValueKey('change-time-error'), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _loading() =>
      const Center(child: Padding(padding: EdgeInsets.all(Spacing.spacing5), child: CircularProgressIndicator()));

  Widget _scope(BuildContext context) {
    final l10n = L10n.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        _ScopeChoice(
          key: const ValueKey('change-scope-once'),
          icon: Icons.event_outlined,
          title: l10n.changeTimeOnce,
          subtitle: l10n.changeTimeOnceHint,
          onTap: _loadLessons,
        ),
        const SizedBox(height: Spacing.spacing3),
        _ScopeChoice(
          key: const ValueKey('change-scope-weekly'),
          icon: Icons.event_repeat_outlined,
          title: l10n.changeTimeWeekly,
          subtitle: l10n.changeTimeWeeklyHint,
          onTap: _loadWeekly,
        ),
      ],
    );
  }

  Widget _lessonList(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final lessons = _lessons;
    if (_loadError != null) return Text(l10n.ticketLoadFailed, style: theme.textTheme.bodyMedium);
    if (lessons == null) return _loading();
    if (lessons.isEmpty) return Text(l10n.changeTimeNoLessons, style: theme.textTheme.bodyMedium);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.changeTimePickLesson, style: theme.textTheme.labelLarge),
        for (final l in lessons)
          ListTile(
            key: ValueKey('move-lesson-${l.id}'),
            contentPadding: EdgeInsets.zero,
            leading: Icon(l.kind == 'makeup' ? Icons.event_repeat_outlined : Icons.event_outlined),
            title: Text(lessonWhen(context, l.startsAt)),
            subtitle: l.kind == 'makeup' ? Text(l10n.lessonKindMakeup) : null,
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _pickLesson(l),
          ),
      ],
    );
  }

  Widget _slots(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final lesson = _lesson!;
    final offer = _offer;
    final refusal = offer == null ? null : moveRefusalText(l10n, offer.refusal);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.changeTimeCurrent(lessonWhen(context, lesson.startsAt)), style: theme.textTheme.bodyMedium),
        if (offer?.familyMovesLeft case final left?)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.spacing1),
            child: Text(l10n.changeTimeMovesLeft(left), key: const ValueKey('moves-left'), style: theme.textTheme.bodySmall),
          ),
        const SizedBox(height: Spacing.spacing4),
        if (_loadError != null)
          Text(l10n.ticketLoadFailed, style: theme.textTheme.bodyMedium)
        else if (offer == null)
          _loading()
        else if (refusal != null && !offer.isLocked)
          Text(refusal, key: const ValueKey('move-refusal'), style: theme.textTheme.bodyMedium)
        else
          SlotChipPicker(
            keyPrefix: 'move',
            slots: offer.slots,
            locked: offer.isLocked,
            selected: _picked,
            onSelected: (t) => setState(() {
              _picked = t;
              _error = null;
            }),
          ),
        if (_picked != null) ...[
          const SizedBox(height: Spacing.spacing3),
          _Summary(lines: [l10n.changeTimeSummary(lessonWhen(context, lesson.startsAt), lessonWhen(context, _picked!))]),
        ],
        const SizedBox(height: Spacing.spacing4),
        FilledButton(
          key: const ValueKey('move-confirm'),
          onPressed: _picked == null || _sending ? null : _move,
          child: _sending
              ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(l10n.changeTimeConfirm),
        ),
      ],
    );
  }

  Widget _weeklyBody(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final m = MaterialLocalizations.of(context);
    final weekly = _weekly;
    if (_loadError != null) return Text(l10n.ticketLoadFailed, style: theme.textTheme.bodyMedium);
    if (weekly == null) return _loading();
    if (weekly.isLocked) return const SlotsLockedNotice();

    final taken = _newSet.toSet();
    final picking = _editing != null || _adding;
    final anchor = _anchor;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.weeklyCurrentTitle, style: theme.textTheme.labelLarge),
        const SizedBox(height: Spacing.spacing2),
        if (weekly.current.isEmpty) Text(l10n.weeklyNoCurrent, style: theme.textTheme.bodyMedium),
        for (final c in weekly.current) _currentCard(context, c),
        for (final a in _added)
          Card(
            key: ValueKey('weekly-added-${a.weekday}-${a.start}'),
            child: ListTile(
              leading: const Icon(Icons.add_circle_outline),
              title: Text(weeklyLabel(context, a.nextStartsAt)),
              trailing: TextButton(
                onPressed: () => setState(() => _added.remove(a)),
                child: Text(l10n.weeklyUndo),
              ),
            ),
          ),
        if (!picking)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              key: const ValueKey('weekly-add'),
              onPressed: () => setState(() => _adding = true),
              icon: const Icon(Icons.add),
              label: Text(l10n.weeklyAdd),
            ),
          ),
        if (picking) ...[
          const SizedBox(height: Spacing.spacing3),
          Text(
            _editing != null
                ? l10n.weeklyPickReplacement(_currentLabel(context, weekly.current.firstWhere((c) => c.key == _editing)))
                : l10n.weeklyPickAdded,
            style: theme.textTheme.titleSmall,
          ),
          const SizedBox(height: Spacing.spacing2),
          WeeklySlotChipPicker(
            options: [for (final o in weekly.options) if (!taken.contains(o.key)) o],
            selected: null,
            onSelected: _pickWeekly,
          ),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton(
              onPressed: () => setState(() {
                _editing = null;
                _adding = false;
              }),
              child: Text(m.cancelButtonLabel),
            ),
          ),
        ],
        if (_changed && anchor != null) ...[
          const SizedBox(height: Spacing.spacing4),
          Text(l10n.weeklyFrom, style: theme.textTheme.labelLarge),
          const SizedBox(height: Spacing.spacing2),
          Wrap(
            spacing: Spacing.spacing2,
            runSpacing: Spacing.spacing2,
            children: [
              for (var i = 0; i < 4; i++)
                ChoiceChip(
                  key: ValueKey('weekly-from-$i'),
                  label: Text(m.formatMediumDate(anchor.add(Duration(days: 7 * i)))),
                  selected: _fromWeek == i,
                  onSelected: (_) => setState(() => _fromWeek = i),
                ),
            ],
          ),
          const SizedBox(height: Spacing.spacing4),
          _Summary(key: const ValueKey('weekly-summary'), lines: weeklySummaryLines(context)),
          const SizedBox(height: Spacing.spacing3),
          TextField(
            key: const ValueKey('schedule-change-note'),
            controller: _note,
            maxLength: 1000,
            maxLines: 3,
            minLines: 1,
            decoration: InputDecoration(labelText: l10n.reportNoteLabel, border: const OutlineInputBorder()),
          ),
          Text(l10n.scheduleChangeHint, style: theme.textTheme.bodySmall),
          const SizedBox(height: Spacing.spacing3),
          FilledButton(
            key: const ValueKey('weekly-send'),
            onPressed: _newSet.isEmpty || _sending ? null : _sendWeekly,
            child: _sending
                ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(l10n.scheduleChangeSend),
          ),
        ],
      ],
    );
  }

  /// A current weekly time as a card: change it or stop it -- or, once changed, undo.
  Widget _currentCard(BuildContext context, GroupChildSlot c) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final key = c.key;
    final replacement = _replaced[key];
    final removed = _removed.contains(key);
    final label = _currentLabel(context, c);
    final id = '${c.weekday}-${c.start}';
    return Card(
      key: ValueKey('weekly-current-$id'),
      child: ListTile(
        leading: const Icon(Icons.event_repeat_outlined),
        title: Text(
          replacement != null ? l10n.changeTimeSummary(label, weeklyLabel(context, replacement.nextStartsAt)) : label,
          style: removed ? const TextStyle(decoration: TextDecoration.lineThrough) : null,
        ),
        subtitle: removed ? Text(l10n.weeklyWillStop, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)) : null,
        trailing: replacement != null || removed
            ? TextButton(
                key: ValueKey('weekly-undo-$id'),
                onPressed: () => setState(() {
                  _replaced.remove(key);
                  _removed.remove(key);
                }),
                child: Text(l10n.weeklyUndo),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextButton(
                    key: ValueKey('weekly-change-$id'),
                    onPressed: () => setState(() {
                      _editing = key;
                      _adding = false;
                    }),
                    child: Text(l10n.weeklyChange),
                  ),
                  IconButton(
                    key: ValueKey('weekly-remove-$id'),
                    tooltip: l10n.weeklyRemove,
                    onPressed: () => setState(() {
                      _removed.add(key);
                      if (_editing == key) _editing = null;
                      _fromWeek = 0;
                    }),
                    icon: const Icon(Icons.remove_circle_outline),
                  ),
                ],
              ),
      ),
    );
  }

  String _currentLabel(BuildContext context, GroupChildSlot c) =>
      c.nextStartsAt != null ? weeklyLabel(context, c.nextStartsAt!) : '${c.weekday} ${c.start}';

  /// What the request changes, as the family reads it: "Mon 17:00 → Tue 18:00",
  /// "From 3 Nov", "Thu 17:00 unchanged", and each week a new time is skipped because
  /// the teacher already teaches then (`except`) -- nothing is lost silently.
  List<String> weeklySummaryLines(BuildContext context) {
    final l10n = L10n.of(context);
    final m = MaterialLocalizations.of(context);
    final weekly = _weekly!;
    final from = _from;
    final fromDay = from == null ? null : DateTime(from.year, from.month, from.day);
    final changes = <String>[];
    final unchanged = <String>[];
    for (final c in weekly.current) {
      final label = _currentLabel(context, c);
      if (_replaced[c.key] case final r?) {
        changes.add(l10n.changeTimeSummary(label, weeklyLabel(context, r.nextStartsAt)));
      } else if (_removed.contains(c.key)) {
        changes.add(l10n.weeklySummaryRemoved(label));
      } else {
        unchanged.add(l10n.weeklySummaryUnchanged(label));
      }
    }
    for (final a in _added) {
      changes.add(l10n.weeklySummaryAdded(weeklyLabel(context, a.nextStartsAt)));
    }
    final skipped = [
      for (final o in [..._replaced.values, ..._added])
        for (final e in o.except)
          if (fromDay == null || !DateTime(e.year, e.month, e.day).isBefore(fromDay)) e,
    ]..sort();
    return [
      ...changes,
      if (from != null) l10n.weeklySummaryFrom(m.formatMediumDate(from)),
      ...unchanged,
      for (final e in skipped) l10n.weeklySummarySkipped(m.formatMediumDate(e)),
    ];
  }
}

/// [instant]'s calendar date in the teacher's zone, 'YYYY-MM-DD' -- what
/// `effectiveFrom` means to the server. The reader's own date when the zone is unknown.
String teacherDate(DateTime instant, String? zone) {
  DateTime local = AppClock.view(instant);
  if (zone != null) {
    AppClock.ensureInitialized();
    try {
      local = tz.TZDateTime.from(instant, tz.getLocation(zone));
    } on Object {
      // An unknown zone name: the reader's date is the best guess, not an error.
    }
  }
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)}';
}

/// Why a lesson cannot be moved, as the server said -- before anything is picked.
String? moveRefusalText(L10n l10n, String? refusal) => switch (refusal) {
      null => null,
      'started' => l10n.moveRefusedStarted,
      'family_already_moved' => l10n.moveRefusedAlreadyMoved,
      'family_monthly_limit' => l10n.moveRefusedMonthlyLimit,
      'too_late' => l10n.moveRefusedTooLate,
      _ => l10n.moveRefusedNotMovable,
    };

/// One of the two big first choices.
class _ScopeChoice extends StatelessWidget {
  const _ScopeChoice({super.key, required this.icon, required this.title, required this.subtitle, required this.onTap});

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.card,
        child: Padding(
          padding: const EdgeInsets.all(Spacing.spacing4),
          child: Row(
            children: [
              Icon(icon, size: 32, color: theme.colorScheme.primary),
              const SizedBox(width: Spacing.spacing4),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: theme.textTheme.titleMedium),
                    const SizedBox(height: Spacing.spacing1),
                    Text(subtitle, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

/// The before -> after a confirm or a request is about.
class _Summary extends StatelessWidget {
  const _Summary({super.key, required this.lines});

  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: Radii.card,
      ),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final line in lines) Text(line, style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
