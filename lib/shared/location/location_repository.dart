import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import 'location.dart';

/// PD-45 PR-4: the parent's own location, and the shared country / subdivision lists.
///
/// | Method | Path |
/// |---|---|
/// | GET | `/me/location` -- `{countryCode, subdivisionCode, location: {ar, en} \| null, prompt, suggestedCountryCode?}` |
/// | PUT | `/me/location` `{countryCode, subdivisionCode}` -- answers the GET shape; stamps the prompt answered |
/// | POST | `/me/location/later` -- no body, 201 with the GET shape; the parent chose "Later" |
/// | GET | `/geo/countries` |
/// | GET | `/geo/countries/:country/subdivisions` |
///
/// The app never calls `/parent-profiles` for this (Contact File rule, plan section 4).
abstract interface class LocationRepository {
  Future<MyLocation> mine();

  /// [subdivisionCode] is null for a country with no subdivisions.
  Future<MyLocation> save({required String countryCode, String? subdivisionCode});

  /// The one-time prompt was answered "Later". Idempotent.
  Future<void> later();

  Future<GeoCountries> countries();

  Future<List<GeoSubdivision>> subdivisions(String countryCode);
}

class HttpLocationRepository implements LocationRepository {
  HttpLocationRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  // The lists change only with a new dataset build (the server caches them for a day).
  Future<GeoCountries>? _countries;
  final Map<String, Future<List<GeoSubdivision>>> _subdivisions = {};

  @override
  Future<MyLocation> mine() async =>
      MyLocation.fromJson((await _client.get<Map<String, Object?>>('/me/location')).data ?? const {});

  @override
  Future<MyLocation> save({required String countryCode, String? subdivisionCode}) async {
    final d = (await _client.put<Map<String, Object?>>(
      '/me/location',
      data: {'countryCode': countryCode, 'subdivisionCode': subdivisionCode},
    ))
            .data ??
        const {};
    return MyLocation.fromJson(d);
  }

  @override
  Future<void> later() async {
    await _client.post<Object?>('/me/location/later');
  }

  @override
  Future<GeoCountries> countries() {
    final cached = _countries;
    if (cached != null) return cached;
    final f = _loadCountries();
    _countries = f;
    // A failed load is retried next time, not remembered.
    f.catchError((Object _) {
      _countries = null;
      return const GeoCountries(countries: [], defaultLabel: BilingualName(ar: '', en: ''));
    });
    return f;
  }

  Future<GeoCountries> _loadCountries() async {
    final d = (await _client.get<Map<String, Object?>>('/geo/countries')).data ?? const {};
    return GeoCountries(
      defaultLabel: BilingualName.tryParse(d['defaultLabel']) ?? const BilingualName(ar: 'المنطقة', en: 'Region'),
      countries: [
        for (final raw in (d['countries'] as List?) ?? const [])
          if (raw is Map && raw['code'] is String && BilingualName.tryParse(raw) != null)
            GeoCountry(
              code: raw['code'] as String,
              name: BilingualName.tryParse(raw)!,
              label: BilingualName.tryParse(raw['label']) ?? const BilingualName(ar: 'المنطقة', en: 'Region'),
              hasSubdivisions: raw['hasSubdivisions'] == true,
              pinned: raw['pinned'] is int ? raw['pinned'] as int : null,
            ),
      ],
    );
  }

  @override
  Future<List<GeoSubdivision>> subdivisions(String countryCode) {
    final cached = _subdivisions[countryCode];
    if (cached != null) return cached;
    final f = _loadSubdivisions(countryCode);
    _subdivisions[countryCode] = f;
    f.catchError((Object _) {
      _subdivisions.remove(countryCode);
      return const <GeoSubdivision>[];
    });
    return f;
  }

  Future<List<GeoSubdivision>> _loadSubdivisions(String countryCode) async {
    final d = (await _client.get<Map<String, Object?>>('/geo/countries/$countryCode/subdivisions')).data ?? const {};
    return [
      for (final raw in (d['subdivisions'] as List?) ?? const [])
        if (raw is Map && raw['code'] is String && BilingualName.tryParse(raw) != null)
          GeoSubdivision(code: raw['code'] as String, name: BilingualName.tryParse(raw)!),
    ];
  }
}

/// Overridden at startup with [HttpLocationRepository]. Null in a build with no API: there
/// is no server to ask, so no Location row and no prompt are shown.
final locationRepositoryProvider = Provider<LocationRepository?>((ref) => null);

/// What the server holds for the signed-in parent's family. Re-read after a save.
final myLocationProvider = FutureProvider.autoDispose<MyLocation>((ref) {
  final repo = ref.watch(locationRepositoryProvider);
  if (repo == null) throw StateError('no location repository');
  return repo.mine();
});
