import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_billing.dart';
import '../../../shared/utils/text_direction.dart';
import 'my_payments_screen.dart' show BillingChip;
import 'payment_sections.dart';

/// PD-30: one child's subscription, above the family's payments: the plan ("3 Months —
/// 24 Lessons"), the lessons left, the grace lessons, and -- when the child is locked --
/// why, with Pay (something is open to pay) or Request renewal (nothing is yet).
///
/// Nothing here is about an exception: the server never sends one to a parent, and a
/// child an exception lets go on simply reads as open.
class ChildSubscriptionCard extends StatelessWidget {
  const ChildSubscriptionCard({
    super.key,
    required this.subscription,
    required this.onPay,
    required this.onRequestRenewal,
    this.renewalRequested = false,
    this.requesting = false,
    this.focused = false,
  });

  final ChildSubscription subscription;

  /// Jump to what is open to pay.
  final VoidCallback onPay;
  final VoidCallback onRequestRenewal;

  /// Asked for today -- by the server's answer or by a tap in this session.
  final bool renewalRequested;

  /// The request is on its way.
  final bool requesting;

  /// Opened at this child (the locked banner's button): drawn with an outline.
  final bool focused;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final s = subscription;
    final id = s.childId;
    final secondary = theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary);

    final current = s.current;
    final plan = current != null
        ? planLessonsLine(current.planMonths, current.lessonsIncluded, l10n)
        : s.lessonsIncluded != null
            ? l10n.subscriptionLessonCount(s.lessonsIncluded!)
            : l10n.subscriptionNone;

    final chip = switch (s.state) {
      SubscriptionState.open => (l10n.subscriptionStateOpen, tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
      SubscriptionState.grace => (l10n.subscriptionStateGrace, tokens.colorStatusWarningFg, tokens.colorStatusWarningBg),
      SubscriptionState.locked => (l10n.subscriptionStateLocked, tokens.colorStatusDangerFg, tokens.colorStatusDangerBg),
    };

    final locked = s.state == SubscriptionState.locked;
    final reasons = locked ? lockReasonLines(s, l10n, locale) : const <String>[];

    return Card(
      key: ValueKey('subscription-card-$id'),
      margin: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing2),
      shape: focused
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Spacing.spacing3),
              side: BorderSide(color: theme.colorScheme.primary, width: 2),
            )
          : null,
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: ContentText(
                    s.childName,
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: Spacing.spacing3),
                BillingChip(
                  key: ValueKey('subscription-state-$id'),
                  label: chip.$1,
                  foreground: chip.$2,
                  background: chip.$3,
                ),
              ],
            ),
            const SizedBox(height: Spacing.spacing2),
            Text(plan, key: ValueKey('subscription-plan-$id'), style: theme.textTheme.bodyMedium),
            if (s.lessonsLeft != null && s.state != SubscriptionState.grace) ...[
              const SizedBox(height: Spacing.spacing1),
              Text(l10n.subscriptionLessonsLeft(s.lessonsLeft!), key: ValueKey('subscription-left-$id'), style: secondary),
            ],
            if (s.state == SubscriptionState.grace && s.graceLeft != null) ...[
              const SizedBox(height: Spacing.spacing1),
              Text(
                l10n.subscriptionGraceLeft(s.graceLeft!),
                key: ValueKey('subscription-grace-$id'),
                style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusWarningFg, fontWeight: FontWeight.w600),
              ),
            ],
            if (locked) ...[
              for (final line in reasons) ...[
                const SizedBox(height: Spacing.spacing1),
                ContentText(
                  line,
                  style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg, fontWeight: FontWeight.w600),
                ),
              ],
              const SizedBox(height: Spacing.spacing3),
              if (s.hasOpenPayment)
                FilledButton(
                  key: ValueKey('subscription-pay-$id'),
                  onPressed: onPay,
                  child: Text(l10n.billingPay),
                )
              else if (renewalRequested || s.renewalRequestedToday)
                OutlinedButton.icon(
                  key: ValueKey('subscription-renewal-requested-$id'),
                  onPressed: null,
                  icon: const Icon(Icons.check),
                  label: Text(l10n.subscriptionRenewalRequested),
                )
              else
                OutlinedButton(
                  key: ValueKey('subscription-renew-$id'),
                  onPressed: requesting ? null : onRequestRenewal,
                  child: Text(l10n.subscriptionRequestRenewal),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Why a child is locked, one line per reason: "Lessons used up", "Instalment 2/3
/// overdue since Oct 2, 2026" (the day after its due date: unpaid by the due date,
/// it is overdue from the next day).
List<String> lockReasonLines(ChildSubscription s, L10n l10n, String locale) => [
      if (s.lockReasons.contains(LockReason.balance)) l10n.subscriptionLessonsUsedUp,
      if (s.lockReasons.contains(LockReason.overdue) && s.overdue != null)
        l10n.subscriptionOverdueSince(s.overdue!.label, overdueSinceLabel(s.overdue!.dueDate, locale)),
    ];

/// The first day an instalment is overdue -- the day after [dueDate] -- in the reader's
/// format.
String overdueSinceLabel(DateTime dueDate, String locale) =>
    DateFormat.yMMMd(locale).format(DateTime(dueDate.year, dueDate.month, dueDate.day + 1));
