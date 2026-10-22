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
import '../../billing/domain/money_format.dart';
import '../../billing/presentation/my_payments_screen.dart' show methodLabel;
import '../../profile/presentation/profile_sections.dart';
import '../application/sales_payments_providers.dart';
import '../data/sales_payments_repository.dart';
import '../domain/sales_billing.dart';

/// PD-20: one family's billing, for Sales -- the plan, the totals, and every instalment
/// in the server's order, each with its state. Where the server says this viewer may
/// ([FamilyBilling.canRecord]), an open instalment offers "Record payment" and any
/// instalment not yet voided offers "Void".
///
/// After a write the server's answer -- the family's billing as it now is -- replaces
/// what is on screen; nothing is patched locally.
class FamilyBillingScreen extends ConsumerStatefulWidget {
  const FamilyBillingScreen({super.key, required this.familyId, this.familyName});

  final String familyId;

  /// From the search result, for the title; the screen works without it.
  final String? familyName;

  @override
  ConsumerState<FamilyBillingScreen> createState() => _FamilyBillingScreenState();
}

class _FamilyBillingScreenState extends ConsumerState<FamilyBillingScreen> {
  /// The latest write's answer, shown in place of the read until the next read.
  FamilyBilling? _written;

  Future<void> _reload() async {
    setState(() => _written = null);
    await ref.refresh(familyBillingProvider(widget.familyId).future).then((_) {}, onError: (_) {});
  }

