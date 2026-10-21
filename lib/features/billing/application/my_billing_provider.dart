import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../shared/models/parent_billing.dart';

/// PD-17: the signed-in parent's own payments, from `GET /me/billing`.
///
/// The server answers only the parent who holds billing for the family; anyone else
/// gets `COMM.BILLING_DENIED`, which reaches the screen intact. Bound to the principal
/// so one account's payments are never served to the next.
final myBillingProvider = FutureProvider.autoDispose<ParentBilling>((ref) {
  ref.watch(principalIdProvider);
  return ref.watch(billingRepositoryProvider).myBilling();
});
