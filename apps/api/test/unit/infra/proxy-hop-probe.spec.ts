/**
 * The TRUSTED_PROXY_HOPS measuring probe: it reports the hop count that yields
 * the operator's own address, and never logs an address.
 *
 * The last group drives a real Express app with the App Platform chain as
 * measured (`<client>,<Cloudflare edge>`) and shows the hop count the probe
 * reports is the `trust proxy` value that gives Express the real client, even
 * when the client forges an entry.
 */
import { createHash } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  isPrivateAddress,
  MAX_LINES,
  PROBE_EXPECT_HEADER,
  PROBE_HEADER,
  PROBE_SENTINEL,
  ProxyHopsProbeConfigurationError,
  probeShape,
  proxyHopProbe,
  readProxyHopsProbe,
} from '../../../src/infra/http/proxy-hop-probe';

const CLIENT = '203.0.113.7';
const EDGE = '172.70.1.1';
const OTHER_USER = '198.51.100.44';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

const probe = (headers: Record<string, string | string[]>, remoteAddress = '10.244.0.5') =>
  probeShape({ headers: { [PROBE_HEADER]: 'plain-1', ...headers }, socket: { remoteAddress } });

describe('PROXY_HOPS_PROBE', () => {
  it('is off unless it says on; anything else stops the boot', () => {
    expect(readProxyHopsProbe({})).toBe(false);
    expect(readProxyHopsProbe({ PROXY_HOPS_PROBE: 'off' })).toBe(false);
    expect(readProxyHopsProbe({ PROXY_HOPS_PROBE: ' on ' })).toBe(true);
    for (const bad of ['1', 'true', 'ON', 'yes']) {
      expect(() => readProxyHopsProbe({ PROXY_HOPS_PROBE: bad })).toThrow(ProxyHopsProbeConfigurationError);
    }
  });
});

describe('probeShape — positions, never addresses', () => {
  it('reports the hop count that yields the operator: N = index from the right + 1', () => {
    const s = probe({ 'x-forwarded-for': `${CLIENT},${EDGE}`, [PROBE_EXPECT_HEADER]: hash(CLIENT), 'do-connecting-ip': CLIENT });
    expect(s).toMatchObject({ xffEntries: 2, expectedIndexFromRight: 1, hopsForExpected: 2, connectingIpIndexFromRight: 1, peerPrivate: true });
  });

  it('a forged entry sits LEFT of the client when the platform appends', () => {
    const s = probe({ 'x-forwarded-for': `${PROBE_SENTINEL},${CLIENT},${EDGE}`, [PROBE_EXPECT_HEADER]: hash(CLIENT) });
    expect(s).toMatchObject({ xffEntries: 3, sentinelIndexFromRight: 2, hopsForExpected: 2 });
  });

  it('counts entries across repeated header lines and tells a forged do-connecting-ip apart', () => {
    const s = probe({ 'x-forwarded-for': [CLIENT, EDGE], 'do-connecting-ip': PROBE_SENTINEL });
    expect(s).toMatchObject({ xffHeaderLines: 2, xffEntries: 2, connectingIpIsSentinel: true, connectingIpIndexFromRight: null });
  });

  it('logs no address: not the client, the edge, another user, the peer or the hash', () => {
    const s = probe(
      { 'x-forwarded-for': `${OTHER_USER},${CLIENT},${EDGE}`, 'do-connecting-ip': CLIENT, [PROBE_EXPECT_HEADER]: hash(CLIENT), 'x-forwarded-host': 'evil.test' },
      '10.244.0.5',
    );
    const line = JSON.stringify(s);
    for (const forbidden of [CLIENT, EDGE, OTHER_USER, '10.244.0.5', hash(CLIENT), 'evil.test']) expect(line).not.toContain(forbidden);
    expect(s?.forwardedHostPresent).toBe(true);
  });

  it('ignores a request without a valid probe label, so nobody writes words into the log', () => {
    expect(probeShape({ headers: {} })).toBeUndefined();
    for (const label of ['layla', 'plain layla', 'plain-abc', 'PLAIN', 'forged-xff-1'.repeat(3)]) {
      expect(probeShape({ headers: { [PROBE_HEADER]: label } })).toBeUndefined();
    }
    expect(probeShape({ headers: { [PROBE_HEADER]: 'forged-connecting-ip-17' } })?.label).toBe('forged-connecting-ip-17');
  });

  it('a malformed expect hash matches nothing', () => {
    expect(probe({ 'x-forwarded-for': CLIENT, [PROBE_EXPECT_HEADER]: CLIENT })).toMatchObject({ expectedIndexFromRight: null, hopsForExpected: null });
  });

  it('forwarded proto is a fixed word', () => {
    expect(probe({ 'x-forwarded-proto': 'https' })?.forwardedProto).toBe('https');
    expect(probe({ 'x-forwarded-proto': 'gopher' })?.forwardedProto).toBe('other');
    expect(probe({})?.forwardedProto).toBe('absent');
  });

  it('private means a platform router, not the internet', () => {
    for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of [CLIENT, EDGE, '172.32.0.1', '8.8.8.8', '2001:db8::1', '::ffff:8.8.8.8', '', undefined, 'not-an-ip']) {
      expect(isPrivateAddress(a)).toBe(false);
    }
  });
});

