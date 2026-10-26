import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_billing.dart';
import '../../../shared/utils/text_direction.dart';
import '../domain/amount_due.dart';
import '../domain/money_format.dart';
import 'my_payments_screen.dart';

/// PD-27: the rows of the Payments screen's "Amount due", "Transfer receipts" and
/// "Invoices" sections.

/// "3-month plan · Sep 1, 2026 – Nov 30, 2026", or whichever half is known; null when
/// neither is. PD-30: with the lessons it buys, "3 Months — 24 Lessons · Sep 1 – Nov 30".
String? packageLine(int? planMonths, DateTime? start, DateTime? end, L10n l10n, String locale, {int? lessons}) {
  final day = DateFormat.yMMMd(locale).format;
  final parts = [
    if (lessons != null)
      planLessonsLine(planMonths, lessons, l10n)
    else if (planMonths != null)
      l10n.billingPlanMonths(planMonths),
    if (start != null && end != null) l10n.billingPeriod(day(start), day(end)),
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

/// PD-30: a package as the owner asked for it -- "3 Months — 24 Lessons", or "24 Lessons"
/// when it has no length.
String planLessonsLine(int? planMonths, int lessons, L10n l10n) => planMonths == null || planMonths <= 0
    ? l10n.subscriptionLessonCount(lessons)
    : l10n.subscriptionPlanLessons(l10n.subscriptionMonthCount(planMonths), l10n.subscriptionLessonCount(lessons));

class _Row extends StatelessWidget {
  const _Row({required this.lines, required this.trailing, this.onTap});

  final List<Widget> lines;
  final List<Widget> trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < lines.length; i++) ...[
                  if (i > 0) const SizedBox(height: Spacing.spacing1),
                  lines[i],
                ],
              ],
            ),
          ),
          const SizedBox(width: Spacing.spacing3),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (var i = 0; i < trailing.length; i++) ...[
                if (i > 0) const SizedBox(height: Spacing.spacing2),
                trailing[i],
              ],
            ],
          ),
        ],
      ),
    );
    return onTap == null ? row : InkWell(onTap: onTap, child: row);
  }
}

/// One thing to pay now: what is left of it, for whom, for what, by when -- and Pay.
class DueTile extends StatelessWidget {
  const DueTile({super.key, required this.item, required this.confirming, required this.onPay});

  final DueItem item;

