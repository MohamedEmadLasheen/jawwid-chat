import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * A measuring instrument for TRUSTED_PROXY_HOPS, off unless PROXY_HOPS_PROBE=on.
 *
 * WHY. The hop count is a property of the platform, and DigitalOcean does not
 * document it: its own support page says `do-connecting-ip` holds both the
 * client's address and the ingress server's. A guessed count is a security bug
 * either way (client-address.ts), so it is measured on the live app instead,
 * by the operator, with scripts/infra/measure-proxy-hops.sh
 * (production-runbook.md §1d).
 *
 * WHAT IT RECORDS. For a request that carries the probe header, one log line
 * with the SHAPE of the forwarding chain: how many X-Forwarded-For entries
 * arrived, and the POSITION (counted from the right) of three known values in
 * it -- the operator's own address (given to us only as a SHA-256 hash), the
 * address in `do-connecting-ip`, and the documentation-only sentinel
 * 192.0.2.123 the script forges. Positions, counts and booleans only: NO
 * address is ever logged, the operator's is never even received in clear.
 *
 * WHY THE POSITION IS THE ANSWER. Express `trust proxy = N` takes the client
 * from the N-th X-Forwarded-For entry counting from the right (1-based), so an
 * entry found k places from the right (0-based) means N = k + 1.
 *
 * SAFETY. It never changes a response or a decision, it runs only for requests
 * that ask for it, and it logs at most MAX_LINES lines per process, so turning
 * it on cannot flood the logs. Anyone can send the header while it is on; all
 * they get is a bounded number of shape lines in OUR logs.
 */
export const PROXY_HOPS_PROBE = 'PROXY_HOPS_PROBE';
export const PROBE_HEADER = 'x-jawwid-hop-probe';
export const PROBE_EXPECT_HEADER = 'x-jawwid-hop-probe-expect';
/** TEST-NET-1 (RFC 5737): reserved for documentation, never a real client. */
export const PROBE_SENTINEL = '192.0.2.123';
export const MAX_LINES = 50;

/** A fixed probe kind and an optional run number: nobody can write words into the log through it. */
const LABEL = /^(?:plain|forged-xff|forged-connecting-ip)(?:-\d{1,14})?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export class ProxyHopsProbeConfigurationError extends Error {
  constructor(raw: string) {
    super(`${PROXY_HOPS_PROBE}='${raw}' must be 'on', 'off' or unset.`);
    this.name = 'ProxyHopsProbeConfigurationError';
  }
}

export function readProxyHopsProbe(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[PROXY_HOPS_PROBE] ?? '').trim();
  if (raw === '' || raw === 'off') return false;
  if (raw === 'on') return true;
  throw new ProxyHopsProbeConfigurationError(raw);
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

/** Express middleware: logs the shape of up to MAX_LINES probed requests, then nothing. */
export function proxyHopProbe(log: (line: string) => void, maxLines = MAX_LINES) {
  let written = 0;
  return (req: ProbeRequest, _res: unknown, next: () => void): void => {
    try {
      if (written < maxLines) {
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
