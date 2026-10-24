import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/materials.dart';
import '../../lessons/domain/report_vocab.dart';
import '../data/materials_repository.dart';
import 'material_labels.dart';
import 'material_player.dart';

/// The child's Materials page, its library filters and its data.
typedef LibraryQuery = ({String learnerId, String? subject, String? ageGroup});

final childLibraryProvider = FutureProvider.autoDispose.family<ChildLibrary, LibraryQuery>(
  (ref, q) => ref.watch(materialsRepositoryProvider).library(q.learnerId, subject: q.subject, ageGroup: q.ageGroup),
);
final practiceProvider = FutureProvider.autoDispose.family<PracticeWeek, String>(
  (ref, learnerId) => ref.watch(materialsRepositoryProvider).practice(learnerId),
);
final progressProvider = FutureProvider.autoDispose.family<ProgressMap, String>(
  (ref, learnerId) => ref.watch(materialsRepositoryProvider).progress(learnerId),
);

/// PD-29: one child's Materials -- three tabs.
///
///  * Library: the academy's published materials by subject, opening on the
///    child's age band (the parent may choose another, or all -- nothing is
///    locked).
///  * Practice this week: what the teacher attached to this week's lesson
///    reports -- ayahs to recite (with the authorized recitation) and items to
///    play -- with the next-lesson tasks and homework beside them.
///  * Progress map: the 114 surahs by juz', filled from lesson reports. The
///    child's teacher (and staff the server allows) may correct a surah, with a
///    reason; every change stays in its history.
///
/// Parents reach it per child; the child's own teacher from the Student Profile.
/// The server decides who may read it.
class ChildMaterialsScreen extends StatelessWidget {
  const ChildMaterialsScreen({super.key, required this.learnerId, this.childName, this.initialTab = 0});

  final String learnerId;
  final String? childName;
  final int initialTab;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return DefaultTabController(
      length: 3,
      initialIndex: initialTab.clamp(0, 2),
      child: Scaffold(
        appBar: AppBar(
          title: Text(childName == null || childName!.isEmpty ? l10n.materialsTitle : '${l10n.materialsTitle} · $childName'),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(key: const ValueKey('materials-tab-library'), text: l10n.materialsTabLibrary),
              Tab(key: const ValueKey('materials-tab-practice'), text: l10n.materialsTabPractice),
              Tab(key: const ValueKey('materials-tab-progress'), text: l10n.materialsTabProgress),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _LibraryTab(learnerId: learnerId),
            _PracticeTab(learnerId: learnerId),
            ProgressMapView(learnerId: learnerId),
          ],
        ),
      ),
    );
  }
}

Widget _failure(BuildContext context, Object error, VoidCallback retry) {
  final l10n = L10n.of(context);
  if (error is UnsupportedError) {
    return JawwidEmptyView(title: l10n.materialsUnavailable, icon: Icons.menu_book_outlined);
  }
  return JawwidErrorView(title: l10n.materialsUnavailable, retryLabel: l10n.retryAction, onRetry: retry);
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

class _LibraryTab extends ConsumerStatefulWidget {
  const _LibraryTab({required this.learnerId});

  final String learnerId;

  @override
  ConsumerState<_LibraryTab> createState() => _LibraryTabState();
}

class _LibraryTabState extends ConsumerState<_LibraryTab> with AutomaticKeepAliveClientMixin {
  String? _subject;

  /// Null until the parent chooses: the server then opens on the child's band.
  String? _ageGroup;

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final l10n = L10n.of(context);
    final query = (learnerId: widget.learnerId, subject: _subject, ageGroup: _ageGroup);
    final state = ref.watch(childLibraryProvider(query));
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final data = state.value;
    final childBand = data?.childAgeGroup;
    final shownBand = data?.ageGroup ?? _ageGroup ?? 'all';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, 0),
          child: Row(
            children: [
              for (final s in <String?>[null, ...materialSubjects])
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
                  child: ChoiceChip(
                    key: ValueKey('materials-subject-${s ?? 'all'}'),
                    label: Text(s == null ? l10n.materialsSubjectAll : subjectLabel(l10n, s)),
                    selected: _subject == s,
                    onSelected: (_) => setState(() => _subject = s),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, 0),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: DropdownButton<String>(
              key: const ValueKey('materials-age'),
              value: shownBand,
              onChanged: (v) => setState(() => _ageGroup = v),
              items: [
                DropdownMenuItem(value: 'all', child: Text(l10n.materialsAgeAll)),
                for (final band in materialAgeGroups)
                  DropdownMenuItem(
                    value: band,
                    child: Text(band == childBand ? l10n.materialsAgeForChild(ageBandLabel(l10n, band)) : ageBandLabel(l10n, band)),
                  ),
              ],
            ),
          ),
        ),
        Expanded(
          child: switch (state) {
            AsyncError(:final error) => _failure(context, error, () => ref.invalidate(childLibraryProvider(query))),
            AsyncData(:final value) when value.items.isEmpty =>
              JawwidEmptyView(title: l10n.materialsLibraryEmpty, icon: Icons.menu_book_outlined),
            AsyncData(:final value) => ListView.separated(
                padding: const EdgeInsets.all(Spacing.spacing5),
                itemCount: value.items.length,
                separatorBuilder: (_, _) => const SizedBox(height: Spacing.spacing3),
                itemBuilder: (context, i) => MaterialItemTile(item: value.items[i], arabic: arabic),
              ),
            _ => const JawwidLoadingView(),
          },
        ),
      ],
    );
  }
}

