import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The origin (`scheme://host[:port]`) the current HTTP request reached this API
 * at, for building ABSOLUTE links back to it (RT-037 media URLs) without asking
 * clients to resolve relative ones. A phone on the LAN, a simulator on
 * localhost and a browser behind the production proxy each get links to the
 * address they actually used.
 *
 * `req.protocol` honours X-Forwarded-Proto only when TRUSTED_PROXY_HOPS
 * configures `trust proxy` (infra/http/bootstrap.ts). The Host header is
 * client-controlled, so it is accepted only as a plain host[:port]; a link
 * built from it is returned only to the same caller, inside their own
 * response. MEDIA_PUBLIC_BASE_URL, when set, overrides all of this.
 */
const store = new AsyncLocalStorage<string | undefined>();

const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

/**
 * Behind a TRUSTED proxy (TRUSTED_PROXY_HOPS > 0 -- the same setting that
 * makes `req.protocol` honour X-Forwarded-Proto), the public host is the
 * proxy's `X-Forwarded-Host` (first hop); otherwise -- no proxy declared, or a
 * client sending the header itself -- it is never read and `Host` is used.
 */
export function originOfRequest(
  req: { protocol?: string; headers: Record<string, string | string[] | undefined> },
  trustProxy: boolean = readTrustProxy(),
): string | undefined {
  const forwarded = req.headers['x-forwarded-host'];
  const forwardedHost = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined;
  const host = trustProxy && forwardedHost ? forwardedHost : req.headers.host;
  if (typeof host !== 'string' || !HOST.test(host)) return undefined;
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function readTrustProxy(): boolean {
  const raw = (process.env.TRUSTED_PROXY_HOPS ?? '').trim();
  return /^\d+$/.test(raw) && Number(raw) > 0;
}

export function runWithRequestOrigin<T>(origin: string | undefined, fn: () => T): T {
  return store.run(origin, fn);
}

export function currentRequestOrigin(): string | undefined {
  return store.getStore();
}
