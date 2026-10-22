import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' hide TextDirection;

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/media/media_picker.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_billing.dart';
import '../../../shared/utils/text_direction.dart';
import '../../profile/presentation/profile_sections.dart';
import '../application/my_billing_provider.dart';
import '../domain/amount_due.dart';
import '../domain/money_format.dart';
import 'my_payments_screen.dart';

/// PD-27: pay by bank transfer, on one page -- the academy's bank details (each with
/// Copy), the amount, and the receipt: a photo, a camera shot or a PDF, the amount sent
/// (prefilled with what is owed), the transfer date (today unless changed), an optional
/// note. The receipt is pending until the academy verifies it; nothing here marks
/// anything paid. Pops with `true` once the receipt is sent.
class BankTransferScreen extends ConsumerStatefulWidget {
  const BankTransferScreen({super.key, required this.item, required this.bankAccount, this.today});

  final DueItem item;

  /// Null when the academy has not set it: the parent is told to ask, and may still
  /// upload a receipt for a transfer made from details they were given.
  final BankAccount? bankAccount;

  /// The academy's calendar day; the device's when the server sent none.
  final DateTime? today;

  @override
  ConsumerState<BankTransferScreen> createState() => _BankTransferScreenState();
}

class _BankTransferScreenState extends ConsumerState<BankTransferScreen> {
  late final TextEditingController _amount;
  final _note = TextEditingController();
  late DateTime _today;
  late DateTime _transferredOn;
  PendingAttachment? _file;
  var _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _amount = TextEditingController(text: plainAmount(widget.item.remainingMinor, widget.item.currency));
    final now = DateTime.now();
    _today = widget.today ?? DateTime(now.year, now.month, now.day);
    _transferredOn = _today;
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick(Future<PendingAttachment?> Function(MediaPicker picker) pick) async {
    final l10n = L10n.of(context);
    setState(() => _error = null);
    try {
      final file = await pick(ref.read(mediaPickerProvider));
      if (!mounted || file == null) return;
      final mime = _mime(file.mimeType);
      setState(() {
        if (!ReceiptDraft.mimeTypes.contains(mime)) {
          _error = l10n.billingReceiptWrongType;
        } else if (file.byteSize > ReceiptDraft.maxBytes) {
          _error = l10n.billingReceiptTooLarge;
        } else {
          _file = PendingAttachment(
            filePath: file.filePath,
            kind: file.kind,
            mimeType: mime,
            byteSize: file.byteSize,
            fileName: file.fileName,
          );
        }
      });
    } on MediaPickException catch (e) {
      if (!mounted) return;
      setState(() => _error = switch (e.reason) {
            MediaPickFailure.tooLarge => l10n.billingReceiptTooLarge,
            MediaPickFailure.typeNotAllowed => l10n.billingReceiptWrongType,
            MediaPickFailure.permissionDenied => l10n.billingReceiptPickDenied,
            MediaPickFailure.unsupported || MediaPickFailure.failed => l10n.billingReceiptPickFailed,
          });
    }
  }