class MaterialItemTile extends StatelessWidget {
  const MaterialItemTile({super.key, required this.item, required this.arabic});

  final MaterialItem item;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final subtitle = [
      kindLabel(l10n, item.kind),
      if (item.strand != null) strandLabel(l10n, item.strand!),
    ].join(' · ');
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        key: ValueKey('material-${item.id}'),
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          foregroundColor: theme.colorScheme.onPrimaryContainer,
          child: Icon(kindIcon(item.kind)),
        ),
        title: Text(item.title(arabic)),
        subtitle: Text(subtitle),
        trailing: Icon(item.isActivity ? Icons.play_circle_outline : Icons.chevron_right),
        onTap: () => openMaterial(context, item.id, title: item.title(arabic)),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Practice this week
// ---------------------------------------------------------------------------

class _PracticeTab extends ConsumerWidget {
  const _PracticeTab({required this.learnerId});

  final String learnerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(practiceProvider(learnerId));
    return switch (state) {
      AsyncError(:final error) => _failure(context, error, () => ref.invalidate(practiceProvider(learnerId))),
      AsyncData(:final value) when _withSomething(value.reports).isEmpty =>
        JawwidEmptyView(title: l10n.materialsPracticeEmpty, icon: Icons.task_alt_outlined),
      AsyncData(:final value) => ListView(
          padding: const EdgeInsets.all(Spacing.spacing5),
          children: [
            if (!value.current)
              Padding(
                padding: const EdgeInsets.only(bottom: Spacing.spacing3),
                child: Text(l10n.materialsPracticeLatest, style: Theme.of(context).textTheme.bodyMedium),
              ),
            for (final r in _withSomething(value.reports)) _PracticeCard(report: r),
          ],
        ),
      _ => const JawwidLoadingView(),
    };
  }
}

/// A report that asked for nothing (no practice, tasks or homework) is not a card.
List<PracticeReport> _withSomething(List<PracticeReport> reports) => [
      for (final r in reports)
        if (r.practice.isNotEmpty || r.nextTasks.isNotEmpty || (r.homework?.trim().isNotEmpty ?? false)) r,
    ];

class _PracticeCard extends StatelessWidget {
  const _PracticeCard({required this.report});

