import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../shared/utils/search_text.dart';
import '../../shared/utils/text_direction.dart';
import '../tokens.dart';

/// One choice in a [SearchablePickerField] or [showSearchablePicker].
@immutable
class PickerOption<T> {
  const PickerOption({required this.value, required this.label, this.hint, this.enabled = true});

  final T value;
  final String label;

  /// Secondary text under the label, searched with it (an e-mail, a role).
  final String? hint;
  final bool enabled;
}

/// Wider than this, the picker is a dialog; narrower (a phone), a bottom sheet.
const double kPickerDialogMinWidth = 600;

/// Opens the list with a search field on top (owner 2026-10-29: every list can
/// be typed into as well as chosen from), and returns the chosen option, or
/// null when dismissed.
///
/// Typing filters by every word in any order, folded with [SearchText]: no
/// tashkeel or tatweel, one alef, ى/ي and ة/ه alike, Arabic-Indic digits as
/// ASCII. On a phone it is a bottom sheet that rises above the keyboard; on a
/// wide screen (the teacher web portal) a dialog. Enter picks the first match.
Future<PickerOption<T>?> showSearchablePicker<T>(
  BuildContext context, {
  required String title,
  required List<PickerOption<T>> options,
  T? selected,
}) {
  final body = _PickerBody<T>(title: title, options: options, selected: selected);
  if (MediaQuery.sizeOf(context).width >= kPickerDialogMinWidth) {
    return showDialog<PickerOption<T>>(
      context: context,
      builder: (_) => Dialog(
        child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480, maxHeight: 560), child: body),
      ),
    );
  }
  return showModalBottomSheet<PickerOption<T>>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (sheetContext) => Padding(
      // Rise above the on-screen keyboard while searching.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom),
      child: FractionallySizedBox(heightFactor: 0.75, child: body),
    ),
  );
}

/// A form field that shows the chosen option and opens [showSearchablePicker]
/// on tap: the replacement for `DropdownButtonFormField` everywhere.
class SearchablePickerField<T> extends StatelessWidget {
  const SearchablePickerField({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
    required this.label,
    this.decoration,
  });

  final List<PickerOption<T>> options;
  final T? value;

  /// Null disables the field.
  final ValueChanged<T>? onChanged;

  /// The field's label, and the title of the list it opens.
  final String label;

  /// Replaces the default outlined decoration (its labelText is set from [label]
  /// unless the decoration hides it).
  final InputDecoration? decoration;

  @override
  Widget build(BuildContext context) {
    final chosen = options.where((o) => o.value == value).firstOrNull;
    final enabled = onChanged != null;
    final deco = (decoration ?? const InputDecoration()).copyWith(
      labelText: decoration?.labelText ?? label,
      enabled: enabled,
      suffixIcon: const Icon(Icons.arrow_drop_down),
    );
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      value: chosen?.label,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: const BorderRadius.all(Radii.radiusMd),
        onTap: !enabled
            ? null
            : () async {
                final picked = await showSearchablePicker<T>(context, title: label, options: options, selected: value);
                if (picked != null && picked.value != value) onChanged!(picked.value);
              },
        child: InputDecorator(
          decoration: deco,
          isEmpty: chosen == null,
          child: chosen == null ? null : ContentText(chosen.label, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

class _PickerBody<T> extends StatefulWidget {
  const _PickerBody({required this.title, required this.options, required this.selected});

  final String title;
  final List<PickerOption<T>> options;
  final T? selected;

  @override
  State<_PickerBody<T>> createState() => _PickerBodyState<T>();
}

class _PickerBodyState<T> extends State<_PickerBody<T>> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  List<PickerOption<T>> get _shown =>
      [for (final o in widget.options) if (SearchText.matchesAllWords(_query.text, [o.label, o.hint])) o];

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final shown = _shown;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing5, Spacing.spacing3),
          child: Text(widget.title, style: theme.textTheme.titleMedium),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
          child: TextField(
            key: const ValueKey('picker-search'),
            controller: _query,
            // A long list starts with the keyboard up; a short one need not.
            autofocus: widget.options.length > 8,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: l10n.pickerSearchHint,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.text.isEmpty
                  ? null
                  : IconButton(
                      key: const ValueKey('picker-search-clear'),
                      tooltip: l10n.searchClear,
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(_query.clear),
                    ),
            ),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) {
              // From the text as it is now, not the list of the last build.
              final first = _shown.where((o) => o.enabled).firstOrNull;
              if (first != null) Navigator.of(context).pop(first);
            },
          ),
        ),
        const SizedBox(height: Spacing.spacing3),
        Flexible(
          child: shown.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(Spacing.spacing5),
                  child: Text(
                    l10n.pickerNoMatches,
                    key: const ValueKey('picker-no-matches'),
                    style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.builder(
                  shrinkWrap: true,
                  itemCount: shown.length,
                  itemBuilder: (context, i) {
                    final o = shown[i];
                    final isSelected = o.value == widget.selected;
                    return ListTile(
                      enabled: o.enabled,
                      selected: isSelected,
                      title: ContentText(o.label),
                      subtitle: o.hint == null ? null : ContentText(o.hint!),
                      trailing: isSelected ? const Icon(Icons.check) : null,
                      onTap: () => Navigator.of(context).pop(o),
                    );
                  },
                ),
        ),
        const SizedBox(height: Spacing.spacing3),
      ],
    );
  }
}