  /// `image/jpg` is what some pickers call a JPEG; the server's allow-list says `image/jpeg`.
  static String _mime(String raw) {
    final m = raw.toLowerCase().trim();
    return m == 'image/jpg' ? 'image/jpeg' : m;
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _transferredOn,
      firstDate: _today.subtract(const Duration(days: 365)),
      lastDate: _today,
    );
    if (picked != null && mounted) setState(() => _transferredOn = picked);
  }

  Future<void> _send() async {
    final l10n = L10n.of(context);
    final item = widget.item;
    final file = _file;
    final amount = parseAmountMinor(_amount.text, item.currency);
    if (file == null || amount == null) {
      setState(() => _error = file == null ? l10n.billingReceiptNeedFile : l10n.billingReceiptBadAmount);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(billingRepositoryProvider).submitReceipt(ReceiptDraft(
            file: file,
            requestId: item.requestId,
            instalmentId: item.requestId == null ? item.instalmentId : null,
            amountMinor: amount,
            transferredOn: _transferredOn,
            note: _note.text,
          ));
      ref.invalidate(myBillingProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      final appError = asAppErrorOf(error);
      // 409 on a receipt: already paid or closed (the list behind this page is stale
      // too), or five receipts already wait for the academy.
      final refused = appError.code == BillingErrors.state && appError.kind != AppErrorKind.rateLimited;
      if (refused) ref.invalidate(myBillingProvider);
      setState(() {
        _busy = false;
        _error = switch (appError.kind) {
          _ when refused => l10n.billingReceiptNotAccepted,
          AppErrorKind.validation => l10n.billingReceiptInvalid,
          _ => billingFailureText(appError, l10n),
        };
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
    final bank = widget.bankAccount;
    final secondary = theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary);
    final file = _file;
    // The theme's buttons span their parent; these three share a row.
    final compact = OutlinedButton.styleFrom(minimumSize: const Size(0, Sizes.minTouchTarget));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.billingMethodBankTransfer)),
      body: ListView(
        padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
        children: [
          Card(
            margin: const EdgeInsets.all(Spacing.spacing4),
            child: Padding(
              padding: const EdgeInsets.all(Spacing.spacing4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.billingTransferAmount, style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextSecondary)),
                  const SizedBox(height: Spacing.spacing1),
                  Text(
                    formatMoney(item.remainingMinor, item.currency, locale),
                    key: const ValueKey('bank-transfer-amount'),
                    style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: Spacing.spacing1),
                  ContentText([item.label, ?item.childName].join(' · '), style: secondary),
                ],
              ),
            ),
          ),
          if (bank == null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
              child: Text(l10n.billingNoBankAccount, key: const ValueKey('bank-account-missing'), style: secondary),
            )
          else
            Card(
              key: const ValueKey('bank-account'),
              margin: const EdgeInsets.symmetric(horizontal: Spacing.spacing4),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Spacing.spacing2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (bank.bankName != null) _CopyRow(id: 'bank', label: l10n.billingBankName, value: bank.bankName!),
                    _CopyRow(id: 'name', label: l10n.billingAccountName, value: bank.accountName),
                    if (bank.iban != null) _CopyRow(id: 'iban', label: l10n.billingIban, value: bank.iban!, latin: true),
                    if (bank.accountNumber != null)
                      _CopyRow(id: 'number', label: l10n.billingAccountNumber, value: bank.accountNumber!, latin: true),
                    if (bank.swift != null) _CopyRow(id: 'swift', label: l10n.billingSwift, value: bank.swift!, latin: true),
                    if (bank.note != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing2),
                        child: ContentText(bank.note!, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusInfoFg)),
                      ),
                  ],
                ),
              ),
            ),
          ProfileSectionHeading(text: l10n.billingUploadReceiptTitle),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.billingReceiptFileHint, style: secondary),
                const SizedBox(height: Spacing.spacing3),
                if (file == null)
                  Wrap(
                    spacing: Spacing.spacing3,
                    runSpacing: Spacing.spacing3,
                    children: [
                      OutlinedButton.icon(
                        key: const ValueKey('receipt-photo'),
                        style: compact,
                        onPressed: _busy ? null : () => _pick((p) => p.pickImage()),
                        icon: const Icon(Icons.photo_outlined),
                        label: Text(l10n.billingReceiptPhoto),
                      ),
                      OutlinedButton.icon(
                        key: const ValueKey('receipt-camera'),
                        style: compact,
                        onPressed: _busy ? null : () => _pick((p) => p.captureImage()),
                        icon: const Icon(Icons.photo_camera_outlined),
                        label: Text(l10n.billingReceiptCamera),
                      ),
                      OutlinedButton.icon(
                        key: const ValueKey('receipt-pdf'),
                        style: compact,
                        onPressed: _busy ? null : () => _pick((p) => p.pickFile()),
                        icon: const Icon(Icons.picture_as_pdf_outlined),
                        label: Text(l10n.billingReceiptPdf),
                      ),
                    ],
                  )
                else
                  Card(
                    key: const ValueKey('receipt-attached'),
                    margin: EdgeInsets.zero,
                    child: ListTile(
                      leading: Icon(file.mimeType == 'application/pdf' ? Icons.picture_as_pdf_outlined : Icons.image_outlined),
                      title: ContentText(
                        file.mimeType == 'application/pdf' ? (file.fileName ?? l10n.billingReceiptPdf) : l10n.billingReceiptAttachedPhoto,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: IconButton(
                        key: const ValueKey('receipt-remove'),
                        tooltip: l10n.billingReceiptRemove,
                        icon: const Icon(Icons.close),
                        onPressed: _busy ? null : () => setState(() => _file = null),
                      ),
                    ),
                  ),
                const SizedBox(height: Spacing.spacing5),
                TextField(
                  key: const ValueKey('receipt-amount'),
                  controller: _amount,
                  enabled: !_busy,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: l10n.billingReceiptAmountLabel(item.currency)),
                ),
                const SizedBox(height: Spacing.spacing3),
                InkWell(
                  key: const ValueKey('receipt-date'),
                  onTap: _busy ? null : _pickDate,
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: l10n.billingReceiptDateLabel,
                      suffixIcon: const Icon(Icons.calendar_today_outlined),
                    ),
                    child: Text(DateFormat.yMMMd(locale).format(_transferredOn)),
                  ),
                ),
                const SizedBox(height: Spacing.spacing3),
                TextField(
                  key: const ValueKey('receipt-note'),
                  controller: _note,
                  enabled: !_busy,
                  maxLength: 500,
                  minLines: 1,
                  maxLines: 3,
                  decoration: InputDecoration(labelText: l10n.billingReceiptNoteLabel),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Spacing.spacing3),
                    child: Text(_error!,
                        key: const ValueKey('receipt-error'),
                        style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg)),
                  ),
                FilledButton(
                  key: const ValueKey('receipt-send'),
                  onPressed: _busy ? null : _send,
                  child: _busy
                      ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(l10n.billingReceiptSend),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One bank detail with a Copy button: an IBAN is never retyped by hand.
class _CopyRow extends StatelessWidget {
  const _CopyRow({required this.id, required this.label, required this.value, this.latin = false});

  final String id;
  final String label;
  final String value;

  /// An IBAN, account number or SWIFT code reads left to right in every language.
  final bool latin;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    return ListTile(
      key: ValueKey('bank-$id'),
      dense: true,
      title: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextSecondary)),
      subtitle: latin
          ? Text(value, textDirection: TextDirection.ltr, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600))
          : ContentText(value, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
      trailing: IconButton(
        key: ValueKey('bank-copy-$id'),
        tooltip: l10n.billingCopy,
        icon: const Icon(Icons.copy_outlined),
        onPressed: () async {
          await Clipboard.setData(ClipboardData(text: value));
          if (!context.mounted) return;
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(content: Text(l10n.billingCopied), duration: const Duration(seconds: 2)));
        },
      ),
    );
  }
}
