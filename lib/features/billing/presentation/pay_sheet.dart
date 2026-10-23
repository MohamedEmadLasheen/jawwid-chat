import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../domain/amount_due.dart';
import '../domain/money_format.dart';
import 'my_payments_screen.dart';

/// What the parent did in the pay sheet.
enum PayOutcome {
  /// The Stripe Checkout page was opened in the browser. Nothing is paid yet: only the
  /// server, from Stripe's verified webhook, can say so.
  cardOpened,

  /// They chose to pay by bank transfer.
  bankTransfer,

  /// The server answered `409 COMM.BILLING_STATE`: already paid, cancelled or expired.
  noLongerOpen,
}

/// PD-27: "How would you like to pay?" -- by card (only where the academy takes cards)
/// or by bank transfer. Null when dismissed.
Future<PayOutcome?> showPaySheet(BuildContext context, {required DueItem item, required bool cardAvailable}) {
  return showModalBottomSheet<PayOutcome>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => PaySheet(item: item, cardAvailable: cardAvailable),
  );
}

class PaySheet extends ConsumerStatefulWidget {
  const PaySheet({super.key, required this.item, required this.cardAvailable});

  final DueItem item;
  final bool cardAvailable;

  @override
  ConsumerState<PaySheet> createState() => _PaySheetState();
}

class _PaySheetState extends ConsumerState<PaySheet> {
  var _busy = false;
  String? _error;

  /// Open a Stripe Checkout for what is still owed, in the external browser. An
  /// instalment is named by its id (the server makes or reuses its request).
  Future<void> _card() async {
    final l10n = L10n.of(context);
    final item = widget.item;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final url = await ref.read(billingRepositoryProvider).checkout(
            requestId: item.requestId,
            instalmentId: item.requestId == null ? item.instalmentId : null,
          );
      final opened = await ref.read(attachmentOpenerProvider).open(url);
      if (!mounted) return;
      if (opened) {
        Navigator.of(context).pop(PayOutcome.cardOpened);
      } else {
        setState(() {
          _busy = false;
          _error = l10n.billingCouldNotOpen;
        });
      }
    } catch (error) {
      if (!mounted) return;
      final appError = asAppErrorOf(error);
      // A 429 carries the same code (ten checkouts in an hour) but is not "paid".
      if (appError.code == BillingErrors.state && appError.kind != AppErrorKind.rateLimited) {
        Navigator.of(context).pop(PayOutcome.noLongerOpen);
        return;
      }
      setState(() {
        _busy = false;
        _error = billingFailureText(appError, l10n);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final item = widget.item;

    Widget option({
      required Key key,
      required IconData icon,
      required String title,
      required String subtitle,
      required VoidCallback? onTap,
      Widget? trailing,
    }) =>
        Card(
          margin: const EdgeInsets.only(bottom: Spacing.spacing3),
          child: ListTile(
            key: key,
            leading: Icon(icon),
            title: Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            subtitle: Text(subtitle),
            trailing: trailing ?? const Icon(Icons.chevron_right),
            onTap: onTap,
          ),
        );

    return SafeArea(
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.billingPaySheetTitle, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: Spacing.spacing2),
            ContentText(item.label, style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextSecondary)),
            const SizedBox(height: Spacing.spacing1),
            Text(
              formatMoney(item.remainingMinor, item.currency, locale),
              key: const ValueKey('pay-sheet-amount'),
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: Spacing.spacing5),
            if (widget.cardAvailable)
              option(
                key: const ValueKey('pay-by-card'),
                icon: Icons.credit_card,
                title: l10n.billingPayByCard,
                subtitle: l10n.billingPayByCardHint,
                onTap: _busy ? null : _card,
                trailing: _busy
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : null,
              ),
            option(
              key: const ValueKey('pay-by-bank-transfer'),
              icon: Icons.account_balance_outlined,
              title: l10n.billingMethodBankTransfer,
              subtitle: l10n.billingBankTransferHint,
              onTap: _busy ? null : () => Navigator.of(context).pop(PayOutcome.bankTransfer),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing2),
                child: Text(
                  _error!,
                  key: const ValueKey('pay-sheet-error'),
                  style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
