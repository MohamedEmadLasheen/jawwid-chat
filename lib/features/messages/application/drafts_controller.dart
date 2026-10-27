import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/draft_store.dart';

/// Where drafts are kept. In memory by default (tests, fixture builds); the
/// signed-in app keeps them on the device (bootstrap).
final draftStoreProvider = Provider<DraftStore>((ref) => InMemoryDraftStore());

/// PD-37: the unsent text of each conversation, for the person signed in.
///
/// WhatsApp's behaviour: leave a chat mid-sentence and the text is still there
/// when you come back, and the Chats list says "Draft:". Saved a moment after
/// typing stops; blank means no draft. Belongs to one session: an account
/// switch drops it from memory (SessionScoped), and sign-out deletes the saved
/// drafts (bootstrap's clearLocalData) -- none is left behind on a shared phone.
class DraftsController extends AsyncNotifier<Map<String, String>> with SessionScoped<Map<String, String>> {
  /// How long after the last keystroke a draft is written to the device.
  static const saveAfter = Duration(milliseconds: 400);

  Timer? _save;
  String? _principal;
  Map<String, String>? _unsaved;

  @override
  Map<String, String> get sessionEmptyValue => const {};

  @override
  Future<Map<String, String>> build() async {
    bindToSession();
    ref.onDispose(() => _save?.cancel());
    final store = ref.read(draftStoreProvider);
    final principal = ref.read(principalIdProvider);
    // A reload for the same account (a zone change) must not lose the last
    // keystrokes: what is still waiting to be saved is saved first. Another
    // account's are dropped -- sign-out deletes them anyway.
    _save?.cancel();
    final unsaved = _unsaved;
    _unsaved = null;
    if (unsaved != null && principal != null && principal == _principal) await store.save(principal, unsaved);
    _principal = principal;
    // No account (fixture builds, tests): drafts live in memory only.
    if (principal == null) return const {};
    return store.load(principal);
  }

  /// The draft of [conversationId] is now [text]; blank removes it.
  void set(String conversationId, String text) {
    // Until the drafts have loaded -- or reloaded, for a new account -- a
    // keystroke must not write over the ones on the device.
    final current = state.value;
    if (current == null || state.isLoading || ref.read(principalIdProvider) != _principal) return;
    final draft = text.trim().isEmpty ? null : text;
    if (current[conversationId] == draft) return;
    final next = Map.of(current);
    if (draft == null) {
      next.remove(conversationId);
    } else {
      next[conversationId] = draft;
    }
    state = AsyncData(next);
    _save?.cancel();
    final principal = _principal;
    if (principal == null) return;
    _unsaved = next;
    _save = Timer(saveAfter, () {
      _unsaved = null;
      unawaited(ref.read(draftStoreProvider).save(principal, next));
    });
  }
}

final draftsProvider = AsyncNotifierProvider<DraftsController, Map<String, String>>(DraftsController.new);
