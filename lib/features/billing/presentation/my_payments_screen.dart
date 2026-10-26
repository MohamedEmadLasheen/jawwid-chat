import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_billing.dart';
import '../../../shared/utils/text_direction.dart';
import '../../profile/presentation/profile_sections.dart';
import '../application/my_billing_provider.dart';
import '../domain/amount_due.dart';
import '../domain/money_format.dart';
import 'bank_transfer_screen.dart';
import 'pay_sheet.dart';
import 'payment_sections.dart';
import 'subscription_cards.dart';

/// PD-17: "Payments" -- the parent's own plan, what has been paid and what is still
/// owed, then every instalment in due-date order.
///
/// Parents only -- every parent of the family (PD-17, "both parents"): the route
/// sends a teacher away, and the server refuses anyone else. That refusal is a plain
/// sentence naming who does see this, not an error to retry -- asking again cannot
/// make someone a parent of the family.
///
/// PD-27 adds paying, above the timeline: what is due now (each with Pay), the bank
/// transfer receipts sent and their verdicts, and the invoices to download. Nothing here
/// marks anything paid: after a card checkout the screen re-reads on return to the app
/// and says "we're confirming your payment" until the server -- from Stripe's verified
/// webhook -- answers that it is paid.
///
/// PD-30 makes this the parent's **Subscriptions** tab: a card per child (plan, lessons
/// left, grace, locked and why -- with Pay or Request renewal) above everything above.
class MyPaymentsScreen extends ConsumerStatefulWidget {
  const MyPaymentsScreen({super.key, this.focusChildId});

  /// Opened at this child's card (the locked banner's "Go to Subscriptions").
  final String? focusChildId;

  /// How often, and for how long, a confirming payment is re-read after the parent
  /// comes back from the payment page.
  static const confirmPollEvery = Duration(seconds: 5);
  static const confirmPollTimes = 24;

  @override
  ConsumerState<MyPaymentsScreen> createState() => _MyPaymentsScreenState();
}

class _MyPaymentsScreenState extends ConsumerState<MyPaymentsScreen> {
  /// [DueItem.key]s whose card checkout was opened and is not yet seen paid.
  final _confirming = <String>{};
  late final AppLifecycleListener _lifecycle;
  Timer? _poll;
  var _polls = 0;

