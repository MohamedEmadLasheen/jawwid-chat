import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * A measuring instrument for TRUSTED_PROXY_HOPS, off unless PROXY_HOPS_PROBE
 * holds a probe TOKEN.
 *
 * WHY. The hop count is a property of the platform, and DigitalOcean does not
 * document it: its own support page says `do-connecting-ip` holds both the
 * client's address and the ingress server's. A guessed count is a security bug
 * either way (client-address.ts), so it is measured on the live app instead,
 * by the operator, with scripts/infra/measure-proxy-hops.sh
 * (production-runbook.md §1d).
 *
 * WHAT IT RECORDS. For a request that carries the probe token, one log line
 * with the SHAPE of the forwarding chain: how many X-Forwarded-For entries
 * arrived, and the POSITION (counted from the right) of three known values in
 * it -- the operator's own address (sent to us as a SHA-256 hash, which is
 * compared and dropped, never stored or logged: an IPv4 hash is reversible by
 * trying all 2^32 addresses, so it is treated as the address itself), the
 * address in `do-connecting-ip`, and the documentation-only sentinel
 * 192.0.2.123 the script forges. Positions, counts, booleans and a fixed label
 * only: NO address, header value or token is ever logged.
 *
 * WHY THE POSITION IS THE ANSWER. Express `trust proxy = N` takes the client
 * from the N-th X-Forwarded-For entry counting from the right (1-based), so an
 * entry found k places from the right (0-based) means N = k + 1.
 *
 * WHO CAN PROBE. Only a request carrying the token (compared in constant time).
 * Without it a request is neither logged nor counted, so nobody else can add a
 * forged measurement to the log or use up the line budget. The token is a
 * secret of the deployment, never echoed: not in a log line, not in an error.
 *
 * SAFETY. It never changes a response or a decision, and it logs at most
 * MAX_LINES lines per process start (one API instance; a restart or redeploy
 * starts a new count), so it cannot flood the logs.
 */
export const PROXY_HOPS_PROBE = 'PROXY_HOPS_PROBE';
export const PROBE_HEADER = 'x-jawwid-hop-probe';
export const PROBE_TOKEN_HEADER = 'x-jawwid-hop-probe-token';
export const PROBE_EXPECT_HEADER = 'x-jawwid-hop-probe-expect';
/** TEST-NET-1 (RFC 5737): reserved for documentation, never a real client. */
export const PROBE_SENTINEL = '192.0.2.123';
export const MAX_LINES = 50;

/** A fixed probe kind and the run id `send` generated: nobody can write words into the log through it. */
const LABEL = /^(?:plain|forged-xff|forged-connecting-ip)-[0-9a-f]{16}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** At least 32 characters of a URL-safe alphabet (`openssl rand -hex 32` gives 64). */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export class ProxyHopsProbeConfigurationError extends Error {
  constructor() {
    // The value is never repeated: it is meant to be a secret token.
    super(`${PROXY_HOPS_PROBE} must be unset, 'off', or a token of 32 to 128 characters from A-Z a-z 0-9 _ - ` +
      '(for example `openssl rand -hex 32`).');
    this.name = 'ProxyHopsProbeConfigurationError';
  }
}

/** The probe token, or undefined when the probe is off. A malformed value stops the boot. */
export function readProxyHopsProbe(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env[PROXY_HOPS_PROBE] ?? '').trim();
  if (raw === '' || raw === 'off') return undefined;
  if (!TOKEN.test(raw)) throw new ProxyHopsProbeConfigurationError();
  return raw;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time, and length-independent: both sides are hashed to 32 bytes first. */
export function tokenMatches(given: string | undefined, token: string): boolean {
  if (typeof given !== 'string' || given.length === 0) return false;
  return timingSafeEqual(digest(given), digest(token));
}

