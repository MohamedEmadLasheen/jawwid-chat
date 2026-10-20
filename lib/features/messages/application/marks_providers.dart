import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/message_marks_repository.dart';

/// The conversation's pins this viewer may see, oldest first. Session-scoped
/// (re-read for a different account) and refreshed on `conversation.updated`.
final pinnedMessagesProvider = FutureProvider.autoDispose.family<List<PinnedMessage>, String>((ref, conversationId) async {
  ref.watch(principalIdProvider);
  return ref.watch(messageMarksRepositoryProvider).pins(conversationId);
});