describe('proxyHopProbe middleware', () => {
  it('logs at most MAX_LINES probed requests and never stops a request', () => {
    const lines: string[] = [];
    const mw = proxyHopProbe((l) => lines.push(l));
    const next = jest.fn();
    for (let i = 0; i < MAX_LINES + 10; i++) mw({ headers: { [PROBE_HEADER]: 'plain' } }, undefined, next);
    mw({ headers: {} }, undefined, next);
    expect(lines).toHaveLength(MAX_LINES);
    expect(next).toHaveBeenCalledTimes(MAX_LINES + 11);
  });

  it('a request that breaks the probe still goes on', () => {
    const next = jest.fn();
    const hostile = { get headers(): never { throw new Error('boom'); } };
    proxyHopProbe(() => undefined)(hostile as never, undefined, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('the reported hop count is the trust proxy value that gives Express the real client', () => {
  // A local Express app stands in for the container; the socket peer is the
  // loopback "router", and the headers are the chain as App Platform delivers it.
  async function measure(xff: string) {
    const lines: string[] = [];
    const probeApp = express();
    probeApp.use(proxyHopProbe((l) => lines.push(l)) as express.RequestHandler);
    probeApp.get('/', (_req, res) => res.end());
    const reported = await new Promise<number>((resolve, reject) => {
      const srv = probeApp.listen(0, () => {
        const { port } = srv.address() as AddressInfo;
        http.get({ port, headers: { [PROBE_HEADER]: 'plain', [PROBE_EXPECT_HEADER]: hash(CLIENT), 'x-forwarded-for': xff } }, (r) => {
          r.resume();
          r.on('end', () => {
            srv.close();
            resolve(JSON.parse(lines[0].replace('proxy-hops probe ', '')).hopsForExpected);
          });
        }).on('error', reject);
      });
    });

    const app = express();
    app.set('trust proxy', reported);
    app.get('/', (req, res) => res.json({ ip: req.ip }));
    const ip = await new Promise<string>((resolve, reject) => {
      const srv = app.listen(0, () => {
        const { port } = srv.address() as AddressInfo;
        http.get({ port, headers: { 'x-forwarded-for': xff } }, (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => {
            srv.close();
            resolve(JSON.parse(body).ip);
          });
        }).on('error', reject);
      });
    });
    return { reported, ip };
  }

  it('the measured App Platform chain: 2, and Express then sees the client', async () => {
    expect(await measure(`${CLIENT},${EDGE}`)).toEqual({ reported: 2, ip: CLIENT });
  });

  it('with a forged entry appended in front, the same count still yields the client, not the forgery', async () => {
    expect(await measure(`${PROBE_SENTINEL},${CLIENT},${EDGE}`)).toEqual({ reported: 2, ip: CLIENT });
  });
});
