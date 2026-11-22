import { PERMISSIONS } from '../platform/permissions/catalogue';

/**
 * Access management M1: what a staff member holds, WHERE each key comes from, and what a change would do.
 * Pure: the rows come from chat.staff_access_sources (the same rules as chat.staff_access_profile) and, for a
 * preview, from the roles the caller is considering. Nothing here grants anything.
 */
export interface SourceRow {
  permission_key: string;
  source: 'super_admin' | 'tier_default' | 'role';
  role_id: string | null;
  role_key: string | null;
  name_en: string | null;
  name_ar: string | null;
  granted_by: string | null;
  granted_by_name: string | null;
  granted_at: Date | string | null;
  reason: string | null;
  /** M3: an active deny now removes this key (it is listed for provenance, not held). */
  denied?: boolean;
}

export interface KeySource {
  type: SourceRow['source'];
  roleId?: string;
  roleKey?: string;
  nameEn?: string;
  nameAr?: string;
  grantedBy?: { id: string; name: string | null };
  grantedAt?: string;
  reason?: string;
}

export interface HeldKey {
  key: string;
  action: string;
  label: { en: string; ar: string };
  risk: string;
  /** M3: an active restriction removes it from this account. */
  denied: boolean;
  /** M3: whether an administrator may restrict this key at all (its enforcement is verified end to end). */
  deniable: boolean;
  sources: KeySource[];
}

export interface HeldPage {
  page: string;
  keys: HeldKey[];
}

const CATALOGUE = new Map(PERMISSIONS.map((p) => [p.key, p]));

const iso = (d: Date | string | null): string | undefined => (d === null ? undefined : new Date(d).toISOString());

function sourceOf(r: SourceRow): KeySource {
  if (r.source !== 'role') return { type: r.source };
  return {
    type: 'role',
    roleId: r.role_id ?? undefined,
    roleKey: r.role_key ?? undefined,
    nameEn: r.name_en ?? undefined,
    nameAr: r.name_ar ?? undefined,
    ...(r.granted_by ? { grantedBy: { id: r.granted_by, name: r.granted_by_name } } : {}),
    grantedAt: iso(r.granted_at),
    reason: r.reason ?? undefined,
  };
}

/** The held keys, grouped by the page they belong to, each with every source that gives it. */
export function reportOf(rows: readonly SourceRow[]): HeldPage[] {
  const byKey = new Map<string, HeldKey>();
  for (const r of rows) {
    const def = CATALOGUE.get(r.permission_key);
    // A key the catalogue does not know is shown as itself, never dropped (a newer database than this API).
    const held = byKey.get(r.permission_key) ?? {
      key: r.permission_key,
      action: def?.action ?? r.permission_key,
      label: def?.label ?? { en: r.permission_key, ar: r.permission_key },
      risk: def?.risk ?? 'none',
      denied: false,
      deniable: def?.deniable ?? false,
      sources: [],
    };
    if (r.denied) held.denied = true;
    held.sources.push(sourceOf(r));
    byKey.set(r.permission_key, held);
  }
  const pages = new Map<string, HeldKey[]>();
  for (const k of byKey.values()) {
    const page = CATALOGUE.get(k.key)?.page ?? k.key.split('.')[0]!;
    pages.set(page, [...(pages.get(page) ?? []), k]);
  }
  return [...pages.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([page, keys]) => ({ page, keys: keys.sort((x, y) => x.key.localeCompare(y.key)) }));
}

export interface AccessChange {
  /** Roles the caller is considering adding (their keys, barred ones left out as the database leaves them out). */
  add: ReadonlyArray<{ roleId: string; keys: readonly string[] }>;
  /** Roles the caller is considering removing. */
  remove: readonly string[];
}

export interface AccessPreview {
  gained: string[];
  lost: string[];
  /** Pages the person would open that they cannot now, and pages they would no longer open. */
  pagesGained: string[];
  pagesLost: string[];
}

const pageOf = (key: string): string => CATALOGUE.get(key)?.page ?? key.split('.')[0]!;

/**
 * What adding and removing roles would do. A key a role-removal takes away stays if another source still gives it
 * (the tier default, another role): that is the point of showing provenance.
 */
export function previewOf(rows: readonly SourceRow[], change: AccessChange): AccessPreview {
  const removed = new Set(change.remove);
  // A key an active deny removes is not held: granting it again through a role does not hold it either.
  const denied = new Set(rows.filter((r) => r.denied).map((r) => r.permission_key));
  const before = new Set(rows.filter((r) => !r.denied).map((r) => r.permission_key));
  const after = new Set(rows.filter((r) => !r.denied && (r.source !== 'role' || !removed.has(r.role_id ?? ''))).map((r) => r.permission_key));
  for (const a of change.add) for (const k of a.keys) if (!denied.has(k)) after.add(k);
  const gained = [...after].filter((k) => !before.has(k)).sort();
  const lost = [...before].filter((k) => !after.has(k)).sort();
  const pages = (keys: Iterable<string>) => new Set([...keys].map(pageOf));
  const pb = pages(before);
  const pa = pages(after);
  return {
    gained,
    lost,
    pagesGained: [...pa].filter((p) => !pb.has(p)).sort(),
    pagesLost: [...pb].filter((p) => !pa.has(p)).sort(),
  };
}
