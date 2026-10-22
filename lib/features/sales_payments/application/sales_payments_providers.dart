import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/sales_payments_repository.dart';
import '../domain/sales_billing.dart';

/// PD-20: parents matching a search, for the signed-in Sales seat. Keyed by the
/// (trimmed) query; session-bound so one account's results are never shown to the next.
final parentSearchProvider = FutureProvider.autoDispose.family<ParentSearchResult, String>((ref, query) {
  ref.watch(principalIdProvider);
  return ref.watch(salesPaymentsRepositoryProvider).searchParents(query);
});

/// One family's billing. A write answers the new body, which the screen shows in place
/// of this until the next read.
final familyBillingProvider = FutureProvider.autoDispose.family<FamilyBilling, String>((ref, familyId) {
  ref.watch(principalIdProvider);
  return ref.watch(salesPaymentsRepositoryProvider).familyBilling(familyId);
});