  /// PD-30: children whose renewal was asked for in this session, and the one in flight.
  final _renewalRequested = <String>{};
  String? _requesting;
  final _scroll = ScrollController();
  final _dueSection = GlobalKey();
  final _childCards = <String, GlobalKey>{};
  bool _focusDone = false;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _onResume);
  }

  @override
  void dispose() {
    _poll?.cancel();
    _lifecycle.dispose();
    _scroll.dispose();
    super.dispose();
  }

  GlobalKey _cardKey(String childId) => _childCards.putIfAbsent(childId, GlobalKey.new);

  /// PD-30: a locked child's Pay -- what can be paid is listed under "Amount due", so go
  /// there.
  Future<void> _jumpToDue() => _scrollTo(_dueSection, animate: true);

  /// Bring [key]'s widget into view. The list builds lazily, so step down until it has
  /// been built.
  Future<void> _scrollTo(GlobalKey key, {bool animate = false}) async {
    for (var i = 0; i < 20; i++) {
      if (!mounted) return;
      final target = key.currentContext;
      if (target != null && target.mounted) {
        await Scrollable.ensureVisible(
          target,
          alignment: animate ? 0 : 0.1,
          duration: animate ? const Duration(milliseconds: 300) : Duration.zero,
          curve: Curves.easeOut,
        );
        return;
      }
      if (!_scroll.hasClients) return;
      final position = _scroll.position;
      if (position.pixels >= position.maxScrollExtent) return;
      _scroll.jumpTo((position.pixels + position.viewportDimension).clamp(0, position.maxScrollExtent));
      await WidgetsBinding.instance.endOfFrame;
    }
  }

  /// Opened at a child (the locked banner): bring their card into view once it is drawn.
  void _focusChild(ParentBilling billing) {
    final id = widget.focusChildId;
    if (_focusDone || id == null) return;
    _focusDone = true;
    if (!billing.subscriptions.any((s) => s.childId == id)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_scrollTo(_cardKey(id)));
    });
  }

  /// PD-30: "Request renewal" -- once per child per academy day. A second request the
  /// same day (409 `COMM.SUBSCRIPTION_STATE`) means it is already asked for: said as
  /// such, not as an error.
  Future<void> _requestRenewal(ChildSubscription s) async {
    if (_requesting != null) return;
    setState(() => _requesting = s.childId);
    try {
      await ref.read(billingRepositoryProvider).requestRenewal(s.childId);
      if (!mounted) return;
      setState(() => _renewalRequested.add(s.childId));
      unawaited(_refresh());
    } catch (error) {
      if (!mounted) return;
      final appError = asAppErrorOf(error);
      if (appError.code == BillingErrors.subscriptionState) {
        setState(() => _renewalRequested.add(s.childId));
      } else {
        _snack(billingFailureText(appError, L10n.of(context)));
      }
    } finally {
      if (mounted) setState(() => _requesting = null);
    }
  }

  Future<void> _refresh() => ref.refresh(myBillingProvider.future).then((_) {}, onError: (_) {});

  /// Back from the payment page: read again now, then every few seconds for a while,
  /// because the webhook may land a moment after the parent does.
  void _onResume() {
    if (_confirming.isEmpty) return;
    unawaited(_refresh());
    _polls = 0;
    _poll?.cancel();
    _poll = Timer.periodic(MyPaymentsScreen.confirmPollEvery, (_) {
      if (_confirming.isEmpty || ++_polls > MyPaymentsScreen.confirmPollTimes) {
        _poll?.cancel();
        _poll = null;
        return;
      }
      unawaited(_refresh());
    });
  }

  void _snack(String text) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _pay(DueItem item, ParentBilling billing) async {
    final l10n = L10n.of(context);
    final outcome = await showPaySheet(context, item: item, cardAvailable: billing.cardAvailable);
    if (!mounted || outcome == null) return;
    switch (outcome) {
      case PayOutcome.cardOpened:
        setState(() => _confirming.add(item.key));
      case PayOutcome.noLongerOpen:
        _snack(l10n.billingNoLongerOpen);
        unawaited(_refresh());
      case PayOutcome.bankTransfer:
        final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(
          builder: (_) => BankTransferScreen(item: item, bankAccount: billing.bankAccount, today: billing.today),
        ));
        if (mounted && sent == true) _snack(l10n.billingReceiptSent);
    }
  }

  Future<void> _open(Future<String> Function() link) async {
    final l10n = L10n.of(context);
    try {
      final url = await link();
      final opened = await ref.read(attachmentOpenerProvider).open(url);
      if (!opened && mounted) _snack(l10n.billingCouldNotOpen);
    } catch (error) {
      if (mounted) _snack(billingFailureText(asAppErrorOf(error), l10n));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final state = ref.watch(myBillingProvider);

    // A confirming item that is no longer due has been paid (or closed): stop saying so.
    ref.listen(myBillingProvider, (_, next) {
      final billing = next.value;
      if (billing == null || _confirming.isEmpty) return;
      final due = amountsDue(billing).map((i) => i.key).toSet();
      if (_confirming.any((k) => !due.contains(k))) setState(() => _confirming.retainAll(due));
    });

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabSubscriptions)),
      // A pull keeps the list on screen while it reloads (`when` skips the loading
      // state on a refresh); a principal change still blanks it.
      body: state.when(
        loading: () => const JawwidLoadingView(),
        error: (error, _) => _Error(error: error, onRetry: () => ref.invalidate(myBillingProvider)),
        data: (billing) {
          _focusChild(billing);
          return RefreshIndicator(
          onRefresh: _refresh,
          child: _Body(
            billing: billing,
            controller: _scroll,
            dueSectionKey: _dueSection,
            subscriptions: [
              for (final s in billing.subscriptions)
                ChildSubscriptionCard(
                  key: _cardKey(s.childId),
                  subscription: s,
                  focused: s.childId == widget.focusChildId,
                  renewalRequested: _renewalRequested.contains(s.childId),
                  requesting: _requesting == s.childId,
                  onPay: () => unawaited(_jumpToDue()),
                  onRequestRenewal: () => unawaited(_requestRenewal(s)),
                ),
            ],
            confirming: _confirming,
            onPay: (item) => _pay(item, billing),
            onDownload: (invoice) => _open(() => ref.read(billingRepositoryProvider).invoiceLink(invoice.id)),
            onOpenReceipt: (receipt) => _open(() async => receipt.fileUrl!),
          ),
        );
        },
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({
    required this.billing,
    required this.controller,
    required this.dueSectionKey,
    required this.subscriptions,
    required this.confirming,
    required this.onPay,
    required this.onDownload,
    required this.onOpenReceipt,
  });

  final ParentBilling billing;
  final ScrollController controller;

  /// PD-30: where a locked child's Pay takes the parent.
  final GlobalKey dueSectionKey;

  /// PD-30: one card per child, above the payments.
  final List<Widget> subscriptions;
  final Set<String> confirming;
  final ValueChanged<DueItem> onPay;
  final ValueChanged<BillingInvoice> onDownload;
  final ValueChanged<PaymentReceipt> onOpenReceipt;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final due = amountsDue(billing);

    return ListView(
      controller: controller,
      // Always scrollable, so a short list can still be pulled to refresh.
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
      children: [
        if (subscriptions.isNotEmpty) ...[
          const SizedBox(height: Spacing.spacing2),
          ...subscriptions,
        ],
        _Summary(billing: billing),
        if (due.isNotEmpty) ...[
          KeyedSubtree(
            key: dueSectionKey,
            child: ProfileSectionHeading(key: const ValueKey('billing-due-section'), text: l10n.billingAmountDueTitle),
          ),
          for (final item in due)
            DueTile(item: item, confirming: confirming.contains(item.key), onPay: () => onPay(item)),
        ],
        if (billing.receipts.isNotEmpty) ...[
          ProfileSectionHeading(key: const ValueKey('billing-receipts-section'), text: l10n.billingReceiptsTitle),
          for (final receipt in billing.receipts)
            ReceiptTile(receipt: receipt, onOpen: receipt.fileUrl == null ? null : () => onOpenReceipt(receipt)),
        ],
        if (billing.invoices.isNotEmpty) ...[
          ProfileSectionHeading(key: const ValueKey('billing-invoices-section'), text: l10n.billingInvoicesTitle),
          for (final invoice in billing.invoices) InvoiceTile(invoice: invoice, onDownload: () => onDownload(invoice)),
        ],
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
      BillingMethod.card => l10n.billingMethodCard,
      BillingMethod.cash => l10n.billingMethodCash,
      null => null,
    };

/// A payment refusal in the parent's words: too many attempts, no card on this
/// deployment, already paid, or the general sentence for everything else.
///
/// A 429 is checked first: the server's per-request checkout limit answers 429 with
/// `COMM.BILLING_STATE`, which is not "already paid".
String billingFailureText(AppError error, L10n l10n) {
  if (error.kind == AppErrorKind.rateLimited) return l10n.billingTooManyAttempts;
  if (error.code == BillingErrors.paymentsUnavailable) return l10n.billingPaymentsUnavailable;
  if (error.code == BillingErrors.state) return l10n.billingNoLongerOpen;
  final message = ErrorPresenter.present(error, l10n);
  return message.body == null ? message.title : '${message.title}. ${message.body}';
}

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

    final paidOf = i.partial && i.paidMinor != null
        ? l10n.billingPaidOfTotal(formatMoney(i.paidMinor!, i.currency, locale), formatMoney(i.amountMinor, i.currency, locale))
        : null;

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
                if (paidOf != null) ...[
                  const SizedBox(height: Spacing.spacing1),
                  Text(paidOf, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusWarningFg)),
                ],
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
    return BillingChip(label: label, foreground: fg, background: bg);
  }
}

/// A small status pill: an instalment's, a receipt's, an invoice's.
class BillingChip extends StatelessWidget {
  const BillingChip({super.key, required this.label, required this.foreground, required this.background});

  final String label;
  final Color foreground;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(Spacing.spacing5)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing3, vertical: Spacing.spacing1),
        child: Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: foreground, fontWeight: FontWeight.w700)),
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
