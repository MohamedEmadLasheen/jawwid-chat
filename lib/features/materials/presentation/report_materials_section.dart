import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/materials.dart';
import '../data/materials_repository.dart';
import 'material_labels.dart';

/// PD-29: what a teacher attaches to a lesson report -- "practice this week" (ayah
/// ranges and library items) and surah statuses for the child's memorization map.
///
/// On a new report, an empty list is simply not sent. On an edit, practice is sent
/// only once the teacher changes it (the server keeps what the report has
/// otherwise); a surah status is always an addition to the map's history.
class ReportMaterialsController extends ChangeNotifier {
  ReportMaterialsController({required this.editing});

  final bool editing;
  final List<PracticeDraft> _practice = [];
  final Map<int, String> _marks = {};
  bool _practiceTouched = false;

  List<PracticeDraft> get practice => List.unmodifiable(_practice);
  Map<int, String> get marks => Map.unmodifiable(_marks);

  void addPractice(PracticeDraft p) {
    if (_practice.contains(p) || _practice.length >= 10) return;
    _practice.add(p);
    _practiceTouched = true;
    notifyListeners();
  }

  void removePractice(PracticeDraft p) {
    _practice.remove(p);
    _practiceTouched = true;
    notifyListeners();
  }

  void setMark(int surah, String status) {
    _marks[surah] = status;
    notifyListeners();
  }

  void removeMark(int surah) {
    _marks.remove(surah);
    notifyListeners();
  }

  /// What the report sends.
  List<PracticeDraft>? get draftPractice => editing ? (_practiceTouched ? practice : null) : (_practice.isEmpty ? null : practice);
  List<MarkDraft>? get draftMarks =>
      _marks.isEmpty ? null : [for (final e in _marks.entries) MarkDraft(surah: e.key, status: e.value)];
}

class ReportMaterialsSection extends ConsumerWidget {
  const ReportMaterialsSection({super.key, required this.controller});

  final ReportMaterialsController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final surahs = ref.watch(surahsProvider);
    // A build without a materials server offers neither section.
    if (surahs.hasError) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final list = surahs.value ?? const <Surah>[];
    String surahName(int n) {
      final s = list.where((x) => x.number == n).firstOrNull;
      return s == null ? '$n' : '$n. ${s.name(arabic)}';
    }

    Widget heading(String text) => Padding(
          padding: const EdgeInsets.only(top: Spacing.spacing4, bottom: Spacing.spacing2),
          child: Text(text, style: theme.textTheme.labelLarge),
        );

    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          heading(l10n.reportPracticeLabel),
          if (controller.editing && controller.practice.isEmpty)
            Text(l10n.reportPracticeKeep, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          Wrap(
            spacing: Spacing.spacing2,
            runSpacing: Spacing.spacing2,
            children: [
              for (final p in controller.practice)
                InputChip(
                  key: ValueKey('practice-${p.itemId ?? '${p.surah}-${p.ayahFrom}-${p.ayahTo}'}'),
                  label: Text(p.label ?? ''),
                  onDeleted: () => controller.removePractice(p),
                ),
            ],
          ),
          Wrap(
            spacing: Spacing.spacing2,
            children: [
              TextButton.icon(
                key: const ValueKey('practice-add-ayahs'),
                onPressed: list.isEmpty
                    ? null
                    : () async {
                        final p = await showDialog<PracticeDraft>(context: context, builder: (_) => _AyahDialog(surahs: list));
                        if (p != null) controller.addPractice(p);
                      },
                icon: const Icon(Icons.menu_book_outlined),
                label: Text(l10n.reportPracticeAddAyahs),
              ),
              TextButton.icon(
                key: const ValueKey('practice-add-item'),
                onPressed: () async {
                  final p = await showModalBottomSheet<PracticeDraft>(
                    context: context,
                    isScrollControlled: true,
                    showDragHandle: true,
                    builder: (_) => const _ItemPicker(),
                  );
                  if (p != null) controller.addPractice(p);
                },
                icon: const Icon(Icons.extension_outlined),
                label: Text(l10n.reportPracticeAddItem),
              ),
            ],
          ),
          heading(l10n.reportMemorizationLabel),
          Wrap(
            spacing: Spacing.spacing2,
            runSpacing: Spacing.spacing2,
            children: [
              for (final e in controller.marks.entries)
                InputChip(
                  key: ValueKey('mark-${e.key}'),
                  label: Text('${surahName(e.key)} · ${markLabel(l10n, e.value)}'),
                  onDeleted: () => controller.removeMark(e.key),
                ),
            ],
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              key: const ValueKey('mark-add'),
              onPressed: list.isEmpty
                  ? null
                  : () async {
                      final m = await showDialog<MarkDraft>(context: context, builder: (_) => _MarkDialog(surahs: list));
                      if (m != null) controller.setMark(m.surah, m.status);
                    },
              icon: const Icon(Icons.flag_outlined),
              label: Text(l10n.reportMemorizationAdd),
            ),
          ),
        ],
      ),
    );
  }
}

class _AyahDialog extends StatefulWidget {
  const _AyahDialog({required this.surahs});

  final List<Surah> surahs;

  @override
  State<_AyahDialog> createState() => _AyahDialogState();
}

