import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/text_direction.dart';

/// PD-30: what stands where the composer was, in a group locked for payment.
///
/// It names each locked child. A parent reads why ("Adam: lessons used up", "Adam:
/// instalment 2/3 overdue since Oct 2, 2026") and gets the way to Subscriptions, opened
/// at that child; a teacher reads only that the child's lessons are paused -- the server
/// sends a teacher no reason, so none can be shown.
///
/// Advisory, like the lock it draws: every send is refused by the server on its own.
class PaymentLockBanner extends StatelessWidget {
  const PaymentLockBanner({super.key, required this.lock, this.onOpenSubscriptions});

  final PaymentLock lock;

  /// Opens Subscriptions at the child; null hides the button (also when ![lock.canPay]).
  final ValueChanged<String>? onOpenSubscriptions;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final canPay = lock.canPay && onOpenSubscriptions != null;
    final lineStyle = theme.textTheme.bodyMedium?.copyWith(color: tokens.colorStatusWarningFg);

    return SafeArea(
      top: false,
      child: DecoratedBox(
        key: const ValueKey('payment-lock-banner'),
        decoration: BoxDecoration(
          color: tokens.colorStatusWarningBg,
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
                  Icon(Icons.pause_circle_outline, size: 20, color: tokens.colorStatusWarningFg),
                  const SizedBox(width: Spacing.spacing2),
                  Expanded(
                    child: Text(
                      l10n.lockBannerTitle,
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: tokens.colorStatusWarningFg,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              if (lock.children.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: Spacing.spacing1),
                  child: Text(l10n.lockBannerGeneric, style: lineStyle),
                ),
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
            ],
          ),
        ),
      ),
    );
  }
}

/// One child's lines: a reason each when the server sent reasons (a parent, staff),
/// otherwise only that the lessons are paused (a teacher).
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
