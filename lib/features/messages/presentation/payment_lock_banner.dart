import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/text_direction.dart';

/// PD-30 amendment, D-3 (owner, 2026-11-06): a strip ABOVE the composer, in a group with a
/// child whose new lesson bookings are paused. It never replaces the composer: the chat
/// stays open for everyone, and lessons already booked go ahead.
///
/// - A parent reads why for each child ("Adam: lessons used up", "Adam: instalment 2/3
///   overdue since Oct 2, 2026") and gets the way to Subscriptions, opened at that child.
/// - A teacher reads only the heading and that the chat stays open. Nothing financial and
///   no child line: [financial] is false for a teacher, and the server sends a teacher no
///   reason either.
class PaymentLockBanner extends StatelessWidget {
  const PaymentLockBanner({super.key, required this.lock, required this.financial, this.onOpenSubscriptions});

  final PaymentLock lock;

  /// Whether this viewer may read the family's financial state (a parent, staff); false for a teacher.
  final bool financial;

  /// Opens Subscriptions at the child; null hides the button (also when ![lock.canPay]).
  final ValueChanged<String>? onOpenSubscriptions;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final canPay = financial && lock.canPay && onOpenSubscriptions != null;
    final lineStyle = theme.textTheme.bodyMedium?.copyWith(color: tokens.colorStatusInfoFg);

    return DecoratedBox(
      key: const ValueKey('payment-lock-banner'),
      decoration: BoxDecoration(
        color: tokens.colorStatusInfoBg,
        border: Border(top: BorderSide(color: tokens.colorBorderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.info_outline, size: 20, color: tokens.colorStatusInfoFg),
                const SizedBox(width: Spacing.spacing2),
                Expanded(
                  child: Text(
                    l10n.lockBannerTitle,
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: tokens.colorStatusInfoFg,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            if (financial)
              for (final child in lock.children)
                Padding(
                  key: ValueKey('payment-lock-child-${child.id}'),
                  padding: const EdgeInsets.only(top: Spacing.spacing2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final line in lockLines(child, l10n, locale)) ContentText(line, style: lineStyle),
                          ],
                        ),
                      ),
                      if (canPay) ...[
                        const SizedBox(width: Spacing.spacing3),
                        FilledButton(
                          key: ValueKey('payment-lock-open-${child.id}'),
                          // The theme's buttons span their parent; this one sits beside the text.
                          style: FilledButton.styleFrom(minimumSize: const Size(72, Sizes.minTouchTarget)),
                          onPressed: () => onOpenSubscriptions!(child.id),
                          child: Text(l10n.lockBannerOpenSubscriptions),
                        ),
                      ],
                    ],
                  ),
                ),
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Text(l10n.lockBannerGeneric, style: lineStyle),
            ),
          ],
        ),
      ),
    );
  }
}

/// One child's lines, for a viewer who may read why: a reason each when the server sent
/// reasons, otherwise only that the child's new lessons are paused.
List<String> lockLines(LockedChild child, L10n l10n, String locale) {
  final lines = <String>[
    if (child.reasons.contains('balance')) l10n.lockBannerChildBalance(child.name),
    if (child.reasons.contains('overdue') && child.overdueDueDate != null)
      l10n.lockBannerChildOverdue(
        child.name,
        child.overdueLabel ?? '',
        DateFormat.yMMMd(locale).format(
          DateTime(child.overdueDueDate!.year, child.overdueDueDate!.month, child.overdueDueDate!.day + 1),
        ),
      ),
  ];
  return lines.isEmpty ? [l10n.lockBannerChildPaused(child.name)] : lines;
}