export interface ProbeRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** What one probed request looked like. Every field is a count, a position, a boolean or a fixed word. */
export interface ProbeShape {
  readonly label: string;
  /** X-Forwarded-For header lines, and the entries across all of them. */
  readonly xffHeaderLines: number;
  readonly xffEntries: number;
  /** 0-based positions from the RIGHT of X-Forwarded-For; null when absent. */
  readonly expectedIndexFromRight: number | null;
  readonly connectingIpIndexFromRight: number | null;
  readonly sentinelIndexFromRight: number | null;
  readonly connectingIpPresent: boolean;
  readonly connectingIpIsSentinel: boolean;
  /** The TCP peer is a private, loopback or link-local address (a platform router, not the internet). */
  readonly peerPrivate: boolean;
  readonly forwardedProto: 'http' | 'https' | 'absent' | 'other';
  readonly forwardedHostPresent: boolean;
  /** Express `trust proxy` that would yield the operator's address; null without the expect header. */
  readonly hopsForExpected: number | null;
}

function headerLines(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function indexFromRight(entries: readonly string[], match: (entry: string) => boolean): number | null {
  for (let k = 0; k < entries.length; k++) {
    if (match(entries[entries.length - 1 - k])) return k;
  }
  return null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** An address that cannot be a client on the internet. */
export function isPrivateAddress(raw: string | undefined): boolean {
  if (!raw) return false;
  const addr = raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4 ? raw.slice(7) : raw;
  if (isIP(addr) === 4) {
    const [a, b] = addr.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(addr) === 6) {
    const lower = addr.toLowerCase();
    return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

/** The shape of a probed request, or undefined when it is not one. Never throws. */
export function probeShape(req: ProbeRequest): ProbeShape | undefined {
  const label = headerLines(req.headers[PROBE_HEADER])[0]?.trim();
  if (!label || !LABEL.test(label)) return undefined;

  const lines = headerLines(req.headers['x-forwarded-for']);
  const entries = lines.flatMap((l) => l.split(',')).map((e) => e.trim()).filter((e) => e.length > 0);
  const expected = headerLines(req.headers[PROBE_EXPECT_HEADER])[0]?.trim().toLowerCase();
  const connecting = headerLines(req.headers['do-connecting-ip'])[0]?.trim();
  const proto = headerLines(req.headers['x-forwarded-proto'])[0]?.trim();

  const expectedIndexFromRight =
    expected && SHA256_HEX.test(expected) ? indexFromRight(entries, (e) => sha256(e) === expected) : null;
  return {
    label,
    xffHeaderLines: lines.length,
    xffEntries: entries.length,
    expectedIndexFromRight,
    connectingIpIndexFromRight: connecting ? indexFromRight(entries, (e) => e === connecting) : null,
    sentinelIndexFromRight: indexFromRight(entries, (e) => e === PROBE_SENTINEL),
    connectingIpPresent: connecting !== undefined && connecting.length > 0,
    connectingIpIsSentinel: connecting === PROBE_SENTINEL,
    peerPrivate: isPrivateAddress(req.socket?.remoteAddress),
    forwardedProto: proto === undefined ? 'absent' : proto === 'http' || proto === 'https' ? proto : 'other',
    forwardedHostPresent: headerLines(req.headers['x-forwarded-host']).length > 0,
    hopsForExpected: expectedIndexFromRight === null ? null : expectedIndexFromRight + 1,
  };
}

/** Express middleware: logs the shape of up to MAX_LINES token-carrying requests, then nothing. */
export function proxyHopProbe(token: string, log: (line: string) => void, maxLines = MAX_LINES) {
  let written = 0;
  return (req: ProbeRequest, _res: unknown, next: () => void): void => {
    try {
      if (written < maxLines && tokenMatches(headerLines(req.headers[PROBE_TOKEN_HEADER])[0], token)) {
        const shape = probeShape(req);
        if (shape) {
          written++;
          log(`proxy-hops probe ${JSON.stringify(shape)}`);
        }
      }
    } catch {
      /* a measuring instrument must never break a request */
    }
    next();
  };
}
