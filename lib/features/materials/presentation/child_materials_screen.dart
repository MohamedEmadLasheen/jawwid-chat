import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/searchable_picker.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/materials.dart';
import '../data/materials_repository.dart';
import 'material_labels.dart';
import 'material_player.dart';

/// The child's Materials page, its library filters and its data.
typedef LibraryQuery = ({String learnerId, String subject, String? ageGroup});

final childLibraryProvider = FutureProvider.autoDispose.family<ChildLibrary, LibraryQuery>(
  (ref, q) => ref.watch(materialsRepositoryProvider).library(q.learnerId, subject: q.subject, ageGroup: q.ageGroup),
);
final openedThisWeekProvider = FutureProvider.autoDispose.family<OpenedThisWeek, String>(
  (ref, learnerId) => ref.watch(materialsRepositoryProvider).opened(learnerId),
);

/// PD-29 (amended 2026-10-26): one child's Materials -- two tabs.
///
///  * Library: the academy's published materials of one subject at a time
///    (Quran first; there is no "All"), opening on the child's age band -- the
///    parent may choose another band, or every age. Quran lists Al-Fatihah
///    first, then by surah descending; the rest in the order provided (the
///    server's order, shown as it comes).
///  * Opened this week: what was opened FOR this child this academy week
///    (Saturday to Friday, academy time), each item once, last opened first.
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
      length: 2,
      initialIndex: initialTab.clamp(0, 1),
      child: Scaffold(
        appBar: AppBar(
          title: Text(childName == null || childName!.isEmpty ? l10n.materialsTitle : '${l10n.materialsTitle} · $childName'),
          bottom: TabBar(
            tabs: [
              Tab(key: const ValueKey('materials-tab-library'), text: l10n.materialsTabLibrary),
              Tab(key: const ValueKey('materials-tab-opened'), text: l10n.materialsTabOpened),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _LibraryTab(learnerId: learnerId),
            _OpenedTab(learnerId: learnerId),
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
  /// One subject at a time; Quran first.
  String _subject = materialSubjects.first;

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
              for (final s in materialSubjects)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2),
                  child: ChoiceChip(
                    key: ValueKey('materials-subject-$s'),
                    label: Text(subjectLabel(l10n, s)),
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
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: SearchablePickerField<String>(
                key: const ValueKey('materials-age'),
                value: shownBand,
                label: l10n.materialsAgeLabel,
                decoration: InputDecoration(labelText: l10n.materialsAgeLabel, isDense: true),
                onChanged: (v) => setState(() => _ageGroup = v),
                options: [
                  PickerOption(value: 'all', label: l10n.materialsAgeAll),
                  for (final band in materialAgeGroups)
                    PickerOption(
                      value: band,
                      label: band == childBand ? l10n.materialsAgeForChild(ageBandLabel(l10n, band)) : ageBandLabel(l10n, band),
                    ),
                ],
              ),
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
                itemBuilder: (context, i) => MaterialItemTile(item: value.items[i], arabic: arabic, learnerId: widget.learnerId),
              ),
            _ => const JawwidLoadingView(),
          },
        ),
      ],
    );
  }
}

/// One library item. Opening it records the opening for [learnerId] (the
/// child's "Opened this week"); without a child nothing is recorded.
class MaterialItemTile extends ConsumerWidget {
  const MaterialItemTile({super.key, required this.item, required this.arabic, this.learnerId, this.subtitle, this.enabled = true});

  final MaterialItem item;
  final bool arabic;
  final String? learnerId;

  /// Replaces the kind / strand line (e.g. "Last opened ...").
  final String? subtitle;
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final line = subtitle ??
        [
          kindLabel(l10n, item.kind),
          if (item.strand != null) strandLabel(l10n, item.strand!),
        ].join(' · ');
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        key: ValueKey('material-${item.id}'),
        enabled: enabled,
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          foregroundColor: theme.colorScheme.onPrimaryContainer,
          child: Icon(kindIcon(item.kind)),
        ),
        title: Text(item.title(arabic)),
        subtitle: Text(line),
        trailing: Icon(item.isActivity ? Icons.play_circle_outline : Icons.chevron_right),
        onTap: enabled
            ? () async {
                await openMaterial(context, item.id, title: item.title(arabic), learnerId: learnerId);
                if (learnerId != null) ref.invalidate(openedThisWeekProvider(learnerId!));
              }
            : null,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Opened this week
// ---------------------------------------------------------------------------

class _OpenedTab extends ConsumerWidget {
  const _OpenedTab({required this.learnerId});

  final String learnerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final locale = Localizations.localeOf(context).toLanguageTag();
    final state = ref.watch(openedThisWeekProvider(learnerId));
    return switch (state) {
      AsyncError(:final error) => _failure(context, error, () => ref.invalidate(openedThisWeekProvider(learnerId))),
      AsyncData(:final value) when value.items.isEmpty =>
        JawwidEmptyView(title: l10n.materialsOpenedEmpty, body: l10n.materialsOpenedWeekNote, icon: Icons.history),
      AsyncData(:final value) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(openedThisWeekProvider(learnerId)),
          child: ListView(
            padding: const EdgeInsets.all(Spacing.spacing5),
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: Spacing.spacing3),
                child: Text(l10n.materialsOpenedWeekNote, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ),
              for (final o in value.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: Spacing.spacing3),
                  child: MaterialItemTile(
                    item: o.item,
                    arabic: arabic,
                    learnerId: learnerId,
                    enabled: o.available,
                    subtitle: o.available
                        ? l10n.materialsOpenedLast(DateFormat.MMMEd(locale).add_jm().format(o.lastOpenedAt))
                        : l10n.materialsItemGone,
                  ),
                ),
            ],
          ),
        ),
      _ => const JawwidLoadingView(),
    };
  }
}
