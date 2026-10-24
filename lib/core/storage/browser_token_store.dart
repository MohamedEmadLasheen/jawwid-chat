import '../../shared/models/auth.dart';
import 'secure_token_store.dart';

/// One of the browser's two key-value stores, as far as the token store needs one.
///
/// A seam, so the storage rules below are unit-tested without a browser: the real ones are
/// `sessionStorage` and `localStorage` (see `browser_storage_web.dart`). Every method may
/// throw -- a browser with storage blocked does -- and [BrowserTokenStore] treats a throw as
/// "nothing there".
abstract interface class BrowserKeyValue {
  String? read(String key);
  void write(String key, String value);
  void remove(String key);
}

/// What a browser offers the token store. Null pieces are missing in this browser.
class BrowserBindings {
  const BrowserBindings({required this.tab, required this.device, this.lock});

  /// `sessionStorage`: this tab only, survives a reload, dies with the tab.
  final BrowserKeyValue? tab;

  /// `localStorage`: shared by every tab of this browser, survives a restart.
  final BrowserKeyValue? device;

  /// The Web Locks API (`navigator.locks.request`), or null where the browser has none.
  final Future<T> Function<T>(String name, Future<T> Function() body)? lock;
}

/// Where the refresh token of this tab lives.
enum BrowserPersistence {
  /// sessionStorage. The default, and always the answer for the super admin.
  tab,

  /// localStorage, after a login the server answered `session.remembered: true`.
  device,
}

/// PD-28: the teacher web portal keeps its session exactly as Admin Web does (PD-23 §4,
/// `apps/admin-web/src/core/auth/tokens.ts`), and for the same reasons.
///
/// * **Access token: memory only.** It is the credential every request carries, so it is
///   never written where a script could read it after the tab is gone. After a reload
///   [read] answers with an empty access token, the first request is refused with a 401,
///   and the one refresh authority (`StoredTokenProvider`) renews it.
/// * **Refresh token: sessionStorage or localStorage, chosen by the SERVER.** The login's
///   `session.remembered` decides it ([AuthSession.remembered]); a refresh leaves it where
///   it was.
/// * **Cross-tab safety.** The API reads a replayed refresh token as theft and revokes every
///   session on the account. Two tabs sharing one localStorage token that each refreshed
///   would sign the whole account out. So "keep me signed in" is offered only where the
///   Web Locks API exists ([persistenceSupported]), and every refresh in device mode runs
///   under one lock and reads the token INSIDE it ([exclusive]).
///
/// The phone keeps using [SecureTokenStore] (Keychain / Keystore). Nothing here runs there.
class BrowserTokenStore implements TokenStore {
  BrowserTokenStore(this._browser);

  /// Per-tab refresh token (sessionStorage). Its own key, not Admin Web's: the portal is
  /// served from the Admin Web origin, and the two apps must not adopt each other's session.
  static const tabRefreshKey = 'jawwid.teacher.refresh';

  /// Per-device refresh token (localStorage), shared by every tab of this browser.
  static const deviceRefreshKey = 'jawwid.teacher.refresh.persistent';

  /// The Web Lock every device-mode refresh is serialized under.
  static const refreshLock = 'jawwid.teacher.refresh';

  final BrowserBindings _browser;

  String? _accessToken;
  DateTime? _accessExpiresAt;

  /// Null until known: re-derived from where a token is found, sessionStorage first, so a
  /// new tab of a remembered browser joins device mode.
  BrowserPersistence? _mode;

  /// Which storage holds this tab's refresh token now, or null when there is none.
  BrowserPersistence? get mode => _currentMode();

  /// Whether "Keep me signed in on this device" may be offered: Web Locks AND a working
  /// localStorage. Without both, a shared token could be replayed, so it is not offered.
  bool get persistenceSupported {
    final device = _browser.device;
    if (_browser.lock == null || device == null) return false;
    try {
      const probe = '$deviceRefreshKey.probe';
      device.write(probe, '1');
      device.remove(probe);
      return true;
    } on Object {
      return false;
    }
  }

