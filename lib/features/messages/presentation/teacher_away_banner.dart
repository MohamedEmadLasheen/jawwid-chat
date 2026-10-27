import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../application/away_teachers.dart';

export '../application/away_teachers.dart' show awayTeachersProvider;

/// "Ustadh Omar is on leave until 3 Nov. Messages still reach them." -- above the
/// thread, for as long as the server says a teacher here is away. Messaging is not
/// blocked (owner decision, PD-26); the family just knows not to expect a quick reply.
/// Absent while unknown and when nobody is away.
///
/// Live, never polled (PD-26 amendment, 2026-10-26). The member list is read again
///   * on the conversation's realtime signals and after a reconnect (the chat
///     realtime coordinator invalidates [awayTeachersProvider]);
///   * when the app comes back to the foreground; and
///   * once, when the last day the notice shows is over -- one timer, armed only
///     while a notice is shown, so a leave that ends clears itself.
class TeacherAwayBanner extends ConsumerStatefulWidget {
  const TeacherAwayBanner({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<TeacherAwayBanner> createState() => _TeacherAwayBannerState();
}

class _TeacherAwayBannerState extends ConsumerState<TeacherAwayBanner> with WidgetsBindingObserver {
  Timer? _leaveEnds;
  DateTime? _armedFor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _leaveEnds?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _reread();
  }

  void _reread() {
    if (!mounted) return;
    ref.invalidate(awayTeachersProvider(widget.conversationId));
  }

  /// Arms one timer for the local midnight after the earliest shown `until`: the
  /// moment the notice may stop being true. Nothing is armed while none is shown.
  void _armFor(List<GroupMember> away) {
    if (away.isEmpty) {
      _leaveEnds?.cancel();
      _leaveEnds = null;
      _armedFor = null;
      return;
    }
    final last = away.map((m) => m.away!.until).reduce((a, b) => a.isBefore(b) ? a : b);
    final over = DateTime(last.year, last.month, last.day + 1);
    if (_armedFor == over && _leaveEnds != null) return;
    _leaveEnds?.cancel();
    _armedFor = over;
    final wait = over.difference(DateTime.now());
    _leaveEnds = Timer(wait.isNegative ? Duration.zero : wait, () {
      _leaveEnds = null;
      _armedFor = null;
      _reread();
    });
  }

  @override
  Widget build(BuildContext context) {
    final away = ref.watch(awayTeachersProvider(widget.conversationId)).value ?? const <GroupMember>[];
    _armFor(away);
    if (away.isEmpty) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final dates = MaterialLocalizations.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final m in away)
          JawwidBanner(
            icon: Icons.event_busy_outlined,
            tone: JawwidBannerTone.warning,
            message: () {
              final until = m.away!.until;
              final date = dates.formatMediumDate(DateTime(until.year, until.month, until.day));
              return m.away!.kind == MemberAwayKind.leave
                  ? l10n.chatTeacherOnLeave(m.displayName, date)
                  : l10n.chatTeacherAway(m.displayName, date);
            }(),
          ),
      ],
    );
  }
}
