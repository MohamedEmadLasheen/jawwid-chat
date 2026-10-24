import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../l10n/app_localizations.dart';
import 'activity_view.dart';

/// In a browser (PD-28's web build) there is no WebView: the activity opens in
/// a new tab, where the package's own CSP sandbox applies.
ActivityViewFactory createActivityViewFactory() => const _NewTabActivityFactory();

class _NewTabActivityFactory implements ActivityViewFactory {
  const _NewTabActivityFactory();

  @override
  Widget build(BuildContext context, {required String url, required bool Function(Uri uri) allow}) => _NewTab(url: url);
}

class _NewTab extends StatefulWidget {
  const _NewTab({required this.url});

  final String url;

  @override
  State<_NewTab> createState() => _NewTabState();
}

class _NewTabState extends State<_NewTab> {
  @override
  void initState() {
    super.initState();
    launchUrl(Uri.parse(widget.url), webOnlyWindowName: '_blank');
  }

  @override
  Widget build(BuildContext context) => Center(child: Text(L10n.of(context).materialsOpenedInTab));
}
