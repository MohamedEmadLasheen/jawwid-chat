import 'package:cross_file/cross_file.dart';

import '../../../shared/models/parent_billing.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import 'attachment_uploader.dart';

/// `BillingRepository` over `/me/billing` (PD-17, PD-27).
///
/// Parsed by hand, reading only the fields the parent's screen shows. A row the server
/// sends malformed (no id, no amount, no due date) is dropped rather than shown with an
/// invented value; a refusal reaches the caller with its code intact (via [ApiClient]):
/// `COMM.BILLING_DENIED`, `COMM.BILLING_STATE`, `COMM.PAYMENTS_UNAVAILABLE`.
///
/// A receipt's bytes go to the signed upload URL through [AttachmentUploader], never
/// through the authenticated client: the URL carries its own authorization.
class HttpBillingRepository implements BillingRepository {
  HttpBillingRepository({required ApiClient client, AttachmentUploader? uploads})
      : _client = client,
        _uploads = uploads ?? DioAttachmentUploader();

  final ApiClient _client;
  final AttachmentUploader _uploads;

  @override
  Future<ParentBilling> myBilling() async =>
      parseParentBilling((await _client.get<Map<String, Object?>>('/me/billing')).data ?? const {});

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) async {
    final d = (await _client.post<Map<String, Object?>>(
      '/me/billing/checkout',
      data: requestId != null ? {'requestId': requestId} : {'instalmentId': instalmentId},
    )).data;
    return _url(d, 'checkout');
  }

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) async {
    final file = draft.file;
    final authorized = await _client.post<Map<String, Object?>>(
      '/me/billing/receipts/upload',
      data: {'mimeType': file.mimeType, 'byteSize': file.byteSize},
    );
    final grant = authorized.data;
    final objectKey = grant?['objectKey'];
    final uploadUrl = grant?['uploadUrl'];
    if (objectKey is! String || uploadUrl is! String) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_upload_authorization',
        debugDetail: 'receipt upload authorization carried no objectKey or uploadUrl',
      );
    }

    final bytes = await XFile(file.filePath).readAsBytes();
    // Storage signed this exact length; a different one would be an opaque 403.
    if (bytes.length != file.byteSize) {
      throw const AppError(
        AppErrorKind.server,
        code: 'receipt_size_changed',
        debugDetail: 'the file changed size between authorization and upload',
      );
    }
    final headers = <String, String>{};
    final raw = grant?['headers'];
    if (raw is Map) {
      raw.forEach((k, v) {
        if (k is String && v is String) headers[k] = v;
      });
    }
    await _uploads.put(uploadUrl, bytes: bytes, headers: headers);

    final note = draft.note?.trim();
    final committed = await _client.post<Map<String, Object?>>('/me/billing/receipts', data: {
      'objectKey': objectKey,
      if (draft.requestId != null) 'requestId': draft.requestId else 'instalmentId': draft.instalmentId,
      'amountMinor': draft.amountMinor,
      'transferredOn': _day(draft.transferredOn),
      if (note != null && note.isNotEmpty) 'note': note,
    });
    return parseParentBilling(committed.data ?? const {});
  }

  @override
  Future<String> invoiceLink(String invoiceId) async =>
      _url((await _client.get<Map<String, Object?>>('/me/billing/invoices/${Uri.encodeComponent(invoiceId)}/link')).data, 'invoice link');

  static String _url(Map<String, Object?>? d, String what) {
    final url = d?['url'];
    if (url is String && url.isNotEmpty) return url;
    throw AppError(AppErrorKind.server, code: 'malformed_billing_url', debugDetail: '$what answered no url');
  }

  static String _day(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// `GET /me/billing`'s shape, which `POST /me/billing/receipts` answers too.
ParentBilling parseParentBilling(Map<String, Object?> d) {
  String? text(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
  int? whole(Object? v) => v is num ? v.toInt() : null;
  DateTime? instant(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
  String? childName(Object? v) => v is Map ? text(v['name']) : null;
  int? months(Object? v) {
    final m = whole(v);
    return m != null && m > 0 ? m : null;
  }

  Iterable<Map<Object?, Object?>> rows(Object? v) => v is List ? v.whereType<Map<Object?, Object?>>() : const [];

  final instalments = <BillingInstalment>[];
  for (final raw in rows(d['instalments'])) {
    final id = text(raw['id']);
    final amount = whole(raw['amountMinor']);
    final currency = text(raw['currency']);
    final due = parseCalendarDay(raw['dueDate']);
    if (id == null || amount == null || currency == null || due == null) continue;
    final payment = raw['payment'] is Map ? raw['payment'] as Map : null;
    final paidOn = parseCalendarDay(payment?['paidOn']);
    instalments.add(BillingInstalment(
      id: id,
      label: text(raw['label']) ?? '',
      childName: childName(raw['child']),
      amountMinor: amount,
      currency: currency,
      dueDate: due,
      status: InstalmentStatus.tryParse(raw['status']),
      days: whole(raw['days']),
      payment: paidOn == null
          ? null
          : BillingPayment(
              paidOn: paidOn,
              method: BillingMethod.tryParse(payment?['method']),
              reference: text(payment?['reference']),
            ),
      paidMinor: whole(raw['paidMinor']),
      remainingMinor: whole(raw['remainingMinor']),
      partial: raw['partial'] == true,
      requestId: text(raw['requestId']),
    ));
  }

  final requests = <PaymentRequest>[];
  for (final raw in rows(d['requests'])) {
    final id = text(raw['id']);
    final amount = whole(raw['amountMinor']);
    final currency = text(raw['currency']);
    if (id == null || amount == null || currency == null) continue;
    final paid = whole(raw['paidMinor']) ?? 0;
    final remaining = whole(raw['remainingMinor']) ?? (amount - paid);
    requests.add(PaymentRequest(
      id: id,
      purpose: RequestPurpose.tryParse(raw['purpose']),
      label: text(raw['label']) ?? '',
      status: RequestStatus.tryParse(raw['status']),
      amountMinor: amount,
      paidMinor: paid,
      remainingMinor: remaining < 0 ? 0 : remaining,
      currency: currency,
      childName: childName(raw['child']),
      instalmentId: text(raw['instalmentId']),
      planMonths: months(raw['planMonths']),
      periodStart: parseCalendarDay(raw['periodStart']),
      periodEnd: parseCalendarDay(raw['periodEnd']),
      expiresAt: instant(raw['expiresAt']),
      createdAt: instant(raw['createdAt']),
    ));
  }

  final invoices = <BillingInvoice>[];
  for (final raw in rows(d['invoices'])) {
    final id = text(raw['id']);
    final number = text(raw['number']);
    final amount = whole(raw['amountMinor']);
    final currency = text(raw['currency']);
    if (id == null || number == null || amount == null || currency == null) continue;
    final status = InvoiceStatus.tryParse(raw['status']);
    // The parent's list never carries a voided invoice; one that slips through is not
    // something to download as proof of payment.
    if (status == InvoiceStatus.voided) continue;
    invoices.add(BillingInvoice(
      id: id,
      number: number,
      issuedAt: instant(raw['issuedAt']),
      status: status,
      amountMinor: amount,
      refundedMinor: whole(raw['refundedMinor']) ?? 0,
      currency: currency,
      method: BillingMethod.tryParse(raw['method']),
      paidOn: parseCalendarDay(raw['paidOn']),
      label: text(raw['label']) ?? '',
      childName: childName(raw['child']),
      planMonths: months(raw['planMonths']),
      periodStart: parseCalendarDay(raw['periodStart']),
      periodEnd: parseCalendarDay(raw['periodEnd']),
    ));
  }

  final receipts = <PaymentReceipt>[];
  for (final raw in rows(d['receipts'])) {
    final id = text(raw['id']);
    final amount = whole(raw['amountMinor']);
    final currency = text(raw['currency']);
    if (id == null || amount == null || currency == null) continue;
    receipts.add(PaymentReceipt(
      id: id,
      status: ReceiptStatus.tryParse(raw['status']),
      requestId: text(raw['requestId']),
      label: text(raw['label']) ?? '',
      amountMinor: amount,
      currency: currency,
      transferredOn: parseCalendarDay(raw['transferredOn']),
      note: text(raw['note']),
      uploadedAt: instant(raw['uploadedAt']),
      fileUrl: text(raw['fileUrl']),
      mimeType: text(raw['mimeType']),
      rejectReason: text(raw['rejectReason']),
    ));
  }

  final bank = d['bankAccount'] is Map ? d['bankAccount'] as Map : null;
  final accountName = text(bank?['accountName']);

  return ParentBilling(
    today: parseCalendarDay(d['today']),
    paymentMethod: BillingMethod.tryParse(d['paymentMethod']),
    currency: text(d['currency']),
    planMonths: whole(d['planMonths']),
    instalments: instalments,
    totals: [
      for (final t in rows(d['totals']))
        if (text(t['currency']) != null)
          BillingTotal(
            currency: t['currency'] as String,
            paidMinor: whole(t['paidMinor']) ?? 0,
            outstandingMinor: whole(t['outstandingMinor']) ?? 0,
            overdueMinor: whole(t['overdueMinor']) ?? 0,
          ),
    ],
    requests: requests,
    invoices: invoices,
    receipts: receipts,
    bankAccount: accountName == null
        ? null
        : BankAccount(
            accountName: accountName,
            bankName: text(bank?['bankName']),
            iban: text(bank?['iban']),
            accountNumber: text(bank?['accountNumber']),
            swift: text(bank?['swift']),
            note: text(bank?['note']),
          ),
    cardAvailable: d['cardAvailable'] == true,
  );
}
