import 'dart:js_interop';

import 'package:flutter/services.dart';
import 'package:web/web.dart' as web;

import '../domain/board_emoji.dart';

Future<bool>? _loading;

/// The teacher portal: the browser's own emoji fonts are out of reach (the
/// renderer draws its own text, and the page's policy loads fonts from this
/// site only), so the bundled Noto Color Emoji (web/fonts, OFL 1.1) is fetched
/// from beside the page and registered as [kBoardEmojiFont]. Once per page
/// load; the editor redraws its pages when it arrives. False when it
/// cannot be loaded: the board still works, the emoji show as boxes.
Future<bool> loadBoardEmojiFont() => _loading ??= _load();

Future<bool> _load() async {
  try {
    // Beside the app, whatever route is open: /teacher/fonts/..., not /teacher/boards/x/fonts/...
    final url = Uri.parse(web.document.baseURI).resolve('fonts/NotoColorEmoji.ttf').toString();
    final response = await web.window.fetch(url.toJS).toDart;
    if (!response.ok) return false;
    final bytes = (await response.arrayBuffer().toDart).toDart;
    await (FontLoader(kBoardEmojiFont)..addFont(Future.value(ByteData.view(bytes)))).load();
    boardEmojiFontReady.value = true;
    return true;
  } on Object {
    _loading = null; // a later board may try again
    return false;
  }
}
