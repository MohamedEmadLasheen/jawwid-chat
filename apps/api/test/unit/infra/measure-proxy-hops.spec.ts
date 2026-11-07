/**
 * scripts/infra/measure-proxy-hops.sh `interpret`: it prints a TRUSTED_PROXY_HOPS
 * value only for one complete, consistent, safe run, and STOP for anything else.
 *
 * The log lines are made by the real probe (probeShape), wrapped the way the
 * API's JSON logger writes them, so the interpreter is tested on the format it
 * will actually read. The attacker cases are defence in depth: the token gate
 * already keeps an outsider's lines out of the log.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { PROBE_EXPECT_HEADER, PROBE_HEADER, PROBE_SENTINEL, probeShape } from '../../../src/infra/http/proxy-hop-probe';

const SCRIPT = path.resolve(__dirname, '../../../../../scripts/infra/measure-proxy-hops.sh');
const RUN = '00112233aabbccdd';
const OTHER_RUN = 'ffeeddcc99887766';
const ME = '203.0.113.7';
const EDGE = '172.70.1.1';
const ATTACKER = '198.51.100.9';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

type Kind = 'plain' | 'forged-xff' | 'forged-connecting-ip';
function line(kind: Kind, run: string, xff: string, opts: { expect?: string; peer?: string; connecting?: string } = {}): string {
  const shape = probeShape({
    headers: {
      [PROBE_HEADER]: `${kind}-${run}`,
      'x-forwarded-for': xff,
      'x-forwarded-proto': 'https',
      ...(opts.expect === undefined ? { [PROBE_EXPECT_HEADER]: hash(ME) } : opts.expect === '' ? {} : { [PROBE_EXPECT_HEADER]: hash(opts.expect) }),
      ...(opts.connecting ? { 'do-connecting-ip': opts.connecting } : {}),
    },
    socket: { remoteAddress: opts.peer ?? '10.244.0.5' },
  });
  if (!shape) throw new Error('not a probe line');
  // As the JSON logger writes it: the message is a JSON string, so its quotes are escaped.
  return JSON.stringify({ level: 'info', context: 'ProxyHopProbe', message: `proxy-hops probe ${JSON.stringify(shape)}` });
}

/** The operator's honest run on the measured App Platform chain: `<client>,<edge>`. */
const honest = (run = RUN) => [
  line('plain', run, `${ME},${EDGE}`, { connecting: ME }),
  line('forged-xff', run, `${PROBE_SENTINEL},${ME},${EDGE}`, { connecting: ME }),
  line('forged-connecting-ip', run, `${ME},${EDGE}`, { connecting: ME }),
];

/** Someone else's run, with a forged first entry claimed as "their" address: it would say 3. */
const forgedRun = (run: string) => [
  line('plain', run, `6.6.6.6,${ATTACKER},${EDGE}`, { expect: '6.6.6.6' }),
  line('forged-xff', run, `${PROBE_SENTINEL},6.6.6.6,${ATTACKER},${EDGE}`, { expect: '6.6.6.6' }),
  line('forged-connecting-ip', run, `6.6.6.6,${ATTACKER},${EDGE}`, { expect: '6.6.6.6' }),
];

