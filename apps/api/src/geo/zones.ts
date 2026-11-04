/**
 * PD-45 §7: the time zone a location implies -- a READ-ONLY estimate for staff
 * where no parent has opened the app, and a hint when a parent's app clock
 * disagrees with it. A location never writes `chat.actor_time_zone` (PD-22:
 * the zone comes from the device, and a manual pick wins).
 *
 * Only a country with ONE IANA zone has an estimate. These are copied by hand
 * from the public-domain `zone1970.tab` (a country with one line): the Gulf
 * and Egypt, which are the academy's markets, and a few neighbours. A
 * country with several zones (US, CA, AU, RU, BR, ...) has none until the
 * subdivision-to-zone follow-up of plan §7 (US, Canada and Australia).
 */
const ONE_ZONE: Readonly<Record<string, string>> = {
  EG: 'Africa/Cairo',
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  KW: 'Asia/Kuwait',
  QA: 'Asia/Qatar',
  BH: 'Asia/Bahrain',
  OM: 'Asia/Muscat',
  JO: 'Asia/Amman',
  IQ: 'Asia/Baghdad',
  LB: 'Asia/Beirut',
  SY: 'Asia/Damascus',
  YE: 'Asia/Aden',
  LY: 'Africa/Tripoli',
  TN: 'Africa/Tunis',
  DZ: 'Africa/Algiers',
  MA: 'Africa/Casablanca',
  SD: 'Africa/Khartoum',
  TR: 'Europe/Istanbul',
  GB: 'Europe/London',
};

/** The one IANA zone of a country, or null when it has several, is unknown, or none was given. */
export function estimatedZoneOf(countryCode: string | null | undefined): string | null {
  return countryCode ? (ONE_ZONE[countryCode] ?? null) : null;
}

function offsetMinutes(zone: string, at: Date): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part) return null;
    const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(part);
    if (!m) return null;
    return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  } catch {
    return null;
  }
}

/**
 * Whether two zones show the same clock at `at` (Dubai and Muscat do, all
 * year). The hint compares clocks, not names, so it never fires over a
 * different spelling of the same time. A zone this runtime cannot read never
 * raises a hint.
 */
export function sameClock(a: string, b: string, at: Date = new Date()): boolean {
  const x = offsetMinutes(a, at);
  const y = offsetMinutes(b, at);
  return x === null || y === null || x === y;
}