  /// A card checkout was opened for it and the server has not yet said it is paid.
  final bool confirming;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final secondary = theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary);
    String money(int minor) => formatMoney(minor, item.currency, locale);

    final days = item.days;
    final due = item.dueDate == null
        ? null
        : [
            l10n.billingDueOn(DateFormat.yMMMd(locale).format(item.dueDate!)),
            if (item.status == InstalmentStatus.overdue && days != null && days > 0) l10n.billingDaysLate(days),
          ].join(' · ');
    final package = packageLine(item.planMonths, item.periodStart, item.periodEnd, l10n, locale, lessons: item.lessonsIncluded);

    return Column(
      key: ValueKey('billing-due-${item.key}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Row(
          lines: [
            ContentText(item.label, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            ContentText(item.childName ?? l10n.billingFamily, style: secondary),
            if (package != null) Text(package, style: secondary),
            if (due != null)
              Text(due,
                  style: item.status == InstalmentStatus.overdue
                      ? theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg)
                      : secondary),
            if (item.partial)
              Text(l10n.billingPaidOfTotal(money(item.paidMinor), money(item.amountMinor)),
                  style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusWarningFg)),
          ],
          trailing: [
            Text(money(item.remainingMinor), style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            FilledButton(
              key: ValueKey('billing-pay-${item.key}'),
              // The theme's buttons span their parent; this one sits beside the text.
              style: FilledButton.styleFrom(minimumSize: const Size(72, Sizes.minTouchTarget)),
              onPressed: onPay,
              child: Text(l10n.billingPay),
            ),
          ],
        ),
        if (confirming)
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing3),
            child: DecoratedBox(
              key: ValueKey('billing-confirming-${item.key}'),
              decoration: BoxDecoration(color: tokens.colorStatusInfoBg, borderRadius: BorderRadius.circular(Spacing.spacing3)),
              child: Padding(
                padding: const EdgeInsets.all(Spacing.spacing3),
                child: Row(
                  children: [
                    // Static on purpose: the wait can be minutes, and a spinner that long
                    // reads as stuck.
                    Icon(Icons.hourglass_top, size: 16, color: tokens.colorStatusInfoFg),
                    const SizedBox(width: Spacing.spacing3),
                    Expanded(
                      child: Text(l10n.billingConfirmingPayment,
                          style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusInfoFg)),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// A bank-transfer receipt the family sent, and where the academy stands on it.
class ReceiptTile extends StatelessWidget {
  const ReceiptTile({super.key, required this.receipt, this.onOpen});

  final PaymentReceipt receipt;

  /// Opens the uploaded file; null when the server sent no link.
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final secondary = theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary);
    final r = receipt;
    final chip = switch (r.status) {
      ReceiptStatus.pending => (l10n.billingReceiptPending, tokens.colorStatusWarningFg, tokens.colorStatusWarningBg),
      ReceiptStatus.approved => (l10n.billingReceiptApproved, tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
      ReceiptStatus.rejected => (l10n.billingReceiptRejected, tokens.colorStatusDangerFg, tokens.colorStatusDangerBg),
      null => null,
    };

    return KeyedSubtree(
      key: ValueKey('billing-receipt-${r.id}'),
      child: _Row(
        onTap: onOpen,
        lines: [
          ContentText(r.label.isEmpty ? l10n.billingMethodBankTransfer : r.label,
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          if (r.transferredOn != null)
            Text(l10n.billingTransferredOn(DateFormat.yMMMd(locale).format(r.transferredOn!)), style: secondary),
          if (r.note != null) ContentText(r.note!, style: secondary),
          if (r.status == ReceiptStatus.rejected && r.rejectReason != null)
            ContentText(l10n.billingReceiptRejectReason(r.rejectReason!),
                style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg)),
        ],
        trailing: [
          Text(formatMoney(r.amountMinor, r.currency, locale),
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          if (chip != null) BillingChip(label: chip.$1, foreground: chip.$2, background: chip.$3),
        ],
      ),
    );
  }
}

/// One invoice: its number, when and how it was paid, for what, and Download.
class InvoiceTile extends StatelessWidget {
  const InvoiceTile({super.key, required this.invoice, required this.onDownload});

  final BillingInvoice invoice;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final secondary = theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary);
    final day = DateFormat.yMMMd(locale).format;
    final v = invoice;

    final issued = v.issuedAt ?? v.paidOn;
    final method = methodLabel(v.method, l10n);
    final when = [
      if (issued != null) l10n.billingInvoiceIssued(day(issued)),
      ?method,
    ].join(' · ');
    final what = [
      if (v.label.isNotEmpty) v.label,
      ?v.childName,
    ].join(' · ');
    final package = packageLine(v.planMonths, v.periodStart, v.periodEnd, l10n, locale, lessons: v.lessonsIncluded);
    final chip = switch (v.status) {
      InvoiceStatus.paid => (l10n.billingStatusPaid, tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
      InvoiceStatus.partiallyRefunded =>
        (l10n.billingInvoicePartiallyRefunded, tokens.colorStatusWarningFg, tokens.colorStatusWarningBg),
      InvoiceStatus.refunded => (l10n.billingInvoiceRefunded, tokens.colorStatusNeutralFg, tokens.colorStatusNeutralBg),
      InvoiceStatus.voided || null => null,
    };

    return KeyedSubtree(
      key: ValueKey('billing-invoice-${v.id}'),
      child: _Row(
        lines: [
          // The number is Latin and digits: always left to right, even in Arabic.
          Text(v.number,
              textDirection: TextDirection.ltr,
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          if (what.isNotEmpty) ContentText(what, style: secondary),
          if (package != null) Text(package, style: secondary),
          if (when.isNotEmpty) Text(when, style: secondary),
          if (v.refundedMinor > 0)
            Text(l10n.billingRefundedAmount(formatMoney(v.refundedMinor, v.currency, locale)), style: secondary),
        ],
        trailing: [
          Text(formatMoney(v.amountMinor, v.currency, locale),
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          if (chip != null) BillingChip(label: chip.$1, foreground: chip.$2, background: chip.$3),
          IconButton(
            key: ValueKey('billing-invoice-download-${v.id}'),
            tooltip: l10n.billingInvoiceDownload,
            icon: const Icon(Icons.download_outlined),
            onPressed: onDownload,
          ),
        ],
      ),
    );
  }
}
