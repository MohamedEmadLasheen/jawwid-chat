/// PD-55 Phase 1 (4): the emoji a teacher can put on a board -- a short list,
/// chosen for children 5–12, not the whole keyboard.
///
/// What is left out, on purpose: people and body parts (hands, gestures, skin
/// tones), flags, religious and political symbols, food or drink a family may
/// not want shown, and anything negative (a cross, a frown, a skull). A
/// smiley is a cartoon face, not a person; the department head keeps or drops
/// that group.
///
/// Every one is in the Noto Color Emoji the teacher portal bundles
/// (web/fonts/NotoColorEmoji.ttf, version 1.39): newer emoji would draw as an
/// empty box there, so none is listed.
library;

import 'package:flutter/foundation.dart';

/// One group of the picker.
class BoardEmojiGroup {
  const BoardEmojiGroup(this.key, this.emoji);

  /// The group's name for the picker's tabs ('smileys', 'animals', ...).
  final String key;
  final List<String> emoji;
}

const kBoardEmoji = <BoardEmojiGroup>[
  BoardEmojiGroup('smileys', ['😀', '😃', '😊', '😍', '😎', '😮', '🤔']),
  BoardEmojiGroup('animals', ['🐱', '🐶', '🐰', '🦁', '🐻', '🐼', '🐨', '🐸', '🐢', '🐠', '🦋', '🐝', '🐞', '🦉', '🐧', '🐘']),
  BoardEmojiGroup('nature', ['🌸', '🌻', '🌳', '🌈', '☀️', '⛅', '❄️', '🌍']),
  BoardEmojiGroup('food', ['🍎', '🍌', '🍉', '🍇', '🍓', '🥕', '🍪', '🍰', '🍦', '🥛']),
  BoardEmojiGroup('school', ['📚', '✏️', '🖍️', '📐', '🎨', '🎈', '🎁', '🏆', '🥇', '🏅', '🚀', '⚽', '💡', '⏰', '🔔']),
  BoardEmojiGroup('symbols', ['❤️', '💙', '💚', '💛', '💜', '⭐', '🌟', '✨', '✅', '❓', '❗', '💯']),
];

/// Every emoji the picker offers.
final Set<String> kBoardEmojiSet = {for (final g in kBoardEmoji) ...g.emoji};

/// The font family the board draws an emoji in. On a phone it is the system's
/// own emoji font; in the teacher portal (a browser, under a policy that loads
/// fonts from its own site only) it is the bundled Noto Color Emoji, registered
/// under this name by loadBoardEmojiFont().
const kBoardEmojiFont = 'JawwidBoardEmoji';

/// Whether [kBoardEmojiFont] can draw: at once on a phone; in the portal once
/// the bundled font has loaded. The editor redraws its pages when it turns true.
final boardEmojiFontReady = ValueNotifier<bool>(!kIsWeb);
