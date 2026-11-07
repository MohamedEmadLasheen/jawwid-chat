import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/wire/wire_vocab.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/legal/legal_links.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/auth.dart';
import '../../../shared/models/legal.dart';
import '../../../shared/models/user_role.dart';
import '../../app_lock/application/app_lock_call_bypass.dart';
import '../../auth/application/auth_controller.dart';
import '../../settings/presentation/delete_account_screen.dart';
import '../application/legal_client.dart';

/// PD-58 (A-3; developer guide §1.4 B, §1.5; roadmap §7.5): the Terms of Use gate.
///
/// Laid over everything the router renders, for a signed-in account whose `legal` block is
/// anything but `accepted`:
///  * `required` -- one row per document: its title in the app's language, an Open link to
///    the server's URL for that language, and its own unticked box; Agree once every box is
///    ticked;
///  * `unavailable` -- a "temporarily unavailable" notice. Never treated as accepted.
/// Either way it offers Sign out, Delete account (parents and teachers, as Settings does) and
/// the Privacy Policy.
///
/// **No `legal` block at all -- the API before ENG-10 -- shows nothing.** The clients ship
/// before the API gate (API-CONTRACT §1.1c, release order), so this must stay a no-op until
/// the server starts sending the block.
///
/// ## Where it sits (app.dart)
///
/// INSIDE `AppLockGate`, directly over the router. A locked device shows the lock screen over
/// this gate -- nothing of it (the account's documents, Delete account) is readable or
/// reachable until the device is unlocked -- and the lock screen's own Sign out stays on top.
/// Like the lock, it is a screen over the session, not the end of it: the router's tree stays
/// mounted underneath (excluded from semantics, focus and pointer), so a draft whose send was
/// refused with TERMS_NOT_ACCEPTED is still there after Agree. The one exception is the call
/// screen of a call in progress, exactly as for the lock: the gate yields to it, and the
/// server still refuses every gated action (accepting a new call included).
///
/// This is a UX gate. The server enforces the Terms on every content route regardless.
///
/// ## What the covered app cannot reach while it is up
///
///  * **System back (S1).** The router's back-button dispatcher would pop the covered route
///    (and the draft with it), or close the app at its root. This gate is a
///    [WidgetsBindingObserver] registered when it is first built -- BEFORE the router below it
///    registers its dispatcher, since a parent's state is created before its child mounts --
///    so it is asked first: while covered it pops the gate's own navigator (the Delete account
///    screen) or else does nothing, and always says "handled". A predictive back GESTURE
///    (Android 14+) is claimed by every route whose gesture detector says yes, not by the
///    first observer, so while covered the router's routes are given a theme without the
///    predictive-back transition: they claim nothing, and the gesture ends as an ordinary
///    back, handled above. The gate's own routes keep it.
///  * **Snack bars (S2).** The gate has its own [ScaffoldMessenger]: a snack bar raised by a
///    covered screen shows only on that (covered, untappable) screen, never on the gate.
class LegalGate extends ConsumerStatefulWidget {
  const LegalGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<LegalGate> createState() => _LegalGateState();
}

class _LegalGateState extends ConsumerState<LegalGate> with WidgetsBindingObserver {
  final _navigator = GlobalKey<NavigatorState>();
  bool _covered = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Future<bool> didPopRoute() async {
    if (!_covered) return false;
    // The gate's own screens (Delete account, a dialog) close; the app beneath never moves,
    // and the app is not closed from under the gate.
    await _navigator.currentState?.maybePop();
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider.select((state) => state.user));
    final legal = user?.legal;
    final callOnScreen = ref.watch(appLockCallBypassProvider);
    final covered = user != null && legal != null && legal.holdsApp && !callOnScreen;
    _covered = covered;

    final theme = Theme.of(context);
    // The same tree whether covered or not, so the router below is never remounted.
    return Stack(
      fit: StackFit.expand,
      children: [
        Theme(
          data: covered ? theme.copyWith(pageTransitionsTheme: _withoutPredictiveBack(theme.pageTransitionsTheme)) : theme,
          child: IgnorePointer(
            ignoring: covered,
            child: ExcludeSemantics(
              excluding: covered,
              child: ExcludeFocus(excluding: covered, child: widget.child),
            ),
          ),
        ),
        if (covered)
          // Its own messenger and navigator: the gate sits above the router's. Its sign-out
          // confirmation and the Delete account screen open here, and snack bars from beneath
          // never land on it.
          ScaffoldMessenger(
            child: HeroControllerScope.none(
              child: Navigator(
                key: _navigator,
                pages: [
                  MaterialPage<void>(
                    key: const ValueKey('legal-gate-page'),
                    child: LegalGateScreen(user: user, legal: legal, appMessenger: ScaffoldMessenger.maybeOf(context)),
                  ),
                ],
                onDidRemovePage: (_) {},
              ),
            ),
          ),
      ],
    );
  }

  /// The same transitions, with Android's predictive-back one (whose routes claim the system
  /// back gesture) replaced by the plain zoom transition.
  static PageTransitionsTheme _withoutPredictiveBack(PageTransitionsTheme base) => PageTransitionsTheme(
        builders: {
          ...base.builders,
          TargetPlatform.android: const ZoomPageTransitionsBuilder(),
        },
      );
}

