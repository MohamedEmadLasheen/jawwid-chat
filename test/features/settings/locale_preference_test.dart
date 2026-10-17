import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/features/settings/application/locale_preference.dart';

/// The language choice survives a restart. Before this, LocaleController held it in memory
/// only, so a parent who chose English on an Arabic phone was back in Arabic on every launch.
void main() {
  ProviderContainer launch(FakeLocaleStore store) {
    final container = ProviderContainer(overrides: [
      localeStoreProvider.overrideWithValue(store),
      localeOverrideProvider.overrideWith(PersistedLocaleController.new),
    ]);
    addTearDown(container.dispose);
    return container;
  }

  test('a choice is written, and the next launch comes back to it', () async {
    final store = FakeLocaleStore();
    final first = launch(store);
    first.read(localeOverrideProvider.notifier).set(const Locale('en'));
    await pumpEventQueue();
    expect(store.stored, 'en');

    final second = launch(store);
    expect(second.read(localeOverrideProvider), isNull, reason: 'device language until read');
    await pumpEventQueue();
    expect(second.read(localeOverrideProvider), const Locale('en'));
  });

  test('choosing "follow the device" clears the stored choice', () async {
    final store = FakeLocaleStore(stored: 'en');
    final container = launch(store);
    await pumpEventQueue();
    container.read(localeOverrideProvider.notifier).set(null);
    await pumpEventQueue();

    expect(store.stored, isNull);
    expect(launch(store).read(localeOverrideProvider), isNull);
  });

  test('unreadable storage, or a language this build does not ship: follow the device',
      () async {
    for (final store in [FakeLocaleStore(readThrows: true), FakeLocaleStore(stored: 'fr')]) {
      final container = launch(store);
      container.read(localeOverrideProvider);
      await pumpEventQueue();
      expect(container.read(localeOverrideProvider), isNull);
    }
  });

  test('a choice made while the stored one is still being read wins', () async {
    final store = FakeLocaleStore(stored: 'ar');
    final container = launch(store);
    container.read(localeOverrideProvider.notifier).set(const Locale('en'));
    await pumpEventQueue();

    expect(container.read(localeOverrideProvider), const Locale('en'));
  });
}
