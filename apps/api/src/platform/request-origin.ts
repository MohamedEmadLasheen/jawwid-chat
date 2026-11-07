import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The origin (`scheme://host[:port]`) the current HTTP request reached this API
 * at, for building ABSOLUTE links back to it (RT-037 media URLs) without asking
 * clients to resolve relative ones. A phone on the LAN, a simulator on
 * localhost and a browser behind the production proxy each get links to the
 * address they actually used.
 *
 * `req.protocol` honours X-Forwarded-Proto only when TRUSTED_PROXY_HOPS
 * configures `trust proxy` (infra/http/bootstrap.ts). The HOST is always the
 * request's own `Host`, accepted only as a plain host[:port], and NEVER
 * `X-Forwarded-Host`: App Platform passes a client's X-Forwarded-Host through
 * unchanged (measured), while its ingress routes by the real host, so the
 * forwarded header could only ever carry a forged value. A link built from
 * `Host` is returned only to the same caller, inside their own response.
 * MEDIA_PUBLIC_BASE_URL / PAYMENT_LINK_BASE_URL, when set (the deploys set
 * both to the public HTTPS origin), override all of this.
 */
const store = new AsyncLocalStorage<string | undefined>();

const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

export function originOfRequest(req: {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const host = req.headers.host;
  if (typeof host !== 'string' || !HOST.test(host)) return undefined;
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

export function runWithRequestOrigin<T>(origin: string | undefined, fn: () => T): T {
  return store.run(origin, fn);
}

export function currentRequestOrigin(): string | undefined {
  return store.getStore();
}
