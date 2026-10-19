import 'package:flutter/painting.dart';

import '../../../design/tokens.dart';

/// A text or voice story's background, by the name the server sends. The colours are tokens
/// ([StoryPalette]); an unknown or missing name is teal, the default the server applies too.
LinearGradient storyBackground(String? name) => LinearGradient(
      begin: AlignmentDirectional.topStart,
      end: AlignmentDirectional.bottomEnd,
      colors: StoryPalette.backgrounds[name] ?? StoryPalette.backgrounds['teal']!,
    );
