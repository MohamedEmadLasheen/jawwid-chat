import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';

/// WCAG 2.x contrast, measured on the theme the app actually ships (owner report
/// 2026-10-24: the Schedule's status pills were light text on a light pill).
///
/// AA asks 4.5:1 of body text, 3:1 of large text and of the parts of a control
/// that identify it (1.4.11). Every pair below is one the app draws: a token
/// family's on-X over its X, and text over every ground it can sit on. A new
/// token or a changed shade that drops below AA fails here, by name.
void main() {
  for (final (name, theme, tokens) in [
    ('light', JawwidTheme.light(isArabic: false), JawwidTokens.light),
    ('dark', JawwidTheme.dark(isArabic: false), JawwidTokens.dark),
    ('light ar', JawwidTheme.light(isArabic: true), JawwidTokens.light),
  ]) {
    final s = theme.colorScheme;
    final grounds = <String, Color>{
      'page': tokens.colorBackgroundPage,
      'sunken': tokens.colorBackgroundSunken,
      'surface': tokens.colorSurfaceDefault,
      'surfaceMuted': tokens.colorSurfaceMuted,
      'surfaceContainerLowest': s.surfaceContainerLowest,
      'surfaceContainerLow': s.surfaceContainerLow,
      'surfaceContainer': s.surfaceContainer,
      'surfaceContainerHigh': s.surfaceContainerHigh,
      'surfaceContainerHighest': s.surfaceContainerHighest,
    };

    group('$name theme', () {
      test('text tokens clear 4.5:1 on every ground', () {
        final text = <String, Color>{
          'textPrimary': tokens.colorTextPrimary,
          'textSecondary': tokens.colorTextSecondary,
          'textMuted': tokens.colorTextMuted,
          'textLink': tokens.colorTextLink,
          'primary (headings, links)': s.primary,
          'secondary (gold text)': s.secondary,
          'error': s.error,
        };
        final failures = <String>[
          for (final t in text.entries)
            for (final g in grounds.entries)
              if (contrast(t.value, g.value) < 4.5)
                '${t.key} on ${g.key}: ${contrast(t.value, g.value).toStringAsFixed(2)}',
          // Secondary and muted text also sit on the raised surface and the
          // brand-subtle ground (selected rows, the outgoing bubble).
          for (final t in {'textSecondary': tokens.colorTextSecondary, 'textMuted': tokens.colorTextMuted}.entries)
            for (final g in {'raised': tokens.colorSurfaceRaised, 'brandSubtle': tokens.colorBrandSubtle}.entries)
              if (contrast(t.value, g.value) < 4.5)
                '${t.key} on ${g.key}: ${contrast(t.value, g.value).toStringAsFixed(2)}',
        ];
        expect(failures, isEmpty);
      });

      test('every on-X clears 4.5:1 on its X', () {
        final pairs = <String, (Color, Color)>{
          'onPrimary/primary': (s.onPrimary, s.primary),
          'onPrimaryContainer/primaryContainer': (s.onPrimaryContainer, s.primaryContainer),
          'onSecondary/secondary': (s.onSecondary, s.secondary),
          'onSecondaryContainer/secondaryContainer': (s.onSecondaryContainer, s.secondaryContainer),
          'onTertiary/tertiary': (s.onTertiary, s.tertiary),
          'onTertiaryContainer/tertiaryContainer': (s.onTertiaryContainer, s.tertiaryContainer),
          'onError/error': (s.onError, s.error),
          'onErrorContainer/errorContainer': (s.onErrorContainer, s.errorContainer),
          'onInverseSurface/inverseSurface': (s.onInverseSurface, s.inverseSurface),
          'brandOnPrimary/brandPrimary': (tokens.colorBrandOnPrimary, tokens.colorBrandPrimary),
          'accentStrong/accentSubtle': (tokens.colorAccentStrong, tokens.colorAccentSubtle),
          'success': (tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
          'warning': (tokens.colorStatusWarningFg, tokens.colorStatusWarningBg),
          'danger': (tokens.colorStatusDangerFg, tokens.colorStatusDangerBg),
          'info': (tokens.colorStatusInfoFg, tokens.colorStatusInfoBg),
          'neutral': (tokens.colorStatusNeutralFg, tokens.colorStatusNeutralBg),
          'trial badge': (tokens.trialBadgeFg, tokens.trialBadgeBg),
          'incoming bubble': (tokens.colorMessageIncomingText, tokens.colorMessageIncomingBg),
          'outgoing bubble': (tokens.colorMessageOutgoingText, tokens.colorMessageOutgoingBg),
          'system message': (tokens.colorMessageSystemText, tokens.colorMessageSystemBg),
          'pending bubble': (tokens.colorMessageIncomingText, tokens.colorMessagePendingBg),
          for (final g in grounds.entries) ...{
            'onSurface/${g.key}': (s.onSurface, g.value),
            'onSurfaceVariant/${g.key}': (s.onSurfaceVariant, g.value),
          },
        };
        final failures = [
          for (final p in pairs.entries)
            if (contrast(p.value.$1, p.value.$2) < 4.5) '${p.key}: ${contrast(p.value.$1, p.value.$2).toStringAsFixed(2)}',
        ];
        expect(failures, isEmpty);
      });

      test('the parts that identify a control clear 3:1', () {
        final ui = <String, Color>{
          'outline (field border, switch track)': s.outline,
          'borderFocus': tokens.colorBorderFocus,
          'primary (radio, switch, indicator)': s.primary,
          'textSecondary (unselected icons)': tokens.colorTextSecondary,
        };
        final failures = [
          for (final u in ui.entries)
            for (final g in grounds.entries)
              if (contrast(u.value, g.value) < 3) '${u.key} on ${g.key}: ${contrast(u.value, g.value).toStringAsFixed(2)}',
          if (contrast(theme.navigationBarTheme.indicatorColor!, _selectedNavIcon(theme)) < 3) 'selected tab icon on its indicator',
        ];
        expect(failures, isEmpty);
      });

      testWidgets('a chip label is drawn in a colour that reads on its pill', (tester) async {
        // The bug this guards: a theme labelStyle without a colour drew plain Chip
        // labels in the engine default -- white on a light pill.
        await tester.pumpWidget(MaterialApp(
          theme: theme,
          home: Scaffold(
            body: Wrap(children: [
              const Chip(key: ValueKey('plain'), label: Text('Upcoming')),
              FilterChip(key: const ValueKey('off'), label: const Text('Unread'), selected: false, onSelected: (_) {}),
              FilterChip(key: const ValueKey('on'), label: const Text('All'), selected: true, onSelected: (_) {}),
              ChoiceChip(key: const ValueKey('choice'), label: const Text('Good'), selected: true, onSelected: (_) {}),
            ]),
          ),
        ));
        final chipTheme = theme.chipTheme;
        for (final (key, ground) in [
          ('plain', chipTheme.backgroundColor!),
          ('off', chipTheme.backgroundColor!),
          ('on', chipTheme.selectedColor!),
          ('choice', chipTheme.selectedColor!),
        ]) {
          final text = tester.widget<RichText>(
            find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(RichText)).first,
          );
          final color = _effectiveColor(text.text);
          expect(color, isNotNull, reason: '$key chip label has no colour of its own');
          expect(contrast(color!, ground), greaterThanOrEqualTo(4.5),
              reason: '$key chip: ${contrast(color, ground).toStringAsFixed(2)}:1');
        }
      });

      test('tab labels carry a colour that reads on the bar', () {
        final style = theme.navigationBarTheme.labelTextStyle!;
        final bar = theme.navigationBarTheme.backgroundColor!;
        for (final states in [<WidgetState>{}, {WidgetState.selected}]) {
          final c = style.resolve(states)?.color;
          expect(c, isNotNull);
          expect(contrast(c!, bar), greaterThanOrEqualTo(4.5));
        }
      });
    });
  }
}

Color _selectedNavIcon(ThemeData theme) => theme.navigationBarTheme.iconTheme!.resolve({WidgetState.selected})!.color!;

Color? _effectiveColor(InlineSpan span) {
  Color? found = span.style?.color;
  span.visitChildren((child) {
    found = child.style?.color ?? found;
    return true;
  });
  return found;
}

double contrast(Color a, Color b) {
  double channel(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  double lum(Color c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  final la = lum(a), lb = lum(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}
