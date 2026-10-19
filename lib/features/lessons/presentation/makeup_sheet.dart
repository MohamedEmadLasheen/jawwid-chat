import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import 'lesson_ticket_sheet.dart';

/// PD-11 T2: a parent books the make-up a teacher-cancelled lesson owes them.
///
/// Day first, then a time on that day -- the server's free instants, grouped by the
/// reader's OWN calendar day and shown in their own clock. Booking is instant; the
/// server re-checks the time, so one taken a moment ago is refused, the offer is
/// reloaded, and nothing is booked twice.
Future<bool> showMakeupSheet(BuildContext context, LessonTicket ticket) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => MakeupSheet(ticket: ticket),
  );
  return sent == true;
}

class MakeupSheet extends ConsumerStatefulWidget {
  const MakeupSheet({super.key, required this.ticket});

  final LessonTicket ticket;

  @override
  ConsumerState<MakeupSheet> createState() => _MakeupSheetState();
}

class _MakeupSheetState extends ConsumerState<MakeupSheet> {
  MakeupOffer? _offer;
  Object? _loadError;
  DateTime? _day;
  DateTime? _picked;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loadError = null;
      _picked = null;
    });
    try {
      final offer = await ref.read(lessonRepositoryProvider).makeupSlots(widget.ticket.lessonId!);
      if (!mounted) return;
      setState(() {
        _offer = offer;
        final days = _days(offer);
        if (_day == null || !days.contains(_day)) _day = days.isEmpty ? null : days.first;
      });
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  static DateTime _dayOf(DateTime t) => DateTime(t.year, t.month, t.day);

  List<DateTime> _days(MakeupOffer offer) => offer.slots.map(_dayOf).toSet().toList()..sort();

  Future<void> _book() async {
    final picked = _picked;
    if (picked == null || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(lessonRepositoryProvider).bookMakeup(widget.ticket.lessonId!, picked);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = ticketErrorText(L10n.of(context), e);
      });
      // The time may have just been taken: show what is free now.
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final m = MaterialLocalizations.of(context);
    final offer = _offer;

    Widget body;
    if (_loadError != null) {
      body = Text(l10n.ticketLoadFailed, style: theme.textTheme.bodyMedium);
    } else if (offer == null) {
      body = const Center(child: Padding(padding: EdgeInsets.all(Spacing.spacing5), child: CircularProgressIndicator()));
    } else if (offer.slots.isEmpty) {
      body = Text(l10n.makeupNoSlots, style: theme.textTheme.bodyMedium);
    } else {
      final days = _days(offer);
      final times = offer.slots.where((t) => _dayOf(t) == _day).toList();
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.makeupPickDay, style: theme.textTheme.labelLarge),
          const SizedBox(height: Spacing.spacing2),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final d in days)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
                    child: ChoiceChip(
                      key: ValueKey('makeup-day-${d.toIso8601String()}'),
                      label: Text(m.formatShortMonthDay(d)),
                      selected: d == _day,
                      onSelected: (_) => setState(() {
                        _day = d;
                        _picked = null;
                      }),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Spacing.spacing4),
          Text(l10n.makeupPickTime, style: theme.textTheme.labelLarge),
          const SizedBox(height: Spacing.spacing2),
          Wrap(
            spacing: Spacing.spacing2,
            runSpacing: Spacing.spacing2,
            children: [
              for (final t in times)
                ChoiceChip(
                  key: ValueKey('makeup-time-${t.toUtc().toIso8601String()}'),
                  label: Text(m.formatTimeOfDay(TimeOfDay.fromDateTime(t))),
                  selected: t == _picked,
                  onSelected: (_) => setState(() => _picked = t),
                ),
            ],
          ),
        ],
      );
    }

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.ticketBookMakeup, style: theme.textTheme.titleLarge),
            const SizedBox(height: Spacing.spacing1),
            Text(
              [
                if (widget.ticket.learnerName.isNotEmpty) widget.ticket.learnerName,
                if (offer != null && offer.durationMinutes > 0) l10n.makeupLength(offer.durationMinutes),
              ].join(' · '),
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: Spacing.spacing4),
            body,
            if (_error != null) ...[
              const SizedBox(height: Spacing.spacing2),
              Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
            ],
            const SizedBox(height: Spacing.spacing4),
            FilledButton(
              key: const ValueKey('makeup-book'),
              onPressed: _picked == null || _sending ? null : _book,
              child: _sending
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l10n.makeupBook),
            ),
          ],
        ),
      ),
    );
  }
}
