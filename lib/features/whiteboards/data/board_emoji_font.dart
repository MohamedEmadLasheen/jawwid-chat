/// PD-55 Phase 1 (4): makes the board's emoji drawable.
///
/// A conditional export, so `package:web` is compiled only into the web build.
/// On a phone there is nothing to load: the system's emoji font draws them.
library;

export 'board_emoji_font_stub.dart' if (dart.library.js_interop) 'board_emoji_font_web.dart';
