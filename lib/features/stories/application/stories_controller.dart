import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/story.dart';

/// The seam a real stories feature plugs into.
///
/// It returns an empty list, and that is the honest state of this feature: nothing in the
/// product publishes stories, so there are none to show. The rail above the conversation
/// list renders nothing at all while this is empty — no placeholder avatars, no "Your
/// story" button, no skeleton pretending data is on its way.
///
/// When a stories backend exists, override this provider at the composition root
/// (`lib/app/bootstrap.dart`) the way every repository already is. No presentation code
/// changes.
final storyRingsProvider = Provider<List<StoryRing>>((ref) => const []);

/// Whether this build can post a story.
///
/// Separate from having rings to read: a user may be able to see stories long before they
/// may create one, and the "Your story" entry must follow *this* flag rather than appearing
/// because the rail happens to be visible.
final canPostStoryProvider = Provider<bool>((ref) => false);