  Future<void> _record(FamilyBilling billing, SalesInstalment instalment) async {
    final result = await showModalBottomSheet<_SheetResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _RecordPaymentSheet(billing: billing, instalment: instalment),
    );
    _apply(result);
  }

  Future<void> _void(SalesInstalment instalment) async {
    final result = await showModalBottomSheet<_SheetResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _VoidSheet(instalment: instalment),
    );
    _apply(result);
  }

  void _apply(_SheetResult? result) {
    if (!mounted || result == null) return;
    if (result.billing != null) {
      setState(() => _written = result.billing);
    } else if (result.stale) {
      // Someone else got there first: show what the server holds now.
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final state = ref.watch(familyBillingProvider(widget.familyId));
    final written = _written;

    return Scaffold(
      appBar: AppBar(title: Text(widget.familyName ?? l10n.tabPayments)),
      body: written != null
          ? _body(written)
          : state.when(
              skipLoadingOnRefresh: true,
              loading: () => const JawwidLoadingView(),
              error: (error, _) {
                final appError = asAppErrorOf(error);
                if (appError.kind == AppErrorKind.forbidden) {
                  return JawwidEmptyView(icon: Icons.lock_outline, title: l10n.salesPaymentsDenied);
                }
                final message = ErrorPresenter.present(appError, l10n);
                return JawwidErrorView(
                  title: message.title,
                  body: message.body,
                  retryLabel: message.canRetry ? l10n.retryAction : null,
                  onRetry: message.canRetry ? () => ref.invalidate(familyBillingProvider(widget.familyId)) : null,
                );
              },
              data: _body,
            ),
    );
  }

  Widget _body(FamilyBilling billing) {
    final l10n = L10n.of(context);
    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
        children: [
          _Summary(billing: billing),
          ProfileSectionHeading(text: l10n.billingInstalmentsTitle),
          if (billing.instalments.isEmpty)
            JawwidEmptyView(icon: Icons.receipt_long_outlined, title: l10n.billingEmptyTitle)
          else
            for (final i in billing.instalments)
              _InstalmentTile(
                instalment: i,
                onRecord: billing.canRecord && (i.status?.isOpen ?? false) ? () => _record(billing, i) : null,
                onVoid: billing.canRecord && i.status != null && i.status != SalesInstalmentStatus.voided ? () => _void(i) : null,
              ),
        ],
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.billing});

  final FamilyBilling billing;

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
            children: [
              Expanded(child: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextSecondary))),
              const SizedBox(width: Spacing.spacing3),
              Text(value, style: theme.textTheme.bodyMedium?.copyWith(color: color ?? tokens.colorTextPrimary, fontWeight: FontWeight.w600)),
            ],
          ),
        );

    return Card(
      key: const ValueKey('sales-billing-summary'),
      margin: const EdgeInsets.all(Spacing.spacing4),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              months == null || months <= 0 ? l10n.billingNoPlan : l10n.billingPlanMonths(months),
              key: const ValueKey('sales-billing-plan'),
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: Spacing.spacing2),
            row(l10n.billingMethodLabel, methodLabel(billing.paymentMethod, l10n) ?? l10n.billingNotSet, key: const ValueKey('sales-billing-method')),
            row(l10n.billingCurrencyLabel, billing.currency ?? l10n.billingNotSet, key: const ValueKey('sales-billing-currency')),
            for (final total in billing.totals) ...[
              const Divider(height: Spacing.spacing5),
              row(l10n.billingPaidTotal, formatMoney(total.paidMinor, total.currency, locale),
                  color: tokens.colorStatusSuccessFg, key: ValueKey('sales-billing-paid-${total.currency}')),
              row(l10n.billingOutstandingTotal, formatMoney(total.outstandingMinor, total.currency, locale),
                  key: ValueKey('sales-billing-outstanding-${total.currency}')),
              row(
                l10n.billingOverdueTotal,
                formatMoney(total.overdueMinor, total.currency, locale),
                color: total.overdueMinor > 0 ? tokens.colorStatusDangerFg : tokens.colorTextSecondary,
                key: ValueKey('sales-billing-overdue-${total.currency}'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _InstalmentTile extends StatelessWidget {
  const _InstalmentTile({required this.instalment, this.onRecord, this.onVoid});

  final SalesInstalment instalment;
  final VoidCallback? onRecord;
  final VoidCallback? onVoid;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final day = DateFormat.yMMMd(locale).format;
    final i = instalment;
    final voided = i.status == SalesInstalmentStatus.voided;
    final days = i.days;

    final when = [
      l10n.billingDueOn(day(i.dueDate)),
      if (i.status == SalesInstalmentStatus.overdue && days != null && days > 0) l10n.billingDaysLate(days),
      if (i.status == SalesInstalmentStatus.upcoming && days != null && days > 0) l10n.billingDaysUntil(days),
    ].join(' · ');

    String? paidLine;
    final payment = i.payment;
    if (payment != null) {
      final date = day(payment.paidOn);
      final method = methodLabel(payment.method, l10n);
      paidLine = payment.recordedByName != null && method != null
          ? l10n.salesPaidRecordedBy(date, method, payment.recordedByName!)
          : method == null
              ? l10n.billingPaidOnNoMethod(date)
              : l10n.billingPaidOn(date, method);
      if (payment.reference != null) paidLine = '$paidLine · ${payment.reference}';
    }
    final v = i.voided;
    final voidLine = v == null ? null : (v.byName == null ? l10n.salesVoidedReason(v.reason) : l10n.salesVoidedBy(v.byName!, v.reason));
    final amount = formatMoney(i.amountMinor, i.currency, locale);

    return Padding(
      key: ValueKey('sales-instalment-${i.id}'),
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
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
                    if (voidLine != null) ...[
                      const SizedBox(height: Spacing.spacing1),
                      ContentText(voidLine, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: Spacing.spacing3),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    amount,
                    key: ValueKey('sales-instalment-amount-${i.id}'),
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      // A voided instalment is no longer owed: struck through, not hidden.
                      decoration: voided ? TextDecoration.lineThrough : null,
                      color: voided ? tokens.colorTextMuted : null,
                    ),
                  ),
                  if (i.status != null) ...[
                    const SizedBox(height: Spacing.spacing2),
                    _StatusChip(status: i.status!),
                  ],
                ],
              ),
            ],
          ),
          if (onRecord != null || onVoid != null)
            Wrap(
              alignment: WrapAlignment.end,
              spacing: Spacing.spacing2,
              children: [
                // The theme's buttons are full-width; these sit side by side.
                if (onVoid != null)
                  TextButton(
                    key: ValueKey('sales-void-${i.id}'),
                    style: TextButton.styleFrom(minimumSize: const Size(0, 40)),
                    onPressed: onVoid,
                    child: Text(l10n.salesVoid),
                  ),
                if (onRecord != null)
                  FilledButton.tonal(
                    key: ValueKey('sales-record-${i.id}'),
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                    onPressed: onRecord,
                    child: Text(l10n.salesRecordPayment),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final SalesInstalmentStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final (label, fg, bg) = switch (status) {
      SalesInstalmentStatus.overdue => (l10n.billingStatusOverdue, tokens.colorStatusDangerFg, tokens.colorStatusDangerBg),
      SalesInstalmentStatus.due => (l10n.billingStatusDue, tokens.colorStatusWarningFg, tokens.colorStatusWarningBg),
      SalesInstalmentStatus.upcoming => (l10n.billingStatusUpcoming, tokens.colorStatusInfoFg, tokens.colorStatusInfoBg),
      SalesInstalmentStatus.paid => (l10n.billingStatusPaid, tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
      SalesInstalmentStatus.voided => (l10n.billingStatusVoided, tokens.colorStatusNeutralFg, tokens.colorStatusNeutralBg),
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

/// What a sheet hands back: the server's new body, or "stale" (409: refresh).
class _SheetResult {
  const _SheetResult.done(FamilyBilling this.billing) : stale = false;
  const _SheetResult.stale()
      : billing = null,
        stale = true;

  final FamilyBilling? billing;
  final bool stale;
}

/// The words for a write that failed: a 409 is "someone already did", a 400 is "check
/// the form", anything else is "try again".
String writeFailure(Object error, L10n l10n) {
  final e = asAppErrorOf(error);
  if (e.code == 'COMM.BILLING_STATE') return l10n.salesBillingStateConflict;
  if (e.kind == AppErrorKind.validation) return l10n.salesBillingInvalid;
  return l10n.salesWriteFailed;
}

class _RecordPaymentSheet extends ConsumerStatefulWidget {
  const _RecordPaymentSheet({required this.billing, required this.instalment});

  final FamilyBilling billing;
  final SalesInstalment instalment;

  @override
  ConsumerState<_RecordPaymentSheet> createState() => _RecordPaymentSheetState();
}

class _RecordPaymentSheetState extends ConsumerState<_RecordPaymentSheet> {
  late DateTime _today;
  late DateTime _paidOn;
  late BillingMethod _method;
  final _reference = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    // The academy's day, never the phone's: a payment cannot be dated after it.
    _today = widget.billing.today ?? DateTime(now.year, now.month, now.day);
    _paidOn = _today;
    _method = widget.billing.paymentMethod ?? BillingMethod.invoice;
  }

  @override
  void dispose() {
    _reference.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _paidOn,
      firstDate: DateTime(_today.year - 5),
      lastDate: _today,
    );
    if (picked != null && mounted) setState(() => _paidOn = DateTime(picked.year, picked.month, picked.day));
  }

  Future<void> _save() async {
    final l10n = L10n.of(context);
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final billing = await ref.read(salesPaymentsRepositoryProvider).recordPayment(
            widget.instalment.id,
            paidOn: _paidOn,
            method: _method,
            reference: _reference.text,
          );
      if (mounted) Navigator.of(context).pop(_SheetResult.done(billing));
    } catch (error) {
      if (!mounted) return;
      if (asAppErrorOf(error).code == 'COMM.BILLING_STATE') {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(l10n.salesBillingStateConflict)));
        Navigator.of(context).pop(const _SheetResult.stale());
        return;
      }
      setState(() {
        _saving = false;
        _error = writeFailure(error, l10n);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final i = widget.instalment;

    return _SheetFrame(
      children: [
        Text(l10n.salesRecordPayment, style: theme.textTheme.titleLarge),
        const SizedBox(height: Spacing.spacing2),
        ContentText('${i.label} · ${formatMoney(i.amountMinor, i.currency, locale)}', style: theme.textTheme.bodyMedium),
        const SizedBox(height: Spacing.spacing4),
        ListTile(
          key: const ValueKey('sales-record-date'),
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.event_outlined),
          title: Text(l10n.salesPaidOnLabel),
          subtitle: Text(DateFormat.yMMMd(locale).format(_paidOn)),
          onTap: _saving ? null : _pickDate,
        ),
        Text(l10n.billingMethodLabel, style: theme.textTheme.labelMedium),
        const SizedBox(height: Spacing.spacing2),
        SegmentedButton<BillingMethod>(
          key: const ValueKey('sales-record-method'),
          segments: [
            ButtonSegment(value: BillingMethod.invoice, label: Text(l10n.billingMethodInvoice)),
            ButtonSegment(value: BillingMethod.bankTransfer, label: Text(l10n.billingMethodBankTransfer)),
          ],
          selected: {_method},
          onSelectionChanged: _saving ? null : (s) => setState(() => _method = s.first),
        ),
        const SizedBox(height: Spacing.spacing4),
        TextField(
          key: const ValueKey('sales-record-reference'),
          controller: _reference,
          maxLength: 120,
          enabled: !_saving,
          decoration: InputDecoration(labelText: l10n.salesReferenceLabel, border: const OutlineInputBorder()),
        ),
        if (_error != null) ...[
          const SizedBox(height: Spacing.spacing2),
          Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
        ],
        const SizedBox(height: Spacing.spacing4),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _saving ? null : () => Navigator.of(context).pop(),
                child: Text(l10n.cancelAction),
              ),
            ),
            const SizedBox(width: Spacing.spacing3),
            Expanded(
              child: FilledButton(
                key: const ValueKey('sales-record-save'),
                onPressed: _saving ? null : _save,
                child: Text(l10n.salesRecordSave),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _VoidSheet extends ConsumerStatefulWidget {
  const _VoidSheet({required this.instalment});

  final SalesInstalment instalment;

  @override
  ConsumerState<_VoidSheet> createState() => _VoidSheetState();
}

class _VoidSheetState extends ConsumerState<_VoidSheet> {
  final _reason = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final l10n = L10n.of(context);
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final billing = await ref.read(salesPaymentsRepositoryProvider).voidInstalment(widget.instalment.id, reason: _reason.text);
      if (mounted) Navigator.of(context).pop(_SheetResult.done(billing));
    } catch (error) {
      if (!mounted) return;
      if (asAppErrorOf(error).code == 'COMM.BILLING_STATE') {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(l10n.salesBillingStateConflict)));
        Navigator.of(context).pop(const _SheetResult.stale());
        return;
      }
      setState(() {
        _saving = false;
        _error = writeFailure(error, l10n);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final i = widget.instalment;
    final ready = _reason.text.trim().isNotEmpty && !_saving;

    return _SheetFrame(
      children: [
        Text(l10n.salesVoidTitle, style: theme.textTheme.titleLarge),
        const SizedBox(height: Spacing.spacing2),
        ContentText('${i.label} · ${formatMoney(i.amountMinor, i.currency, locale)}', style: theme.textTheme.bodyMedium),
        const SizedBox(height: Spacing.spacing3),
        Text(l10n.salesVoidFinal, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg)),
        const SizedBox(height: Spacing.spacing4),
        TextField(
          key: const ValueKey('sales-void-reason'),
          controller: _reason,
          maxLength: 500,
          maxLines: 3,
          enabled: !_saving,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(labelText: l10n.salesVoidReasonLabel, border: const OutlineInputBorder()),
        ),
        if (_error != null) ...[
          const SizedBox(height: Spacing.spacing2),
          Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
        ],
        const SizedBox(height: Spacing.spacing4),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _saving ? null : () => Navigator.of(context).pop(),
                child: Text(l10n.cancelAction),
              ),
            ),
            const SizedBox(width: Spacing.spacing3),
            Expanded(
              child: FilledButton(
                key: const ValueKey('sales-void-confirm'),
                style: FilledButton.styleFrom(backgroundColor: tokens.colorStatusDangerFg),
                onPressed: ready ? _confirm : null,
                child: Text(l10n.salesVoidConfirm),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _SheetFrame extends StatelessWidget {
  const _SheetFrame({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsetsDirectional.only(
          start: Spacing.spacing5,
          end: Spacing.spacing5,
          top: Spacing.spacing5,
          bottom: Spacing.spacing5 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      ),
    );
  }
}
