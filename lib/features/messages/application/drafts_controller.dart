import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/draft_store.dart';

/// Where drafts are kept. In memory by default (tests, fixture builds); the
/// signed-in app keeps them in the phone's secure storage (bootstrap).
final draftStoreProvider = Provider<DraftStore>((ref) => InMemoryDraftStore());

/// PD-37: the unsent message of each conversation, for the person signed in.
///
/// WhatsApp's behaviour: leave a chat mid-sentence and the text is still there
/// when you come back, and the Chats list says "Draft:". Saved a moment after
/// typing stops; blank means no draft. Belongs to one session: an account
/// switch drops it from memory (SessionScoped), and sign-out deletes the saved
/// drafts (bootstrap's clearLocalData) -- none is left behind on a shared phone.
class DraftsController extends AsyncNotifier<Map<String, Draft>> with SessionScoped<Map<String, Draft>> {
  /// How long after the last keystroke a draft is written to the device.
  static const saveAfter = Duration(milliseconds: 400);

  Timer? _save;
  String? _principal;
  ({Map<String, Draft> drafts, int generation})? _unsaved;

  @override
  Map<String, Draft> get sessionEmptyValue => const {};

  @override
  Future<Map<String, Draft>> build() async {
    bindToSession();
    final store = ref.read(draftStoreProvider);
    // Sign-out clears the store: the waiting save is cancelled and what this
    // holds is dropped at once, before the account switch reaches it. (The
    // store's generation also refuses any save already on its way.)
    final unsubscribe = store.onCleared(() {
      _save?.cancel();
      _unsaved = null;
      state = AsyncData(sessionEmptyValue);
    });
    ref.onDispose(() {
      unsubscribe();
      _save?.cancel();
    });
    final principal = ref.read(principalIdProvider);
    // A reload for the same account (a zone change) must not lose the last
    // keystrokes: what is still waiting to be saved is saved first. Another
    // account's are dropped -- sign-out deletes them anyway.
    _save?.cancel();
    final unsaved = _unsaved;
    _unsaved = null;
    if (unsaved != null && principal != null && principal == _principal) {
      await store.save(principal, unsaved.drafts, generation: unsaved.generation);
    }
    _principal = principal;
    // No account (fixture builds, tests): drafts live in memory only.
    if (principal == null) return const {};
    return store.load(principal);
  }

  /// The draft of [conversationId] is now [draft]; a blank one removes it.
  void set(String conversationId, Draft draft) {
    // Until the drafts have loaded -- or reloaded, for a new account -- a
    // keystroke must not write over the ones on the device.
    final current = state.value;
    if (current == null || state.isLoading || ref.read(principalIdProvider) != _principal) return;
    final next = Map.of(current);
    if (draft.isBlank) {
      if (!next.containsKey(conversationId)) return;
      next.remove(conversationId);
    } else {
      if (next[conversationId] == draft) return;
      next[conversationId] = draft;
    }
    state = AsyncData(next);
    _save?.cancel();
    final principal = _principal;
    if (principal == null) return;
    final store = ref.read(draftStoreProvider);
    // The generation as of THIS keystroke: a sign-out in the next 400 ms wins.
    final pending = (drafts: next, generation: store.generation);
    _unsaved = pending;
    _save = Timer(saveAfter, () {
      _unsaved = null;
      unawaited(store.save(principal, pending.drafts, generation: pending.generation));
    });
  }
}

final draftsProvider = AsyncNotifierProvider<DraftsController, Map<String, Draft>>(DraftsController.new);
