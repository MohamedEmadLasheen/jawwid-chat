import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/message_search_repository.dart';

/// Messages matching [query] across every chat in the viewer's list (owner
/// decision 2026-10-20), newest first. Session-scoped, and debounced: a term
/// that is replaced within 300 ms is disposed before it is ever sent.
final messageSearchAllProvider =
    FutureProvider.autoDispose.family<List<MessageSearchHit>, String>((ref, query) async {
  ref.watch(principalIdProvider);
  final repository = ref.watch(messageSearchRepositoryProvider);
  await Future<void>.delayed(const Duration(milliseconds: 300));
  if (!ref.mounted) return const [];
  return repository.searchAll(query);
});
