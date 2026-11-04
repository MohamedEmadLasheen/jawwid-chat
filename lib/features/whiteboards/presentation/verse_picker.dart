import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/materials.dart';
import '../../materials/data/materials_repository.dart';
import '../data/quran_text_repository.dart';
import 'board_painter.dart';

/// The verse the teacher chose: its range and its verified text.
/// The range is the TEXT's own (review of #295, P0): what is inserted is
/// always exactly what was shown.
class PickedVerse {
  const PickedVerse(this.text);

  final VerseText text;

  int get surah => text.surah;
  int get from => text.from;
  int get to => text.to;
}

/// At most this many ayat in one verse element (the server's limit too).
const int kVerseMaxAyat = 20;

/// PD-39 §4.3: choose a surah and a range of ayat; the text shown is the
/// shared, verified dataset's, exactly as served -- nothing is typed, and an
/// unavailable dataset shows no text at all. The source is credited.
Future<PickedVerse?> pickVerse(BuildContext context) => showDialog<PickedVerse>(context: context, builder: (_) => const _VersePicker());

class _VersePicker extends ConsumerStatefulWidget {
  const _VersePicker();

  @override
  ConsumerState<_VersePicker> createState() => _VersePickerState();
}

class _VersePickerState extends ConsumerState<_VersePicker> {
  List<Surah>? _surahs;
  bool _surahsFailed = false;
  Surah? _surah;
  int _from = 1;
  int _to = 1;
  Timer? _debounce;

  /// The preview shown, and whether it failed. A request carries its number;
  /// only the latest one's answer is ever shown (review of #295, P0).
  VerseText? _loaded;
  bool _failed = false;
  int _request = 0;

  /// The preview is exactly the current choice: the only state Insert accepts.
  bool get _ready {
    final s = _surah;
    return s != null && _loaded != null && _loaded!.covers(s.number, _from, _to);
  }

  @override
  void initState() {
    super.initState();
    unawaited(_loadSurahs());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _loadSurahs() async {
    try {
      final list = await ref.read(materialsRepositoryProvider).surahs();
      if (mounted) setState(() => _surahs = list);
    } on Object {
      if (mounted) setState(() => _surahsFailed = true);
    }
  }

  void _choose(Surah s) {
    setState(() {
      _surah = s;
      _from = 1;
      _to = math.min(s.ayahCount, 7);
    });
    _refresh();
  }

  /// A new choice: the old preview goes at once (Insert is off until the new
  /// one arrives), then the new range is asked for.
  void _refresh() {
    _debounce?.cancel();
    final request = ++_request;
    setState(() {
      _loaded = null;
      _failed = false;
    });
    final s = _surah;
    if (s == null) return;
    final (surah, from, to) = (s.number, _from, _to);
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      try {
        final text = await ref.read(quranTextRepositoryProvider).ayahs(surah, from, to);
        if (!mounted || request != _request) return;
        // Another range's text (a broken answer) is never shown, never insertable.
        setState(() {
          if (text.covers(surah, from, to)) {
            _loaded = text;
          } else {
            _failed = true;
          }
        });
      } on Object {
        if (!mounted || request != _request) return;
        setState(() => _failed = true);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final s = _surah;
    return AlertDialog(
      title: Text(l10n.boardToolVerse),
      content: SizedBox(
        width: 640,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_surahsFailed)
              Text(l10n.boardVerseUnavailable, style: TextStyle(color: tokens.colorStatusDangerFg))
            else if (_surahs == null)
              const LinearProgressIndicator()
            else
              DropdownMenu<Surah>(
                expandedInsets: EdgeInsets.zero,
                enableFilter: true,
                requestFocusOnTap: true,
                label: Text(l10n.boardVerseSurah),
                onSelected: (v) {
                  if (v != null) _choose(v);
                },
                dropdownMenuEntries: [for (final x in _surahs!) DropdownMenuEntry(value: x, label: '${x.number}. ${x.name(arabic)}')],
              ),
            if (s != null) ...[
              const SizedBox(height: Spacing.spacing4),
              Row(
                children: [
                  Expanded(
                    child: _AyahField(
                      label: l10n.boardVerseFrom,
                      value: _from,
                      max: s.ayahCount,
                      onChanged: (v) {
                        setState(() {
                          _from = v;
                          if (_to < v) _to = v;
                          if (_to - v + 1 > kVerseMaxAyat) _to = v + kVerseMaxAyat - 1;
                        });
                        _refresh();
                      },
                    ),
                  ),
                  const SizedBox(width: Spacing.spacing4),
                  Expanded(
                    child: _AyahField(
                      label: l10n.boardVerseTo,
                      value: _to,
                      min: _from,
                      max: math.min(s.ayahCount, _from + kVerseMaxAyat - 1),
                      onChanged: (v) {
                        setState(() => _to = v);
                        _refresh();
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Spacing.spacing2),
              Text(l10n.boardVerseMax('$kVerseMaxAyat'), style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: Spacing.spacing4),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 260),
                child: Builder(
                  builder: (context) {
                    if (_failed) return Text(l10n.boardVerseUnavailable, style: TextStyle(color: tokens.colorStatusDangerFg));
                    if (!_ready) return const Center(child: CircularProgressIndicator());
                    final text = _loaded!;
                    return SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (text.ayahs.first.basmala != null)
                            Text(
                              text.ayahs.first.basmala!,
                              textAlign: TextAlign.center,
                              textDirection: TextDirection.rtl,
                              style: const TextStyle(fontFamily: kQuranFont, fontSize: 26, height: 1.9),
                            ),
                          Text(
                            verseBody(text),
                            textAlign: TextAlign.justify,
                            textDirection: TextDirection.rtl,
                            style: const TextStyle(fontFamily: kQuranFont, fontSize: 26, height: 1.9),
                          ),
                          const SizedBox(height: Spacing.spacing3),
                          Text(
                            l10n.boardVerseSource(text.attribution),
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.boardsCancel)),
        FilledButton(onPressed: _ready ? () => Navigator.of(context).pop(PickedVerse(_loaded!)) : null, child: Text(l10n.boardVerseInsert)),
      ],
    );
  }
}

class _AyahField extends StatelessWidget {
  const _AyahField({required this.label, required this.value, required this.max, required this.onChanged, this.min = 1});

  final String label;
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<int>(
      initialValue: value.clamp(min, max),
      decoration: InputDecoration(labelText: label),
      items: [for (var i = min; i <= max; i++) DropdownMenuItem(value: i, child: Text('$i'))],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
