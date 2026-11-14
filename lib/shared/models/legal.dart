/// PD-58 (owner decision A-3; API-CONTRACT §1.1c): the Terms of Use an account accepts --
/// its kind's terms and the shared Code of Conduct -- as the server reports them.
///
/// The client holds no version name, no URL and no word of any document: all of it comes
/// from the server (`legal_document_version`), so a new version needs no app release.
library;

/// Where the account stands. `unavailable` wins over `required` on the server, and is never
/// read as `accepted` here.
enum LegalState { accepted, required, unavailable }

/// The document keys the server uses (`apps/api/src/legal/legal-documents.ts`). A key this
/// build does not know is still shown and still accepted -- under a generic title.
abstract final class LegalDocumentKeys {
  static const termsFamily = 'terms_family';
  static const termsTeacher = 'terms_teacher';
  static const termsStaff = 'terms_staff';
  static const codeOfConduct = 'code_of_conduct';

  static bool isTerms(String key) => key == termsFamily || key == termsTeacher || key == termsStaff;
}

/// One document the account must accept: `{documentKey, version, urlAr, urlEn}`.
class LegalDocument {
  const LegalDocument({
    required this.documentKey,
    required this.version,
    required this.urlAr,
    required this.urlEn,
  });

  final String documentKey;
  final String version;
  final String urlAr;
  final String urlEn;

  /// The page for the reader's language (developer guide §1.4 E).
  Uri urlFor(String languageCode) => Uri.parse(languageCode == 'ar' ? urlAr : urlEn);

  /// What `POST /me/legal/accept` and the sign-up's `acceptLegal` name: nothing else.
  Map<String, Object?> toAcceptance() => {'documentKey': documentKey, 'version': version};

  /// The document AT this version: a new version is a different thing to agree to.
  String get id => '$documentKey@$version';

  /// Null for anything this build cannot use -- a missing or empty field, or a URL that is
  /// not https (only an https page is ever opened, as for the build-time legal links).
  static LegalDocument? fromWire(Object? raw) {
    if (raw is! Map) return null;
    final key = raw['documentKey'];
    final version = raw['version'];
    final urlAr = raw['urlAr'];
    final urlEn = raw['urlEn'];
    if (key is! String || key.isEmpty || version is! String || version.isEmpty) return null;
    final ar = _https(urlAr);
    final en = _https(urlEn);
    if (ar == null || en == null) return null;
    // Stored trimmed: what was checked is exactly what is opened.
    return LegalDocument(documentKey: key, version: version, urlAr: ar, urlEn: en);
  }

  /// A list of documents, or null when any one of them cannot be used: the accepted set must
  /// be EXACTLY the required one, so a partial list is not a smaller set, it is unusable.
  static List<LegalDocument>? listFromWire(Object? raw) {
    if (raw is! List) return null;
    final out = <LegalDocument>[];
    for (final item in raw) {
      final doc = fromWire(item);
      if (doc == null) return null;
      out.add(doc);
    }
    return out;
  }

  /// The trimmed URL when it is an https one; null otherwise.
  static String? _https(Object? raw) {
    if (raw is! String) return null;
    final trimmed = raw.trim();
    final uri = Uri.tryParse(trimmed);
    return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty ? trimmed : null;
  }

  @override
  bool operator ==(Object other) =>
      other is LegalDocument &&
      other.documentKey == documentKey &&
      other.version == version &&
      other.urlAr == urlAr &&
      other.urlEn == urlEn;

  @override
  int get hashCode => Object.hash(documentKey, version, urlAr, urlEn);

  @override
  String toString() => 'LegalDocument($id)';
}

/// The `legal` block: `{state, required: [...], unavailable: [documentKey]}`.
class LegalStatus {
  const LegalStatus({required this.state, this.required = const [], this.unavailable = const []});

  static const acceptedStatus = LegalStatus(state: LegalState.accepted);

  /// Anything this build could not read: never "accepted".
  static const unreadable = LegalStatus(state: LegalState.unavailable);

  final LegalState state;
  final List<LegalDocument> required;
  final List<String> unavailable;

  /// The gate stands for anything but `accepted`.
  bool get holdsApp => state != LegalState.accepted;

  /// The `legal` field of [body] (`GET /me`, `actor`, the token pair, the accept answer).
  ///
  /// **Null when the field is absent** -- the API before ENG-10, which the clients ship
  /// ahead of (API-CONTRACT §1.1c, release order): no block, no gate. A field that is
  /// present is read by [fromWire], which fails closed.
  static LegalStatus? fromBody(Map<Object?, Object?>? body) {
    if (body == null || !body.containsKey('legal')) return null;
    return fromWire(body['legal']);
  }

  /// Reads a present block. Fails closed: whatever cannot be read is `unavailable`.
  ///  * `unavailable` (or any named unavailable document) wins, as on the server;
  ///  * `required` needs at least one usable document, and every listed one usable;
  ///  * `accepted` that still lists a document is `required` -- the list is what counts.
  static LegalStatus fromWire(Object? raw) {
    if (raw is! Map) return unreadable;
    final state = raw['state'];
    final unavailableRaw = raw['unavailable'];
    final unavailable = unavailableRaw is List ? unavailableRaw.whereType<String>().toList(growable: false) : const <String>[];
    if (state == 'unavailable' || unavailable.isNotEmpty) {
      return LegalStatus(state: LegalState.unavailable, unavailable: unavailable);
    }
    final requiredRaw = raw['required'];
    if (state == 'accepted' && (requiredRaw == null || (requiredRaw is List && requiredRaw.isEmpty))) {
      return acceptedStatus;
    }
    if (state != 'required' && state != 'accepted') return unreadable;
    final required = LegalDocument.listFromWire(requiredRaw);
    if (required == null || required.isEmpty) return unreadable;
    return LegalStatus(state: LegalState.required, required: List.unmodifiable(required));
  }

  /// Value equality, so an unchanged block (every token refresh carries one) is recognised
  /// and changes nothing downstream.
  @override
  bool operator ==(Object other) =>
      other is LegalStatus &&
      other.state == state &&
      _sameList(other.required, required) &&
      _sameList(other.unavailable, unavailable);

  @override
  int get hashCode => Object.hash(state, Object.hashAll(required), Object.hashAll(unavailable));

  static bool _sameList<T>(List<T> a, List<T> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  String toString() => 'LegalStatus(${state.name}, ${required.map((d) => d.id).join(', ')})';
}