function interpret(lines: string[], args: string[] = ['--run', RUN]) {
  const r = spawnSync('bash', [SCRIPT, 'interpret', ...args], { input: lines.join('\n') + '\n', encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('measure-proxy-hops interpret', () => {
  it('a complete, consistent run on the App Platform chain: TRUSTED_PROXY_HOPS = 2', () => {
    const r = interpret(honest());
    expect(r.status).toBe(0);
    expect(r.out).toContain('TRUSTED_PROXY_HOPS = 2');
    expect(r.out).toContain('forged do-connecting-ip: overwritten by the platform');
  });

  it('FORGED: another run in the log, even a later one, is ignored -- the value stays 2', () => {
    const r = interpret([...honest(), ...forgedRun(OTHER_RUN)]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('TRUSTED_PROXY_HOPS = 2');
    expect(r.out).not.toContain('= 3');
  });

  it('FORGED or DUPLICATED: a second line of a kind for the same run is STOP, never a value', () => {
    for (const extra of [forgedRun(RUN), [honest()[0]]]) {
      const r = interpret([...honest(), ...extra]);
      expect(r.status).toBe(1);
      expect(r.out).toContain('STOP');
      expect(r.out).not.toContain('TRUSTED_PROXY_HOPS =');
    }
  });

  it('MISSING: any of the three lines absent is STOP', () => {
    for (let drop = 0; drop < 3; drop++) {
      const r = interpret(honest().filter((_, i) => i !== drop));
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/STOP[\s\S]*no (plain|forged-xff|forged-connecting-ip) line/);
    }
  });

  it('STALE: an earlier run is never read for a new run id', () => {
    const r = interpret(honest(OTHER_RUN));
    expect(r.status).toBe(1);
    expect(r.out).toContain('STOP');
  });

  it('without your address in the chain (no --my-ip hash, or the wrong one) there is no value', () => {
    for (const expect_ of ['', '192.0.2.200']) {
      const lines = [
        line('plain', RUN, `${ME},${EDGE}`, { expect: expect_, connecting: ME }),
        line('forged-xff', RUN, `${PROBE_SENTINEL},${ME},${EDGE}`, { expect: expect_ }),
        line('forged-connecting-ip', RUN, `${ME},${EDGE}`, { expect: expect_ }),
      ];
      const r = interpret(lines);
      expect(r.status).toBe(1);
      expect(r.out).toContain('your address was not found');
    }
  });

  it('a PUBLIC TCP peer (the API reachable directly) is STOP', () => {
    const lines = honest();
    lines[1] = line('forged-xff', RUN, `${PROBE_SENTINEL},${ME},${EDGE}`, { peer: '8.8.8.8' });
    const r = interpret(lines);
    expect(r.status).toBe(1);
    expect(r.out).toContain('PUBLIC address');
  });

  it('a forged entry that lands inside the trusted hops is STOP', () => {
    const lines = honest();
    // A platform that puts the forged entry to the RIGHT of the client.
    lines[1] = line('forged-xff', RUN, `${ME},${PROBE_SENTINEL},${EDGE}`);
    const r = interpret(lines);
    expect(r.status).toBe(1);
    expect(r.out).toContain('STOP');
    expect(r.out).not.toContain('TRUSTED_PROXY_HOPS =');
  });

  it('an unstable chain (your address at different hops) is STOP', () => {
    const lines = honest();
    lines[2] = line('forged-connecting-ip', RUN, `${ME},10.0.0.9,${EDGE}`);
    const r = interpret(lines);
    expect(r.status).toBe(1);
    expect(r.out).toContain('not stable');
  });

  it('refuses to run without a well-formed run id', () => {
    for (const args of [[], ['--run'], ['--run', 'plain'], ['--run', RUN.toUpperCase()], ['--run', RUN + '0']]) {
      expect(interpret(honest(), args).status).toBe(2);
    }
  });

  it('send refuses a missing --my-ip, a missing token, and an origin with a path or trailing slash', () => {
    const send = (args: string[], token?: string) =>
      spawnSync('bash', [SCRIPT, 'send', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...(token ? { PROXY_HOPS_PROBE_TOKEN: token } : {}) } });
    expect(send(['https://api.example.test'], 'x'.repeat(40)).status).toBe(2);
    expect(send(['https://api.example.test', '--my-ip', ME]).status).toBe(2);
    expect(send(['https://api.example.test/', '--my-ip', ME], 'x'.repeat(40)).status).toBe(2);
    expect(send(['https://api.example.test/api/v1', '--my-ip', ME], 'x'.repeat(40)).status).toBe(2);
    expect(send(['http://api.example.test', '--my-ip', ME], 'x'.repeat(40)).status).toBe(2);
  });
});
