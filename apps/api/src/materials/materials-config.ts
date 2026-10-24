/**
 * PD-29: where the academy's lessons site lives, and which origins an activity
 * may be FRAMED from. Configuration, never code: the site can move to a
 * pinned, Chat-controlled snapshot origin by changing one variable, with no
 * migration (a `site` item stores its path only).
 *
 *   MATERIALS_SITE_BASE_URL   https://host[:port][/base] -- the lessons site.
 *                             Unset: `site` items cannot be opened (409).
 *   MATERIALS_FRAME_ORIGINS   https origins, space- or comma-separated, that a
 *                             link may be embedded from (sandbox
 *                             "allow-scripts allow-same-origin allow-forms":
 *                             the frame keeps ITS origin, never ours). The site
 *                             base's origin is always included. Any other
 *                             https link opens in the browser, not embedded.
 *
 * The same origins must be in Admin Web's `frame-src` (its own
 * MATERIALS_FRAME_ORIGINS, rendered into the nginx CSP).
 */
export interface MaterialsConfig {
  /** The site's base, without a trailing slash; null when unset. */
  siteBase: string | null;
  /** Origins a link may be framed from (scheme://host[:port]). */
  frameOrigins: ReadonlySet<string>;
}

const ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export class MaterialsConfigError extends Error {}

export function readMaterialsConfig(env: NodeJS.ProcessEnv = process.env): MaterialsConfig {
  const rawBase = (env.MATERIALS_SITE_BASE_URL ?? '').trim();
  let siteBase: string | null = null;
  const frameOrigins = new Set<string>();
  if (rawBase) {
    let u: URL;
    try {
      u = new URL(rawBase);
    } catch {
      throw new MaterialsConfigError('MATERIALS_SITE_BASE_URL must be an absolute https URL');
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) {
      throw new MaterialsConfigError('MATERIALS_SITE_BASE_URL must be https, with no credentials, query or fragment');
    }
    siteBase = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    frameOrigins.add(u.origin);
  }
  for (const raw of (env.MATERIALS_FRAME_ORIGINS ?? '').split(/[\s,]+/).filter(Boolean)) {
    const origin = raw.replace(/\/+$/, '');
    if (!ORIGIN.test(origin)) throw new MaterialsConfigError(`MATERIALS_FRAME_ORIGINS: ${JSON.stringify(raw)} is not an https origin`);
    frameOrigins.add(origin.toLowerCase());
  }
  return { siteBase, frameOrigins };
}

/** How a client must present what `open` returns. */
export type Presentation =
  /** An uploaded package from OUR origin: iframe sandbox "allow-scripts allow-forms", never same-origin. */
  | 'frame-isolated'
  /** A link on the frame allowlist: iframe sandbox "allow-scripts allow-same-origin allow-forms" (it keeps its own origin). */
  | 'frame-site'
  /** Any other https link: opened in the browser, never embedded. */
  | 'browser'
  /** A file (audio, video, PDF, image) from a signed storage URL. */
  | 'file';

export function linkPresentation(url: string, config: MaterialsConfig): 'frame-site' | 'browser' {
  try {
    return config.frameOrigins.has(new URL(url).origin.toLowerCase()) ? 'frame-site' : 'browser';
  } catch {
    return 'browser';
  }
}
