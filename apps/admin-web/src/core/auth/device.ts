/**
 * PD-23: the name this browser gives itself at sign-in ("Chrome on macOS"), so
 * "My devices" can tell one browser from another. Short, at most 60
 * characters, and never a version number -- it is a label for a person, not a
 * fingerprint.
 */

interface UADataLike {
  brands?: Array<{ brand: string }>
  platform?: string
}

interface NavigatorLike {
  userAgent?: string
  userAgentData?: UADataLike
}

const MAX = 60

function browserFromBrands(brands: Array<{ brand: string }> | undefined): string | null {
  if (!brands) return null
  const names = brands.map((b) => b.brand).filter((b) => !/not.?a.?brand/i.test(b))
  if (names.some((n) => /edge/i.test(n))) return 'Edge'
  if (names.some((n) => /opera/i.test(n))) return 'Opera'
  if (names.some((n) => /samsung/i.test(n))) return 'Samsung Internet'
  if (names.some((n) => /google chrome/i.test(n))) return 'Chrome'
  if (names.some((n) => /chromium/i.test(n))) return 'Chromium'
  return null
}

function browserFromUA(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox'
  if (/CriOS\/|Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return null
}

function osFromPlatform(platform: string | undefined): string | null {
  if (!platform) return null
  const p = platform.toLowerCase()
  if (p.includes('mac')) return 'macOS'
  if (p.includes('win')) return 'Windows'
  if (p.includes('android')) return 'Android'
  if (p.includes('chrome os') || p.includes('chromeos') || p.includes('cros')) return 'ChromeOS'
  if (p.includes('ios')) return 'iOS'
  if (p.includes('linux')) return 'Linux'
  return null
}

function osFromUA(ua: string): string | null {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return null
}

export function deviceLabel(nav: NavigatorLike | undefined = globalThis.navigator): string {
  const ua = nav?.userAgent ?? ''
  const data = nav?.userAgentData
  const browser = browserFromBrands(data?.brands) ?? browserFromUA(ua) ?? 'Web browser'
  const os = osFromUA(ua) ?? osFromPlatform(data?.platform)
  const label = os ? `${browser} on ${os}` : browser
  return label.length > MAX ? label.slice(0, MAX) : label
}
