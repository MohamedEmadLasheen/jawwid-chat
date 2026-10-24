import 'browser_storage.dart';
import 'browser_token_store.dart';
import 'secure_token_store.dart';

/// The token store for this build: the Keychain / Keystore on a phone, browser storage in
/// the PD-28 web portal (see [BrowserTokenStore] for why it is not the same store).
TokenStore platformTokenStore() {
  final browser = browserBindings();
  return browser == null ? SecureTokenStore() : BrowserTokenStore(browser);
}
