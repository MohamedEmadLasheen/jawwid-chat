import 'whiteboards_repository.dart';

/// The browser: localStorage, capped.
BoardDraftStore platformBoardDraftStore() => const SharedPreferencesBoardDraftStore();
