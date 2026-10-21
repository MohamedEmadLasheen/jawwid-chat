import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_billing.dart';
import '../../../shared/utils/text_direction.dart';
import '../../profile/presentation/profile_sections.dart';
import '../application/my_billing_provider.dart';
import '../domain/money_format.dart';

/// PD-17: "Payments" -- the parent's own plan, what has been paid and what is still
/// owed, then every instalment in due-date order.
///
/// Parents only -- every parent of the family (PD-17, "both parents"): the route
/// sends a teacher away, and the server refuses anyone else. That refusal is a plain
/// sentence naming who does see this, not an error to retry -- asking again cannot
/// make someone a parent of the family.
class MyPaymentsScreen extends ConsumerWidget {
  const MyPaymentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(myBillingProvider);
    Future<void> refresh() => ref.refresh(myBillingProvider.future).then((_) {}, onError: (_) {});

    return Scaffold(
      appBar: AppBar(title: Text(l10n.myPaymentsTitle)),
      // A pull keeps the list on screen while it reloads (`when` skips the loading
      // state on a refresh); a principal change still blanks it.
      body: state.when(
        loading: () => const JawwidLoadingView(),
        error: (error, _) => _Error(error: error, onRetry: () => ref.invalidate(myBillingProvider)),
        data: (billing) => RefreshIndicator(
          onRefresh: refresh,
          child: _Body(billing: billing),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.billing});

  final ParentBilling billing;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return ListView(
      // Always scrollable, so a short list can still be pulled to refresh.
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
      children: [
        _Summary(billing: billing),
        ProfileSectionHeading(text: l10n.billingInstalmentsTitle),
        if (billing.instalments.isEmpty)
          JawwidEmptyView(
            icon: Icons.receipt_long_outlined,
            title: l10n.billingEmptyTitle,
            body: l10n.billingEmptyBody,
          )
        else
          for (final instalment in billing.instalments) _InstalmentTile(instalment: instalment),
      ],
    );
  }
}

/// The plan, how it is paid, and per currency: paid, outstanding, and how much of the
/// outstanding is already late.
class _Summary extends StatelessWidget {
  const _Summary({required this.billing});

  final ParentBilling billing;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final months = billing.planMonths;

    Widget row(String label, String value, {Color? color, Key? key}) => Padding(
          key: key,
          padding: const EdgeInsets.symmetric(vertical: Spacing.spacing2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextSecondary)),
              ),
              const SizedBox(width: Spacing.spacing3),
              Text(value, style: theme.textTheme.bodyMedium?.copyWith(color: color ?? tokens.colorTextPrimary, fontWeight: FontWeight.w600)),
            ],
          ),
        );

    return Card(
      key: const ValueKey('billing-summary'),
      margin: const EdgeInsets.all(Spacing.spacing4),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              months == null || months <= 0 ? l10n.billingNoPlan : l10n.billingPlanMonths(months),
              key: const ValueKey('billing-plan'),
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: Spacing.spacing2),
            row(l10n.billingMethodLabel, methodLabel(billing.paymentMethod, l10n) ?? l10n.billingNotSet, key: const ValueKey('billing-method')),
            for (final total in billing.totals) ...[
              const Divider(height: Spacing.spacing5),
              row(l10n.billingPaidTotal, formatMoney(total.paidMinor, total.currency, locale), color: tokens.colorStatusSuccessFg,
                  key: ValueKey('billing-paid-${total.currency}')),
              row(l10n.billingOutstandingTotal, formatMoney(total.outstandingMinor, total.currency, locale),
                  key: ValueKey('billing-outstanding-${total.currency}')),
              row(
                l10n.billingOverdueTotal,
                formatMoney(total.overdueMinor, total.currency, locale),
                color: total.overdueMinor > 0 ? tokens.colorStatusDangerFg : tokens.colorTextSecondary,
                key: ValueKey('billing-overdue-${total.currency}'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// How a family pays, in the reader's words; null when the server sent none or one
/// this build does not know.
String? methodLabel(BillingMethod? method, L10n l10n) => switch (method) {
      BillingMethod.invoice => l10n.billingMethodInvoice,
      BillingMethod.bankTransfer => l10n.billingMethodBankTransfer,
      null => null,
    };

class _InstalmentTile extends StatelessWidget {
  const _InstalmentTile({required this.instalment});

  final BillingInstalment instalment;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    // With the year: a twelve-month plan crosses one.
    final day = DateFormat.yMMMd(locale).format;
    final i = instalment;
    final payment = i.payment;

    final days = i.days;
    final when = [
      l10n.billingDueOn(day(i.dueDate)),
      if (i.status == InstalmentStatus.overdue && days != null && days > 0) l10n.billingDaysLate(days),
      if (i.status == InstalmentStatus.upcoming && days != null && days > 0) l10n.billingDaysUntil(days),
    ].join(' · ');

    String? paidLine;
    if (payment != null) {
      final date = day(payment.paidOn);
      final method = methodLabel(payment.method, l10n);
      paidLine = method == null ? l10n.billingPaidOnNoMethod(date) : l10n.billingPaidOn(date, method);
      if (payment.reference != null) paidLine = '$paidLine · ${payment.reference}';
    }

    return Padding(
      key: ValueKey('billing-instalment-${i.id}'),
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ContentText(i.label, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: Spacing.spacing1),
                ContentText(i.childName ?? l10n.billingFamily, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
                const SizedBox(height: Spacing.spacing1),
                Text(when, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
                if (paidLine != null) ...[
                  const SizedBox(height: Spacing.spacing1),
                  ContentText(paidLine, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusSuccessFg)),
                ],
              ],
            ),
          ),
          const SizedBox(width: Spacing.spacing3),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(formatMoney(i.amountMinor, i.currency, locale), style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              if (i.status != null) ...[
                const SizedBox(height: Spacing.spacing2),
                _StatusChip(status: i.status!),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final InstalmentStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final (label, fg, bg) = switch (status) {
      InstalmentStatus.overdue => (l10n.billingStatusOverdue, tokens.colorStatusDangerFg, tokens.colorStatusDangerBg),
      InstalmentStatus.due => (l10n.billingStatusDue, tokens.colorStatusWarningFg, tokens.colorStatusWarningBg),
      InstalmentStatus.upcoming => (l10n.billingStatusUpcoming, tokens.colorStatusInfoFg, tokens.colorStatusInfoBg),
      InstalmentStatus.paid => (l10n.billingStatusPaid, tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
    };
    return DecoratedBox(
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Spacing.spacing5)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing3, vertical: Spacing.spacing1),
        child: Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg, fontWeight: FontWeight.w700)),
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final appError = asAppErrorOf(error);

    // COMM.BILLING_DENIED: this parent does not hold billing for the family. Said
    // plainly, with no retry -- asking again cannot change who is responsible.
    if (appError.kind == AppErrorKind.forbidden) {
      return JawwidEmptyView(
        icon: Icons.lock_outline,
        title: l10n.billingDeniedTitle,
        body: l10n.billingDeniedBody,
      );
    }

    final message = ErrorPresenter.present(appError, l10n);
    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry ? onRetry : null,
    );
  }
}
