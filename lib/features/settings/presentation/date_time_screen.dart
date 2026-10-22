import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../core/time/time_zone_controller.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/app_clock.dart';

/// PD-22: Settings -> Date & time, the way a phone has it.
///
/// "Set automatically" (the default) follows the phone's own time zone, which the OS
/// changes by itself when the person lands somewhere else. Turned off, the person picks a
/// zone and every lesson time, reminder and notification is shown in it on every device
/// they sign in on, until they turn it back on.
class DateTimeScreen extends ConsumerWidget {
  const DateTimeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final async = ref.watch(timeZoneControllerProvider);
    final state = async.value;
    final automatic = state?.automatic ?? true;
    final zone = state?.effectiveZone;
    final lang = Localizations.localeOf(context).languageCode;

    Future<void> run(Future<void> Function() action) async {
      try {
        await action();
      } on Object {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.timeZoneSaveFailed)));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsDateTime)),
      body: ListView(
        children: [
          SwitchListTile(
            key: const ValueKey('time-zone-automatic'),
            title: Text(l10n.timeZoneSetAutomatically),
            subtitle: Text(l10n.timeZoneAutomaticHint),
            value: automatic,
            onChanged: state == null || zone == null && state.deviceZone == null
                ? null
                : (on) => run(() => ref.read(timeZoneControllerProvider.notifier).setAutomatic(on)),
          ),
          const Divider(),
          ListTile(
            key: const ValueKey('time-zone-current'),
            enabled: !automatic,
            title: Text(l10n.timeZoneLabel),
            subtitle: Text(zone == null ? l10n.timeZoneUnknown : zoneDisplayName(zone, lang)),
            trailing: automatic ? null : const Icon(Icons.chevron_right),
            onTap: automatic
                ? null
                : () async {
                    final picked = await Navigator.of(context).push<String>(
                      MaterialPageRoute(builder: (_) => _ZonePicker(selected: zone)),
                    );
                    if (picked != null) {
                      await run(() => ref.read(timeZoneControllerProvider.notifier).pick(picked));
                    }
                  },
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
            child: Text(
              l10n.timeZoneAppliesTo,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// Every "Region/City" zone, searchable by city. The academy's usual countries first.
class _ZonePicker extends StatefulWidget {
  const _ZonePicker({required this.selected});

  final String? selected;

  @override
  State<_ZonePicker> createState() => _ZonePickerState();
}

class _ZonePickerState extends State<_ZonePicker> {
  final _query = TextEditingController();
  late final List<String> _all = pickableZones();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final q = _query.text.trim().toLowerCase();
    final shown = q.isEmpty
        ? _all
        : _all.where((z) => z.toLowerCase().contains(q) || zoneDisplayName(z, lang).toLowerCase().contains(q)).toList();

    return Scaffold(
      appBar: AppBar(
        title: TextField(
          key: const ValueKey('time-zone-search'),
          controller: _query,
          autofocus: true,
          decoration: InputDecoration(hintText: l10n.timeZoneSearchHint, border: InputBorder.none),
          onChanged: (_) => setState(() {}),
        ),
      ),
      body: shown.isEmpty
          ? Center(child: Text(l10n.timeZoneNoMatch))
          : ListView.builder(
              itemCount: shown.length,
              itemBuilder: (context, i) {
                final z = shown[i];
                return ListTile(
                  key: ValueKey('time-zone-option-$z'),
                  title: Text(zoneDisplayName(z, lang)),
                  subtitle: Text(z),
                  trailing: z == widget.selected ? const Icon(Icons.check) : null,
                  onTap: () => Navigator.of(context).pop(z),
                );
              },
            ),
    );
  }
}

/// The countries most families write from, offered first (PD-22's request named them).
const _usual = [
  'Africa/Cairo',
  'Asia/Riyadh',
  'Asia/Kuwait',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
];

const _cityAr = {
  'Africa/Cairo': 'القاهرة',
  'Asia/Riyadh': 'الرياض',
  'Asia/Kuwait': 'الكويت',
  'Asia/Dubai': 'دبي',
  'Asia/Qatar': 'الدوحة',
  'Asia/Bahrain': 'البحرين',
  'Asia/Muscat': 'مسقط',
  'Asia/Amman': 'عمّان',
  'Asia/Baghdad': 'بغداد',
  'Asia/Beirut': 'بيروت',
  'Asia/Damascus': 'دمشق',
  'Asia/Aden': 'عدن',
  'Africa/Khartoum': 'الخرطوم',
  'Africa/Tripoli': 'طرابلس',
  'Africa/Tunis': 'تونس',
  'Africa/Algiers': 'الجزائر',
  'Africa/Casablanca': 'الدار البيضاء',
  'Europe/London': 'لندن',
  'Europe/Istanbul': 'إسطنبول',
  'Europe/Berlin': 'برلين',
  'Europe/Paris': 'باريس',
  'America/New_York': 'نيويورك',
  'America/Toronto': 'تورونتو',
  'Australia/Sydney': 'سيدني',
};

/// The zones a person can pick: canonical "Region/City" names, usual ones first.
List<String> pickableZones() {
  AppClock.ensureInitialized();
  final rest = tz.timeZoneDatabase.locations.keys
      .where((z) => RegExp(r'^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)/').hasMatch(z))
      .where((z) => !_usual.contains(z))
      .toList()
    ..sort();
  return [..._usual, ...rest];
}

/// "Kuwait (GMT+3)" / "الكويت (GMT+3)": the city and today's offset.
String zoneDisplayName(String zone, String languageCode) {
  final city = (languageCode == 'ar' ? _cityAr[zone] : null) ?? zone.split('/').last.replaceAll('_', ' ');
  AppClock.ensureInitialized();
  try {
    final offset = tz.TZDateTime.now(tz.getLocation(zone)).timeZoneOffset;
    final sign = offset.isNegative ? '-' : '+';
    final h = offset.inHours.abs();
    final m = offset.inMinutes.abs() % 60;
    return '$city (GMT$sign$h${m == 0 ? '' : ':${m.toString().padLeft(2, '0')}'})';
  } on Object {
    return city;
  }
}
