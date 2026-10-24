import 'browser_token_store.dart';

/// Not a browser: there is no sessionStorage, localStorage or Web Lock to offer.
BrowserBindings? browserBindings() => null;