/// The gate's screen: the documents to accept, or the "temporarily unavailable" notice.
class LegalGateScreen extends ConsumerStatefulWidget {
  const LegalGateScreen({super.key, required this.user, required this.legal, this.appMessenger});

  final AuthUser user;
  final LegalStatus legal;

  /// The app's messenger (outside the gate's own), for what must outlive the gate.
  final ScaffoldMessengerState? appMessenger;

  @override
  ConsumerState<LegalGateScreen> createState() => _LegalGateScreenState();
}

class _LegalGateScreenState extends ConsumerState<LegalGateScreen> {
  /// Ticked documents, by [LegalDocument.id] -- a new version of a document is unticked.
  final Set<String> _ticked = {};
  bool _busy = false;
  String? _message;

  List<LegalDocument> get _required => widget.legal.required;

  @override
  void didUpdateWidget(LegalGateScreen old) {
    super.didUpdateWidget(old);
    // Only what is still asked for stays ticked.
    final ids = {for (final d in _required) d.id};
    _ticked.removeWhere((id) => !ids.contains(id));
  }

  bool get _allTicked => _required.isNotEmpty && _required.every((d) => _ticked.contains(d.id));

  AuthController get _auth => ref.read(authControllerProvider.notifier);

  Future<void> _agree() async {
    final l10n = L10n.of(context);
    final client = ref.read(legalClientProvider);
    final locale = Localizations.localeOf(context).toLanguageTag();
    // Exactly the set on screen, as the server listed it.
    final documents = List<LegalDocument>.of(_required);
    if (client == null) {
      setState(() => _message = l10n.legalGateFailed);
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final answer = await ref.read(legalRepositoryProvider).accept(documents: documents, client: client, locale: locale);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _ticked.clear();
      });
      _auth.adoptLegal(answer);
    } catch (error) {
      if (!mounted) return;
      final code = error is AppError ? error.code : null;
      switch (code) {
        case WireErrors.legalVersionStale || WireErrors.legalWrongDocuments || WireErrors.legalRequired:
          // The list on screen is not what the server holds: reload it and ask again from
          // unticked boxes. Never re-sent unchanged.
          setState(() => _ticked.clear());
          await _reload(changed: true);
        case WireErrors.supportSessionForbidden:
          setState(() {
            _busy = false;
            _message = l10n.legalGateSupportSession;
          });
        default:
          // COMM.LEGAL_NOT_CONFIGURED, no network, anything else: a generic failure. The ticks
          // stay, so trying again is one tap.
          setState(() {
            _busy = false;
            _message = l10n.legalGateFailed;
          });
      }
    }
  }

  /// `GET /me/legal`, adopted as the account's block. [changed]: say the documents changed.
  Future<void> _reload({bool changed = false}) async {
    final l10n = L10n.of(context);
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final legal = await ref.read(legalRepositoryProvider).current();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _message = changed ? l10n.legalGateChanged : null;
      });
      _auth.adoptLegal(legal);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        // N2: a failed reload is a failure to LOAD, not to save an agreement.
        _message = changed ? l10n.legalGateChanged : l10n.legalLoadFailed;
      });
    }
  }

  Future<void> _signOut() async {
    final l10n = L10n.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l10n.signOutConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancelAction),
          ),
          TextButton(
            key: const ValueKey('legal-sign-out-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.signOutAction),
          ),
        ],
      ),
    );
    if (sure == true) await _auth.signOut();
  }

  void _deleteAccount() {
    // "Account deleted" goes to the app's messenger, not the gate's own: the gate (and its
    // messenger) are gone once the account is, and the sign-in screen is where it is read.
    final appMessenger = widget.appMessenger;
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => DeleteAccountScreen(doneMessenger: appMessenger)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final unavailable = widget.legal.state != LegalState.required;
    final lang = Localizations.localeOf(context).languageCode;
    final privacy = ref.watch(legalLinksProvider).privacyPolicyFor(lang);
    final open = ref.watch(legalLinkOpenerProvider);
    final role = widget.user.role;
    // PD-56: parents and teachers delete their own account; staff accounts are closed by the
    // administration -- the same rule as Settings.
    final mayDelete = role == UserRole.parent || role == UserRole.teacher;

    return Scaffold(
      key: ValueKey(unavailable ? 'legal-unavailable' : 'legal-gate'),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(
                    unavailable ? Icons.cloud_off_outlined : Icons.gavel_outlined,
                    size: 48,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(height: Spacing.spacing6),
                  Semantics(
                    header: true,
                    child: Text(
                      unavailable ? l10n.legalUnavailableTitle : l10n.legalGateTitle,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(height: Spacing.spacing4),
                  Text(
                    unavailable ? l10n.legalUnavailableBody : l10n.legalGateIntro,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyLarge,
                  ),
                  const SizedBox(height: Spacing.spacing6),
                  if (!unavailable)
                    for (final doc in _required) ...[
                      LegalDocumentTile(
                        document: doc,
                        tickKey: ValueKey('legal-tick-${doc.documentKey}'),
                        openKey: ValueKey('legal-open-${doc.documentKey}'),
                        ticked: _ticked.contains(doc.id),
                        onChanged: _busy
                            ? null
                            : (v) => setState(() {
                                  if (v) {
                                    _ticked.add(doc.id);
                                  } else {
                                    _ticked.remove(doc.id);
                                  }
                                }),
                        showTitle: true,
                      ),
                      const SizedBox(height: Spacing.spacing4),
                    ],
                  if (_message != null) ...[
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        _message!,
                        key: const ValueKey('legal-gate-error'),
                        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                      ),
                    ),
                    const SizedBox(height: Spacing.spacing4),
                  ],
                  if (unavailable)
                    FilledButton(
                      key: const ValueKey('legal-unavailable-retry'),
                      onPressed: _busy ? null : _reload,
                      child: Text(l10n.retryAction),
                    )
                  else
                    FilledButton(
                      key: const ValueKey('legal-agree'),
                      onPressed: _busy || !_allTicked ? null : _agree,
                      child: _busy
                          ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(l10n.legalGateAgree),
                    ),
                  const SizedBox(height: Spacing.spacing6),
                  Wrap(
                    alignment: WrapAlignment.center,
                    children: [
                      if (privacy != null)
                        TextButton(
                          key: const ValueKey('legal-privacy'),
                          onPressed: () => open(privacy),
                          child: Text(l10n.legalPrivacyPolicy),
                        ),
                      TextButton(
                        key: const ValueKey('legal-sign-out'),
                        onPressed: _busy ? null : _signOut,
                        child: Text(l10n.signOutAction),
                      ),
                      if (mayDelete)
                        TextButton(
                          key: const ValueKey('legal-delete-account'),
                          onPressed: _busy ? null : _deleteAccount,
                          style: TextButton.styleFrom(foregroundColor: theme.colorScheme.error),
                          child: Text(l10n.deleteAccountTitle),
                        ),
                    ],
                  ),
                  // LD-11 (lead decision S3): the academy stays reachable from the gate -- a
                  // child-safety concern above all. The P-5 rows hide themselves when unset.
                  const SupportLinksTiles(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The document's title in the app's language. Shared with the PD-16 sign-up screen.
String legalDocumentTitle(L10n l10n, String documentKey) {
  if (LegalDocumentKeys.isTerms(documentKey)) return l10n.legalDocTermsTitle;
  if (documentKey == LegalDocumentKeys.codeOfConduct) return l10n.legalDocCodeOfConductTitle;
  return l10n.legalDocOtherTitle;
}

/// The checkbox's own label, naming the document (developer guide §1.5).
String legalAgreeLabel(L10n l10n, String documentKey) {
  if (LegalDocumentKeys.isTerms(documentKey)) return l10n.legalAgreeTerms;
  if (documentKey == LegalDocumentKeys.codeOfConduct) return l10n.legalAgreeCodeOfConduct;
  return l10n.legalAgreeOther;
}

/// One document to accept: (optionally) its title, its own box with a label naming it, and
/// an Open link to the server's page for the app's language. Never pre-ticked: [ticked] is
/// the caller's, and starts false.
class LegalDocumentTile extends ConsumerWidget {
  const LegalDocumentTile({
    super.key,
    required this.document,
    required this.tickKey,
    required this.openKey,
    required this.ticked,
    required this.onChanged,
    this.showTitle = false,
    this.isError = false,
  });

  final LegalDocument document;
  final Key tickKey;
  final Key openKey;
  final bool ticked;
  final ValueChanged<bool>? onChanged;
  final bool showTitle;
  final bool isError;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final open = ref.watch(legalLinkOpenerProvider);
    final title = legalDocumentTitle(l10n, document.documentKey);
    final change = onChanged;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showTitle) Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
        CheckboxListTile(
          key: tickKey,
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: ticked,
          isError: isError && !ticked,
          onChanged: change == null ? null : (v) => change(v ?? false),
          title: Text(legalAgreeLabel(l10n, document.documentKey)),
        ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            key: openKey,
            onPressed: () => open(document.urlFor(lang)),
            icon: const Icon(Icons.open_in_new, size: 18),
            label: Text(l10n.legalGateOpen, semanticsLabel: l10n.legalGateOpenDocument(title)),
          ),
        ),
      ],
    );
  }
}
