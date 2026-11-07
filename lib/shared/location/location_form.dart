import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/errors/app_error.dart';
import '../../design/tokens.dart';
import '../../design/widgets/searchable_picker.dart';
import '../../l10n/app_localizations.dart';
import 'location.dart';
import 'location_repository.dart';

/// PD-45 plan 5.1: the country picker, then the subdivision picker, each a SEARCHABLE
/// list (never a dropdown). The subdivision is filtered by the chosen country, labelled
/// with that country's own word (Governorate, Emirate, State...), cleared when the
/// country changes, disabled until a country is chosen and absent for a country that has
/// none.
///
/// [suggestedCountryCode] (plan 6.2) only offers a chip; tapping the chip fills the
/// country field and nothing more. The family's location is written by Save, and only by
/// Save.
class LocationForm extends StatefulWidget {
  const LocationForm({
    super.key,
    required this.repository,
    required this.onDone,
    this.initialCountryCode,
    this.initialSubdivisionCode,
    this.suggestedCountryCode,
    this.secondaryLabel,
    this.onSecondary,
  });

  final LocationRepository repository;

  /// Called with the server's answer after a successful Save.
  final ValueChanged<MyLocation> onDone;
  final String? initialCountryCode;
  final String? initialSubdivisionCode;
  final String? suggestedCountryCode;

  /// The button beside Save (Cancel in the profile, Later in the prompt).
  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  @override
  State<LocationForm> createState() => _LocationFormState();
}

class _LocationFormState extends State<LocationForm> {
  GeoCountries? _countries;
  List<GeoSubdivision>? _subs;
  String? _country;
  String? _sub;
  bool _loadFailed = false;
  bool _tried = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _country = widget.initialCountryCode;
    _sub = widget.initialSubdivisionCode;
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loadFailed = false);
    try {
      final countries = await widget.repository.countries();
      if (!mounted) return;
      setState(() => _countries = countries);
      if (_country != null) await _loadSubs(_country!);
    } catch (_) {
      if (mounted) setState(() => _loadFailed = true);
    }
  }

  Future<void> _loadSubs(String country) async {
    final c = _countries?.byCode(country);
    if (c == null || !c.hasSubdivisions) {
      setState(() => _subs = const []);
      return;
    }
    setState(() => _subs = null);
    try {
      final subs = await widget.repository.subdivisions(country);
      if (mounted && _country == country) setState(() => _subs = subs);
    } catch (_) {
      if (mounted && _country == country) setState(() => _loadFailed = true);
    }
  }

  void _chooseCountry(String code) {
    setState(() {
      _country = code;
      _sub = null; // changing the country clears the subdivision
      _subs = null;
    });
    unawaited(_loadSubs(code));
  }

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  List<PickerOption<String>> _countryOptions(GeoCountries all) {
    final ar = _arabic;
    int byName(GeoCountry a, GeoCountry b) => a.name.of(ar).compareTo(b.name.of(ar));
    final pinned = all.countries.where((c) => c.pinned != null).toList()..sort((a, b) => a.pinned!.compareTo(b.pinned!));
    final rest = all.countries.where((c) => c.pinned == null).toList()..sort(byName);
    return [
      for (final c in [...pinned, ...rest])
        PickerOption(
          value: c.code,
          label: '${flagOf(c.code)} ${c.name.of(ar)}'.trim(),
          // Searched with the label: the other language and the ISO code.
          hint: '${c.name.of(!ar)} · ${c.code}',
        ),
    ];
  }

  Future<void> _save() async {
    setState(() => _tried = true);
    final c = _countries?.byCode(_country);
    if (c == null) return;
    if (c.hasSubdivisions && _sub == null) return;
    setState(() => _saving = true);
    try {
      final saved = await widget.repository.save(countryCode: c.code, subdivisionCode: c.hasSubdivisions ? _sub : null);
      if (!mounted) return;
      widget.onDone(saved);
    } catch (e) {
      if (!mounted) return;
      // 409 COMM.PARENT_EXISTS: a neutral message, never the reason (it concerns another family).
      final conflict = e is AppError && e.code == 'COMM.PARENT_EXISTS';
      final l10n = L10n.of(context);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(conflict ? l10n.locationSaveConflict : l10n.profileSaveFailed)));
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final ar = _arabic;
    final all = _countries;

    if (_loadFailed && all == null) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.locationLoadFailed, key: const ValueKey('location-load-failed')),
          const SizedBox(height: Spacing.spacing3),
          TextButton(onPressed: _load, child: Text(l10n.retryAction)),
        ],
      );
    }
    if (all == null) {
      return const Center(child: Padding(padding: EdgeInsets.all(Spacing.spacing5), child: CircularProgressIndicator()));
    }

    final country = all.byCode(_country);
    final label = (country?.label ?? all.defaultLabel).of(ar);
    final suggested = all.byCode(widget.suggestedCountryCode);
    final showSuggestion = suggested != null && _country == null;
    final showSub = country == null || country.hasSubdivisions;
    final subOptions = [
      for (final s in [...?_subs]..sort((a, b) => a.name.of(ar).compareTo(b.name.of(ar))))
        PickerOption(value: s.code, label: s.name.of(ar), hint: s.name.of(!ar)),
    ];

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SearchablePickerField<String>(
          key: const ValueKey('location-country'),
          label: l10n.locationCountryLabel,
          options: _countryOptions(all),
          value: _country,
          onChanged: _saving ? null : _chooseCountry,
        ),
        if (_tried && country == null)
          _Error(l10n.locationCountryError, key: const ValueKey('location-country-error')),
        if (showSuggestion)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.spacing3),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: ActionChip(
                key: const ValueKey('location-suggestion'),
                avatar: const Icon(Icons.lightbulb_outline, size: 18),
                label: Text(l10n.locationSuggestion(suggested.name.of(ar))),
                onPressed: _saving ? null : () => _chooseCountry(suggested.code),
              ),
            ),
          ),
        if (showSub) ...[
          const SizedBox(height: Spacing.spacing4),
          SearchablePickerField<String>(
            key: const ValueKey('location-subdivision'),
            label: label,
            options: subOptions,
            value: _sub,
            // Disabled until a country is chosen (and while its list loads).
            onChanged: country == null || _subs == null || _saving ? null : (code) => setState(() => _sub = code),
          ),
          if (_tried && country != null && _sub == null)
            _Error(l10n.locationSubdivisionError(label), key: const ValueKey('location-subdivision-error')),
        ],
        const SizedBox(height: Spacing.spacing5),
        // Expanded: this app's buttons are full-width blocks and assert unbounded.
        Row(
          children: [
            if (widget.secondaryLabel != null) ...[
              Expanded(
                child: TextButton(
                  key: const ValueKey('location-secondary'),
                  onPressed: _saving ? null : widget.onSecondary,
                  child: Text(widget.secondaryLabel!),
                ),
              ),
              const SizedBox(width: Spacing.spacing3),
            ],
            Expanded(
              child: FilledButton(
                key: const ValueKey('location-save'),
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(l10n.profileSave),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _Error extends StatelessWidget {
  const _Error(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: Spacing.spacing2),
        child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error)),
      );
}