class _AyahDialogState extends State<_AyahDialog> {
  late Surah _surah = widget.surahs.first;
  final _from = TextEditingController(text: '1');
  late final _to = TextEditingController(text: '${widget.surahs.first.ayahCount}');
  bool _invalid = false;

  @override
  void dispose() {
    _from.dispose();
    _to.dispose();
    super.dispose();
  }

  void _add() {
    final from = int.tryParse(_from.text.trim());
    final to = int.tryParse(_to.text.trim());
    if (from == null || to == null || from < 1 || to < from || to > _surah.ayahCount) {
      setState(() => _invalid = true);
      return;
    }
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final whole = from == 1 && to == _surah.ayahCount;
    Navigator.of(context).pop(PracticeDraft.ayahs(
      surah: _surah.number,
      ayahFrom: from,
      ayahTo: to,
      label: whole ? _surah.name(arabic) : '${_surah.name(arabic)} $from–$to',
    ));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return AlertDialog(
      title: Text(l10n.reportPracticeAddAyahs),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<int>(
            key: const ValueKey('ayah-surah'),
            initialValue: _surah.number,
            isExpanded: true,
            decoration: InputDecoration(labelText: l10n.reportSurahLabel),
            items: [
              for (final s in widget.surahs) DropdownMenuItem(value: s.number, child: Text('${s.number}. ${s.name(arabic)}')),
            ],
            onChanged: (n) => setState(() {
              _surah = widget.surahs.firstWhere((s) => s.number == n);
              _from.text = '1';
              _to.text = '${_surah.ayahCount}';
              _invalid = false;
            }),
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('ayah-from'),
                  controller: _from,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: l10n.reportAyahFrom),
                ),
              ),
              const SizedBox(width: Spacing.spacing4),
              Expanded(
                child: TextField(
                  key: const ValueKey('ayah-to'),
                  controller: _to,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: l10n.reportAyahTo),
                ),
              ),
            ],
          ),
          if (_invalid)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Text(l10n.reportAyahInvalid('${_surah.ayahCount}'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(MaterialLocalizations.of(context).cancelButtonLabel)),
        FilledButton(key: const ValueKey('ayah-add'), onPressed: _add, child: Text(l10n.reportAdd)),
      ],
    );
  }
}

class _MarkDialog extends StatefulWidget {
  const _MarkDialog({required this.surahs});

  final List<Surah> surahs;

  @override
  State<_MarkDialog> createState() => _MarkDialogState();
}

class _MarkDialogState extends State<_MarkDialog> {
  late int _surah = widget.surahs.first.number;
  String _status = 'in_progress';

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return AlertDialog(
      title: Text(l10n.reportMemorizationAdd),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<int>(
            key: const ValueKey('mark-surah'),
            initialValue: _surah,
            isExpanded: true,
            decoration: InputDecoration(labelText: l10n.reportSurahLabel),
            items: [
              for (final s in widget.surahs) DropdownMenuItem(value: s.number, child: Text('${s.number}. ${s.name(arabic)}')),
            ],
            onChanged: (n) => setState(() => _surah = n ?? _surah),
          ),
          const SizedBox(height: Spacing.spacing3),
          Wrap(
            spacing: Spacing.spacing2,
            runSpacing: Spacing.spacing2,
            children: [
              for (final s in markStatuses)
                ChoiceChip(
                  key: ValueKey('mark-status-$s'),
                  label: Text(markLabel(l10n, s)),
                  selected: _status == s,
                  onSelected: (_) => setState(() => _status = s),
                ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(MaterialLocalizations.of(context).cancelButtonLabel)),
        FilledButton(
          key: const ValueKey('mark-save'),
          onPressed: () => Navigator.of(context).pop(MarkDraft(surah: _surah, status: _status)),
          child: Text(l10n.reportAdd),
        ),
      ],
    );
  }
}

/// The published library, searchable, for attaching an item to the report.
class _ItemPicker extends ConsumerStatefulWidget {
  const _ItemPicker();

  @override
  ConsumerState<_ItemPicker> createState() => _ItemPickerState();
}

class _ItemPickerState extends ConsumerState<_ItemPicker> {
  final _query = TextEditingController();
  Future<List<MaterialItem>>? _items;

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _search() {
    final items = ref.read(materialsRepositoryProvider).picker(query: _query.text);
    setState(() {
      _items = items;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.7,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
                child: TextField(
                  key: const ValueKey('picker-search'),
                  controller: _query,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _search(),
                  decoration: InputDecoration(
                    hintText: l10n.reportPickerSearch,
                    prefixIcon: const Icon(Icons.search),
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
              Expanded(
                child: FutureBuilder<List<MaterialItem>>(
                  future: _items,
                  builder: (context, snap) {
                    if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
                    final items = snap.data ?? const <MaterialItem>[];
                    if (snap.hasError || items.isEmpty) return Center(child: Text(l10n.reportPickerEmpty));
                    return ListView(
                      children: [
                        for (final item in items)
                          ListTile(
                            key: ValueKey('picker-${item.id}'),
                            leading: Icon(kindIcon(item.kind)),
                            title: Text(item.title(arabic)),
                            subtitle: Text([subjectLabel(l10n, item.subject), kindLabel(l10n, item.kind)].join(' · ')),
                            onTap: () => Navigator.of(context).pop(PracticeDraft.item(itemId: item.id, label: item.title(arabic))),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