  final PracticeReport report;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final day = DateFormat.MMMEd(Localizations.localeOf(context).toLanguageTag()).format(report.submittedAt);
    return Card(
      margin: const EdgeInsets.only(bottom: Spacing.spacing4),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.materialsPracticeFrom(day), style: theme.textTheme.titleSmall),
            for (final p in report.practice)
              switch (p) {
                AyahPractice() => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.menu_book_outlined),
                    title: Text(p.wholeSurah
                        ? l10n.materialsWholeSurah(arabic ? p.nameAr : p.nameEn)
                        : l10n.materialsAyahRange(arabic ? p.nameAr : p.nameEn, '${p.ayahFrom}', '${p.ayahTo}')),
                    trailing: p.hasRecitation
                        ? TextButton.icon(
                            key: ValueKey('listen-${report.lessonId}-${p.surah}'),
                            onPressed: () => playRecitation(context, p.surah, title: arabic ? p.nameAr : p.nameEn),
                            icon: const Icon(Icons.headphones_outlined),
                            label: Text(l10n.materialsListen),
                          )
                        : null,
                  ),
                ItemPractice(:final item) when item == null => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.block),
                    title: Text(l10n.materialsItemGone, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                  ),
                ItemPractice(:final item) => MaterialItemTile(item: item!, arabic: arabic),
              },
            if (report.nextTasks.isNotEmpty) ...[
              const SizedBox(height: Spacing.spacing3),
              Text(l10n.materialsNextTasks, style: theme.textTheme.labelLarge),
              const SizedBox(height: Spacing.spacing2),
              Wrap(
                spacing: Spacing.spacing2,
                runSpacing: Spacing.spacing2,
                children: [for (final t in report.nextTasks) Chip(label: Text(taskLabel(l10n, t)))],
              ),
            ],
            if (report.homework != null && report.homework!.trim().isNotEmpty) ...[
              const SizedBox(height: Spacing.spacing3),
              Text(l10n.materialsHomework, style: theme.textTheme.labelLarge),
              Text(report.homework!),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Progress map
// ---------------------------------------------------------------------------

/// The memorization map. Also embedded where a teacher views their student.
class ProgressMapView extends ConsumerWidget {
  const ProgressMapView({super.key, required this.learnerId});

  final String learnerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final state = ref.watch(progressProvider(learnerId));
    return switch (state) {
      AsyncError(:final error) => _failure(context, error, () => ref.invalidate(progressProvider(learnerId))),
      AsyncData(:final value) => ListView(
          padding: const EdgeInsets.all(Spacing.spacing5),
          children: [
            Wrap(
              spacing: Spacing.spacing2,
              runSpacing: Spacing.spacing2,
              children: [
                for (final s in const ['memorized', 'in_progress', 'needs_revision', 'not_started'])
                  Chip(
                    key: ValueKey('count-$s'),
                    avatar: CircleAvatar(backgroundColor: statusColor(context, s), radius: 6),
                    label: Text('${markLabel(l10n, s)}: ${value.counts[s] ?? 0}'),
                  ),
              ],
            ),
            // Juz' 30 first: memorization usually starts from Juz' Amma and works back.
            for (final j in value.juz.reversed) ...[
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing3, bottom: Spacing.spacing1),
                child: Text(l10n.materialsJuz('${j.juz}'), style: theme.textTheme.labelLarge),
              ),
              Wrap(
                spacing: Spacing.spacing2,
                runSpacing: Spacing.spacing2,
                children: [
                  for (final s in j.surahs)
                    ActionChip(
                      key: ValueKey('surah-${s.number}'),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      backgroundColor: statusColor(context, s.status).withValues(alpha: 0.18),
                      side: BorderSide(color: statusColor(context, s.status)),
                      label: Text('${s.number}. ${s.name(arabic)}'),
                      tooltip: markLabel(l10n, s.status),
                      onPressed: () => showSurahSheet(context, learnerId: learnerId, surah: s, canCorrect: value.canCorrect),
                    ),
                ],
              ),
            ],
          ],
        ),
      _ => const JawwidLoadingView(),
    };
  }
}

/// A surah status's colour, from the design tokens.
Color statusColor(BuildContext context, String status) {
  final tokens = JawwidTokens.of(context);
  return switch (status) {
    'memorized' => tokens.colorStatusSuccessFg,
    'in_progress' => tokens.colorStatusInfoFg,
    'needs_revision' => tokens.colorStatusWarningFg,
    _ => tokens.colorStatusNeutralFg,
  };
}

Future<void> showSurahSheet(BuildContext context, {required String learnerId, required ProgressSurah surah, required bool canCorrect}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useRootNavigator: true,
    builder: (_) => _SurahSheet(learnerId: learnerId, surah: surah, canCorrect: canCorrect),
  );
}

