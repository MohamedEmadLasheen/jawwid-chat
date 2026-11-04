/// PD-45: a family's country and first-level subdivision (state / province / emirate /
/// governorate), as the parent's own `/me/location` and the shared `/geo/*` lists
/// give them. The field names are `country` / `subdivision` -- never anything that reads
/// as a postal or street line -- and the app holds nothing more than the two codes
/// and their names (plan section 4).
library;

import 'package:flutter/foundation.dart';

/// A name in both languages.
@immutable
class BilingualName {
  const BilingualName({required this.ar, required this.en});

  final String ar;
  final String en;

  String of(bool arabic) => arabic ? ar : en;

  static BilingualName? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final ar = raw['ar'];
    final en = raw['en'];
    if (ar is! String || en is! String) return null;
    return BilingualName(ar: ar, en: en);
  }

  @override
  bool operator ==(Object other) => other is BilingualName && other.ar == ar && other.en == en;

  @override
  int get hashCode => Object.hash(ar, en);
}

/// `GET /me/location`, and what `PUT /me/location` answers.
@immutable
class MyLocation {
  const MyLocation({
    this.countryCode,
    this.subdivisionCode,
    this.name,
    this.prompt = false,
    this.suggestedCountryCode,
  });

  factory MyLocation.fromJson(Map<String, Object?> json) => MyLocation(
        countryCode: _code(json['countryCode']),
        subdivisionCode: _code(json['subdivisionCode']),
        name: BilingualName.tryParse(json['location']),
        prompt: json['prompt'] == true,
        suggestedCountryCode: _code(json['suggestedCountryCode']),
      );

  final String? countryCode;
  final String? subdivisionCode;

  /// The location as it reads ("مصر · الجيزة" / "Egypt · Giza"), or null when none is set.
  final BilingualName? name;

  /// True while the family has no location and this contact has not answered the prompt.
  /// The server owns this stamp, so a second device is not asked again.
  final bool prompt;

  /// A country the server guesses from the contact's number. Never saved by itself.
  final String? suggestedCountryCode;

  bool get isSet => countryCode != null;

  static String? _code(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
}

/// One row of `GET /geo/countries`.
@immutable
class GeoCountry {
  const GeoCountry({
    required this.code,
    required this.name,
    required this.label,
    required this.hasSubdivisions,
    this.pinned,
  });

  final String code;
  final BilingualName name;

  /// What the second field is called in this country (Governorate, Emirate, State...).
  final BilingualName label;
  final bool hasSubdivisions;

  /// The place in the pinned order (Egypt first), or null.
  final int? pinned;
}

/// `GET /geo/countries`.
@immutable
class GeoCountries {
  const GeoCountries({required this.countries, required this.defaultLabel});

  final List<GeoCountry> countries;
  final BilingualName defaultLabel;

  GeoCountry? byCode(String? code) {
    for (final c in countries) {
      if (c.code == code) return c;
    }
    return null;
  }
}

/// One row of `GET /geo/countries/:country/subdivisions`.
@immutable
class GeoSubdivision {
  const GeoSubdivision({required this.code, required this.name});

  final String code;
  final BilingualName name;
}

/// "Egypt · Giza", "مصر · الجيزة".
String joinLocation(Iterable<String> parts) => parts.where((p) => p.isNotEmpty).join(' · ');

/// The flag emoji of an ISO 3166-1 alpha-2 code, or '' for anything else.
String flagOf(String code) {
  if (!RegExp(r'^[A-Z]{2}$').hasMatch(code)) return '';
  return String.fromCharCodes(code.codeUnits.map((u) => 0x1F1E6 + (u - 0x41)));
}
