import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'activity_view_web.dart' if (dart.library.io) 'activity_view_mobile.dart';

/// PD-29: the seam an activity plays behind -- an HTML5 package (from its play
/// URL) or an https link. Nothing above it knows about a WebView, so no test
/// opens a platform view.
///
/// What the real one guarantees (activity_view_mobile.dart): JavaScript runs,
/// but no JavaScript channel connects the page to the app; navigation is pinned
/// by [allow] (the package's own play prefix, or the link's host) and anything
/// else is refused; the WebView holds no app credentials -- the app's tokens
/// live in the keychain and in memory, never in a WebView cookie or storage. A
/// package is sandboxed by its own CSP header besides (an opaque origin).
abstract interface class ActivityViewFactory {
  /// [sandbox] is the exact iframe sandbox for the web build ([sandboxIsolated] or
  /// [sandboxSite]); [allow] pins every top-level navigation. [audio], for a
  /// Quran lesson of the lessons site, is the audio list the release gate gave
  /// this account (lesson_audio.dart): it is handed to the page as DATA, to the
  /// page's own origin only, and nothing else ever crosses to it.
  Widget build(BuildContext context,
      {required String url, required String sandbox, required bool Function(Uri uri) allow, Future<Map<String, Object?>?>? audio});
}

final activityViewFactoryProvider = Provider<ActivityViewFactory>((ref) => createActivityViewFactory());

/// What an activity at [url] may navigate to: a package stays under its own
/// play prefix (`…/materials/play/<item>/<token>/`); a link stays on its host.
bool Function(Uri) activityAllowance(String url, {required bool isPackage}) {
  final start = Uri.parse(url);
  if (isPackage) {
    final segments = start.pathSegments;
    final at = segments.indexOf('play');
    final prefixSegments = at >= 0 && segments.length > at + 2 ? segments.sublist(0, at + 3) : segments;
    final prefix = '/${prefixSegments.join('/')}/';
    return (uri) => uri.scheme == start.scheme && uri.host == start.host && uri.port == start.port && uri.path.startsWith(prefix);
  }
  return (uri) => uri.scheme == 'https' && uri.host == start.host;
}
