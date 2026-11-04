import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/shared/location/location.dart';
import 'package:jawwid_chat/shared/location/location_repository.dart';

/// PD-45 PR-4: the server's `/me/location` and `/geo/*`, scripted. Saving records the call and
/// does what the server does: the location is set and the prompt is answered. "Later" only
/// answers the prompt.
class FakeLocationRepository implements LocationRepository {
  FakeLocationRepository({MyLocation? initial, this.failSave = false, this.conflict = false})
      : current = initial ?? const MyLocation(prompt: true);

  MyLocation current;
  bool failSave;
  bool conflict;
  int mineCalls = 0;
  int laterCalls = 0;
  final List<({String country, String? subdivision})> saves = [];

  static const egypt = BilingualName(ar: 'مصر', en: 'Egypt');
  static const _governorate = BilingualName(ar: 'المحافظة', en: 'Governorate');
  static const _emirate = BilingualName(ar: 'الإمارة', en: 'Emirate');
  static const _region = BilingualName(ar: 'المنطقة', en: 'Region');

  static const _all = GeoCountries(
    defaultLabel: _region,
    countries: [
      GeoCountry(code: 'EG', name: egypt, label: _governorate, hasSubdivisions: true, pinned: 0),
      GeoCountry(code: 'AE', name: BilingualName(ar: 'الإمارات', en: 'United Arab Emirates'), label: _emirate, hasSubdivisions: true, pinned: 2),
      GeoCountry(code: 'JP', name: BilingualName(ar: 'اليابان', en: 'Japan'), label: _region, hasSubdivisions: false),
    ],
  );

  static const _subs = {
    'EG': [
      GeoSubdivision(code: 'EG-C', name: BilingualName(ar: 'القاهرة', en: 'Cairo')),
      GeoSubdivision(code: 'EG-GZ', name: BilingualName(ar: 'الجيزة', en: 'Giza')),
    ],
    'AE': [
      GeoSubdivision(code: 'AE-DU', name: BilingualName(ar: 'دبي', en: 'Dubai')),
    ],
  };

  @override
  Future<MyLocation> mine() async {
    mineCalls++;
    return current;
  }

  @override
  Future<MyLocation> save({required String countryCode, String? subdivisionCode}) async {
    if (conflict) throw const AppError(AppErrorKind.unknown, code: 'COMM.PARENT_EXISTS');
    if (failSave) throw StateError('save failed');
    saves.add((country: countryCode, subdivision: subdivisionCode));
    final c = _all.byCode(countryCode)!;
    final s = _subs[countryCode]?.where((x) => x.code == subdivisionCode).firstOrNull;
    current = MyLocation(
      countryCode: countryCode,
      subdivisionCode: subdivisionCode,
      name: BilingualName(
        ar: s == null ? c.name.ar : '${c.name.ar} · ${s.name.ar}',
        en: s == null ? c.name.en : '${c.name.en} · ${s.name.en}',
      ),
    );
    return current;
  }

  @override
  Future<void> later() async => laterCalls++;

  @override
  Future<GeoCountries> countries() async => _all;

  @override
  Future<List<GeoSubdivision>> subdivisions(String countryCode) async => _subs[countryCode] ?? const [];
}
