/// PD-28: the browser's storage for [BrowserTokenStore], or null on a phone.
///
/// A conditional export, so `package:web` is compiled only into the web build: the phone
/// builds get the stub, which has no browser to offer.
library;

export 'browser_storage_stub.dart' if (dart.library.js_interop) 'browser_storage_web.dart';
