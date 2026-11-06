import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/shared/location/location_repository.dart';

/// PD-45 PR-4: the exact requests and the parsing of the answers (plan 5.4 and 5.1).
void main() {
  late List<RequestOptions> requests;
  late HttpLocationRepository repo;

  setUp(() {
    requests = [];
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example/api/v1'));
    dio.httpClientAdapter = _Adapter((o) {
      requests.add(o);
      final path = o.path;
      if (path.endsWith('/geo/countries')) {
        return _json({
          'version': 'cldr-49',
          'defaultLabel': {'en': 'Region', 'ar': 'المنطقة'},
          'countries': [
            {'code': 'EG', 'en': 'Egypt', 'ar': 'مصر', 'label': {'en': 'Governorate', 'ar': 'المحافظة'}, 'hasSubdivisions': true, 'pinned': 0},
            {'code': 'JP', 'en': 'Japan', 'ar': 'اليابان', 'label': {'en': 'Region', 'ar': 'المنطقة'}, 'hasSubdivisions': false, 'pinned': null},
          ],
        });
      }
      if (path.endsWith('/geo/countries/EG/subdivisions')) {
        return _json({
          'version': 'cldr-49',
          'country': 'EG',
          'label': {'en': 'Governorate', 'ar': 'المحافظة'},
          'subdivisions': [
            {'code': 'EG-GZ', 'en': 'Giza', 'ar': 'الجيزة'},
          ],
        });
      }
      if (path.endsWith('/me/location') && o.method == 'PUT') {
        return _json({'countryCode': 'EG', 'subdivisionCode': 'EG-GZ', 'location': {'ar': 'مصر · الجيزة', 'en': 'Egypt · Giza'}, 'prompt': false});
      }
      if (path.endsWith('/me/location')) {
        return _json({'countryCode': null, 'subdivisionCode': null, 'location': null, 'prompt': true, 'suggestedCountryCode': 'AE'});
      }
      return _json({});
    });
    repo = HttpLocationRepository(client: ApiClient(dio: dio, tokens: _Tokens()));
  });

  test('GET /me/location parses the prompt, the suggestion and an empty location', () async {
    final mine = await repo.mine();
    expect(requests.single.method, 'GET');
    expect(requests.single.path, endsWith('/me/location'));
    expect(mine.prompt, isTrue);
    expect(mine.suggestedCountryCode, 'AE');
    expect(mine.isSet, isFalse);
    expect(mine.name, isNull);
  });

  test('PUT /me/location sends exactly the two codes and parses the answer', () async {
    final saved = await repo.save(countryCode: 'EG', subdivisionCode: 'EG-GZ');
    expect(requests.single.method, 'PUT');
    expect(requests.single.data, {'countryCode': 'EG', 'subdivisionCode': 'EG-GZ'});
    expect(saved.name!.en, 'Egypt · Giza');
    expect(saved.prompt, isFalse);

    await repo.save(countryCode: 'JP');
    expect(requests.last.data, {'countryCode': 'JP', 'subdivisionCode': null});
  });

  test('Later is a POST to /me/location/later', () async {
    await repo.later();
    expect(requests.single.method, 'POST');
    expect(requests.single.path, endsWith('/me/location/later'));
  });

  test('the lists come from /geo and are fetched once', () async {
    final c = await repo.countries();
    expect(c.byCode('EG')!.label.en, 'Governorate');
    expect(c.byCode('EG')!.pinned, 0);
    expect(c.byCode('JP')!.hasSubdivisions, isFalse);
    await repo.countries();
    expect((await repo.subdivisions('EG')).single.code, 'EG-GZ');
    await repo.subdivisions('EG');
    expect(requests.map((r) => r.path).toList(), [
      '/geo/countries',
      '/geo/countries/EG/subdivisions',
    ]);
  });

  test('the app never reaches /parent-profiles for a location', () async {
    await repo.mine();
    await repo.countries();
    expect(requests.where((r) => r.path.contains('parent-profiles')), isEmpty);
  });
}

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'a';
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

class _Adapter implements HttpClientAdapter {
  _Adapter(this.handler);
  final ResponseBody Function(RequestOptions options) handler;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (requestStream != null) await requestStream.drain<void>();
    return handler(options);
  }
}

ResponseBody _json(Map<String, Object?> body) =>
    ResponseBody.fromString(jsonEncode(body), 200, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
