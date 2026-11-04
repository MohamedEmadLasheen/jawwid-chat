import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/location/location.dart';
import '../../../shared/location/location_form.dart';
import '../../../shared/location/location_repository.dart';

/// The accounts already shown the prompt in this app session (an account switch asks the
/// next parent). The durable "answered" stamp is the server's; this only stops a second
/// ask in the same session when the answer could not be recorded.
class LocationPromptAsked extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  void mark(String accountId) => state = {...state, accountId};
}

final locationPromptAskedProvider = NotifierProvider<LocationPromptAsked, Set<String>>(LocationPromptAsked.new);

/// PD-45 PR-4 (plan 6.1 option b, 5.4): a parent whose family has no location is asked ONCE,
/// "Where does the family live?", with Save and Later. The server decides (`prompt` in
/// `GET /me/location`) and holds the stamp, so a second device is not asked again; a
/// parent shell mounts this, nobody else does.
///
/// The phone's suggestion (`suggestedCountryCode`) is only a chip in the picker. Nothing
/// is saved unless the parent taps Save.
class LocationPromptGate extends ConsumerStatefulWidget {
  const LocationPromptGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<LocationPromptGate> createState() => _LocationPromptGateState();
}

class _LocationPromptGateState extends ConsumerState<LocationPromptGate> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_maybeAsk()));
  }

  Future<void> _maybeAsk() async {
    final repo = ref.read(locationRepositoryProvider);
    // The account asked about: if another one is signed in by the time the server answers,
    // that answer was about someone else and is dropped.
    final accountId = ref.read(authControllerProvider).user?.id;
    if (repo == null || accountId == null || ref.read(locationPromptAskedProvider).contains(accountId)) return;
    final MyLocation mine;
    try {
      mine = await repo.mine();
    } catch (_) {
      return; // nothing is asked on a failed read
    }
    if ( !mine.prompt || !mounted || ref.read(authControllerProvider).user?.id != accountId) return;
    if (ref.read(locationPromptAskedProvider).contains(accountId)) return;
    ref.read(locationPromptAskedProvider.notifier).mark(accountId);
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _LocationPromptDialog(repository: repo, suggestedCountryCode: mine.suggestedCountryCode),
    );
    if (saved == true) ref.invalidate(myLocationProvider);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _LocationPromptDialog extends StatelessWidget {
  const _LocationPromptDialog({required this.repository, required this.suggestedCountryCode});

  final LocationRepository repository;
  final String? suggestedCountryCode;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return AlertDialog(
      key: const ValueKey('location-prompt'),
      title: Text(l10n.locationSheetTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.locationPromptBody),
            const SizedBox(height: Spacing.spacing4),
            LocationForm(
              repository: repository,
              suggestedCountryCode: suggestedCountryCode,
              secondaryLabel: l10n.locationLater,
              onSecondary: () async {
                // "Later" counts as the one time. Without a record (the request failed)
                // it is still not asked again this session.
                final nav = Navigator.of(context);
                unawaited(repository.later().catchError((Object _) {}));
                nav.pop(false);
              },
              onDone: (_) => Navigator.of(context).pop(true),
            ),
          ],
        ),
      ),
    );
  }
}