class _SurahSheet extends ConsumerStatefulWidget {
  const _SurahSheet({required this.learnerId, required this.surah, required this.canCorrect});

  final String learnerId;
  final ProgressSurah surah;
  final bool canCorrect;

  @override
  ConsumerState<_SurahSheet> createState() => _SurahSheetState();
}

class _SurahSheetState extends ConsumerState<_SurahSheet> {
  SurahHistory? _history;
  Object? _error;
  late String _status = widget.surah.status;
  final _reason = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _reason.addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final h = await ref.read(materialsRepositoryProvider).history(widget.learnerId, widget.surah.number);
      if (mounted) setState(() => _history = h);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _correct() async {
    final reason = _reason.text.trim();
    if (reason.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final h = await ref
          .read(materialsRepositoryProvider)
          .correct(widget.learnerId, widget.surah.number, status: _status, reason: reason);
      ref.invalidate(progressProvider(widget.learnerId));
      if (mounted) {
        setState(() {
          _history = h;
          _sending = false;
          _reason.clear();
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _sending = false;
          _error = e;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('${widget.surah.number}. ${widget.surah.name(arabic)}', style: theme.textTheme.titleLarge),
              Text(markLabel(l10n, widget.surah.status), style: theme.textTheme.bodyMedium?.copyWith(color: statusColor(context, widget.surah.status))),
              if (widget.surah.hasRecitation)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    onPressed: () => playRecitation(context, widget.surah.number, title: widget.surah.name(arabic)),
                    icon: const Icon(Icons.headphones_outlined),
                    label: Text(l10n.materialsListen),
                  ),
                ),
              const SizedBox(height: Spacing.spacing3),
              Text(l10n.materialsHistory, style: theme.textTheme.labelLarge),
              if (_history == null && _error == null)
                const Padding(padding: EdgeInsets.all(Spacing.spacing4), child: Center(child: CircularProgressIndicator())),
              if (_history != null && _history!.marks.isEmpty)
                Padding(padding: const EdgeInsets.symmetric(vertical: Spacing.spacing3), child: Text(l10n.materialsHistoryEmpty)),
              for (final m in _history?.marks ?? const <SurahMark>[])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(backgroundColor: statusColor(context, m.status), radius: 6),
                  title: Text('${markLabel(l10n, m.status)} · ${markSourceLabel(l10n, m.source)}'),
                  subtitle: Text([
                    m.byName ?? (m.byKind == 'teacher' ? l10n.materialsByTeacher : l10n.materialsByAcademy),
                    DateFormat.yMMMd(locale).add_jm().format(m.at),
                    if (m.reason != null) m.reason!,
                  ].join('\n')),
                ),
              if (widget.canCorrect) ...[
                const Divider(),
                Text(l10n.materialsCorrect, style: theme.textTheme.labelLarge),
                const SizedBox(height: Spacing.spacing2),
                Wrap(
                  spacing: Spacing.spacing2,
                  runSpacing: Spacing.spacing2,
                  children: [
                    for (final s in markStatuses)
                      ChoiceChip(
                        key: ValueKey('correct-$s'),
                        label: Text(markLabel(l10n, s)),
                        selected: _status == s,
                        onSelected: (_) => setState(() => _status = s),
                      ),
                  ],
                ),
                const SizedBox(height: Spacing.spacing3),
                TextField(
                  key: const ValueKey('correct-reason'),
                  controller: _reason,
                  maxLength: 1000,
                  decoration: InputDecoration(
                    labelText: l10n.materialsCorrectReason,
                    helperText: l10n.materialsCorrectReasonHint,
                    border: const OutlineInputBorder(),
                  ),
                ),
                FilledButton(
                  key: const ValueKey('correct-submit'),
                  onPressed: _reason.text.trim().isEmpty || _sending ? null : _correct,
                  child: Text(l10n.materialsCorrect),
                ),
              ],
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: Spacing.spacing2),
                  child: Text(l10n.materialsUnavailable, style: TextStyle(color: theme.colorScheme.error)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
