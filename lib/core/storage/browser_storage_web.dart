import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:web/web.dart' as web;

import 'browser_token_store.dart';

/// The real browser: `sessionStorage`, `localStorage` and `navigator.locks`.
///
/// Each is looked up defensively. A browser with site data blocked throws on the mere
/// property access, and an old one has no Web Locks; both are answered with null, which
/// [BrowserTokenStore] reads as "not here" (no "keep me signed in", or memory only).
BrowserBindings? browserBindings() => BrowserBindings(
      tab: _storage(() => web.window.sessionStorage),
      device: _storage(() => web.window.localStorage),
      lock: _hasLocks() ? _withLock : null,
    );

BrowserKeyValue? _storage(web.Storage Function() lookup) {
  try {
    return _WebStorage(lookup());
  } on Object {
    return null;
  }
}

bool _hasLocks() {
  try {
    return web.window.navigator.has('locks');
  } on Object {
    return false;
  }
}

/// `navigator.locks.request(name, callback)`: the callback runs once the lock is held, and
/// the lock is released when the promise it returns settles.
Future<T> _withLock<T>(String name, Future<T> Function() body) async {
  late T result;
  Object? failure;
  StackTrace? trace;

  JSPromise<JSAny?> granted(web.Lock? _) => () async {
        try {
          result = await body();
        } on Object catch (error, stack) {
          failure = error;
          trace = stack;
        }
      }()
          .toJS;

  await web.window.navigator.locks.request(name, granted.toJS).toDart;
  if (failure != null) Error.throwWithStackTrace(failure!, trace!);
  return result;
}

class _WebStorage implements BrowserKeyValue {
  _WebStorage(this._storage);

  final web.Storage _storage;

  @override
  String? read(String key) => _storage.getItem(key);

  @override
  void write(String key, String value) => _storage.setItem(key, value);

  @override
  void remove(String key) => _storage.removeItem(key);
}
