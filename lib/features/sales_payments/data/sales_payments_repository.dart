import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/parent_billing.dart';
import '../domain/sales_billing.dart';

/// PD-20: Sales' Payments. Every method is one endpoint (see the HTTP implementation);
/// NO AUTHORIZATION LIVES HERE -- the server decides who may search, read and write, and
/// its `COMM.*` code reaches the caller intact.
///
/// There is deliberately no method for a parent's detail record: it carries a phone
/// number and an e-mail address, and the app must never hold either (G-07).
abstract interface class SalesPaymentsRepository {
  /// Parents by name (or family name); an empty [query] lists the first page.
  Future<ParentSearchResult> searchParents(String query);

  /// One family's plan, instalments and totals.
  Future<FamilyBilling> familyBilling(String familyId);

  /// Records a payment against an open instalment; answers the family's billing as it now is.
  ///
  /// [paymentId] is the submit's idempotency key (ADMIN-001): generated once per
  /// opened form and sent again on every retry of it, so the server records the
  /// money once however often the request arrives.
  Future<FamilyBilling> recordPayment(
    String instalmentId, {
    required DateTime paidOn,
    required BillingMethod method,
    required String paymentId,
    String? reference,
  });

  /// Voids an instalment, for good; answers the family's billing as it now is.
  Future<FamilyBilling> voidInstalment(String instalmentId, {required String reason});
}

/// The build with no payments server: refuses rather than answering "no families".
class NoSalesPaymentsRepository implements SalesPaymentsRepository {
  const NoSalesPaymentsRepository();

  static Never _none() => throw UnsupportedError('no payments server in this build');

  @override
  Future<ParentSearchResult> searchParents(String query) async => _none();

  @override
  Future<FamilyBilling> familyBilling(String familyId) async => _none();

  @override
  Future<FamilyBilling> recordPayment(
    String instalmentId, {
    required DateTime paidOn,
    required BillingMethod method,
    required String paymentId,
    String? reference,
  }) async =>
      _none();

  @override
  Future<FamilyBilling> voidInstalment(String instalmentId, {required String reason}) async => _none();
}

/// Overridden with the HTTP implementation by the real composition root.
final salesPaymentsRepositoryProvider = Provider<SalesPaymentsRepository>((ref) {
  return const NoSalesPaymentsRepository();
});