  /// Runs [body] so no two tabs of this browser can present the same refresh token: under
  /// the [refreshLock] Web Lock in device mode, directly in tab mode (one tab, one token).
  /// [body] must read the token ([read]) inside, never before.
  Future<T> exclusive<T>(Future<T> Function() body) {
    final lock = _browser.lock;
    if (lock != null && _currentMode() == BrowserPersistence.device) {
      return lock<T>(refreshLock, body);
    }
    return body();
  }

  /// The refresh token is read from storage on EVERY call, never cached: in device mode
  /// another tab may have rotated it a moment ago.
  @override
  Future<AuthSession?> read() async {
    final refresh = switch (_currentMode()) {
      BrowserPersistence.device => _get(_browser.device, deviceRefreshKey),
      BrowserPersistence.tab => _get(_browser.tab, tabRefreshKey),
      null => null,
    };
    if (refresh == null) {
      _accessToken = null;
      _accessExpiresAt = null;
      return null;
    }
    return AuthSession(
      // Empty after a reload: no access token is ever stored. The token provider sends no
      // Authorization header for it, the API answers 401, and the session is renewed.
      accessToken: _accessToken ?? '',
      refreshToken: refresh,
      accessTokenExpiresAt: _accessExpiresAt ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  /// A login names [AuthSession.remembered] and decides the mode; a refresh leaves it null
  /// and the rotated token goes back where the previous one was. A remembered login in a
  /// browser that cannot keep it safely stays per-tab.
  @override
  Future<void> write(AuthSession session) async {
    _accessToken = session.accessToken;
    _accessExpiresAt = session.accessTokenExpiresAt;

    final remembered = session.remembered;
    final next = remembered == null
        ? (_currentMode() ?? BrowserPersistence.tab)
        : (remembered && persistenceSupported ? BrowserPersistence.device : BrowserPersistence.tab);
    _mode = next;

    if (next == BrowserPersistence.device) {
      _set(_browser.device, deviceRefreshKey, session.refreshToken);
      _delete(_browser.tab, tabRefreshKey);
    } else {
      _set(_browser.tab, tabRefreshKey, session.refreshToken);
      // Only a login decides the mode. A refresh in tab mode leaves a device token -- another
      // tab's session -- alone.
      if (remembered != null) _delete(_browser.device, deviceRefreshKey);
    }
  }

  /// Ends this tab's session. In device mode removing the shared token is what ends the
  /// browser's other tabs too: their next refresh finds nothing, and the API has already
  /// revoked the session their access token names.
  @override
  Future<void> clear() async {
    final mode = _mode;
    _accessToken = null;
    _accessExpiresAt = null;
    _mode = null;
    _delete(_browser.tab, tabRefreshKey);
    if (mode == BrowserPersistence.device) _delete(_browser.device, deviceRefreshKey);
  }

  BrowserPersistence? _currentMode() => _mode ??= _resolveMode();

  BrowserPersistence? _resolveMode() {
    if (_get(_browser.tab, tabRefreshKey) != null) return BrowserPersistence.tab;
    if (persistenceSupported && _get(_browser.device, deviceRefreshKey) != null) {
      return BrowserPersistence.device;
    }
    return null;
  }

  static String? _get(BrowserKeyValue? store, String key) {
    try {
      final value = store?.read(key);
      return value == null || value.isEmpty ? null : value;
    } on Object {
      return null;
    }
  }

  static void _set(BrowserKeyValue? store, String key, String value) {
    try {
      store?.write(key, value);
    } on Object {
      // Memory only: still usable until the tab reloads.
    }
  }

  static void _delete(BrowserKeyValue? store, String key) {
    try {
      store?.remove(key);
    } on Object {
      // Nothing to clear.
    }
  }
}
