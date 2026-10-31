/**
 * The connection pool is sized in one place (database-pool.ts) and reaches the
 * client Nest builds. Before: nothing read DATABASE_POOL_MAX, so Prisma's
 * default (CPUs x 2 + 1 = 3 on a 1 vCPU instance) was the pool, whatever the
 * deploy workflow set.
 */
import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { DATABASE_POOL_DEFAULTS, pooledDatabaseUrl, setDatabasePoolRole, statementTimeoutMs } from '../../../src/platform/database-pool';
import { cliPrismaClient } from '../../../src/cli/cli-prisma';
import { ActorScopedDatabase } from '../../../src/platform/actor-database';
import { PrismaService } from '../../../src/platform/prisma.service';

const URL_ = 'postgresql://chat:pw@db.example:25060/jawwid?sslmode=require';
const params = (url: string | undefined) => new URL(url!).searchParams;
/** The URL the engine will connect with (Prisma keeps the constructor's datasourceUrl here). */
const urlOf = (p: unknown) =>
  (p as { _engineConfig: { overrideDatasources: { db?: { url?: string } } } })._engineConfig.overrideDatasources.db?.url;

describe('pooledDatabaseUrl', () => {
  it('DATABASE_POOL_MAX sets the size; the wait for a connection is always 10 s', () => {
    expect(DATABASE_POOL_DEFAULTS).toEqual({ poolTimeoutSeconds: 10, cliConnectionLimit: 2 });
    const p = params(pooledDatabaseUrl(URL_, { DATABASE_POOL_MAX: '5' }));
    expect(p.get('connection_limit')).toBe('5');
    expect(p.get('pool_timeout')).toBe('10');
    expect(p.get('sslmode')).toBe('require'); // the URL's own parameters survive
  });

  it('unset or blank (a laptop, CI): the size is left to Prisma, the wait is still set', () => {
    for (const env of [{}, { DATABASE_POOL_MAX: ' ' }]) {
      const p = params(pooledDatabaseUrl(URL_, env));
      expect(p.has('connection_limit')).toBe(false);
      expect(p.get('pool_timeout')).toBe('10');
    }
  });

  it('the worker reads its own variable; the API reads DATABASE_POOL_MAX', () => {
    const env = { DATABASE_POOL_MAX: '7', DATABASE_WORKER_POOL_MAX: '3' };
    expect(params(pooledDatabaseUrl(URL_, env, 'api')).get('connection_limit')).toBe('7');
    expect(params(pooledDatabaseUrl(URL_, env, 'worker')).get('connection_limit')).toBe('3');
    expect(params(pooledDatabaseUrl(URL_, { DATABASE_POOL_MAX: '7' }, 'worker')).has('connection_limit')).toBe(false);
    expect(() => pooledDatabaseUrl(URL_, { DATABASE_WORKER_POOL_MAX: '0' }, 'worker')).toThrow('DATABASE_WORKER_POOL_MAX');
  });

  it('both deploy workflows fit the 1 GiB plan (22 usable): (API + worker) x 2 during a deploy <= 20, API larger', () => {
    for (const wf of ['deploy-staging.yml', 'deploy-production.yml']) {
      const text = readFileSync(`${__dirname}/../../../../../.github/workflows/${wf}`, 'utf8');
      const api = Number(/DATABASE_POOL_MAX: '(\d+)'/.exec(text)?.[1]);
      const worker = Number(/DATABASE_WORKER_POOL_MAX: '(\d+)'/.exec(text)?.[1]);
      expect([wf, api, worker]).toEqual([wf, 7, 3]);
      expect([wf, 2 * (api + worker) <= 20]).toEqual([wf, true]);
    }
  });

  it('a URL that already names the pool keeps its own values', () => {
    const own = `${URL_}&connection_limit=2&pool_timeout=30`;
    const p = params(pooledDatabaseUrl(own, { DATABASE_POOL_MAX: '8' }));
    expect(p.getAll('connection_limit')).toEqual(['2']);
    expect(p.getAll('pool_timeout')).toEqual(['30']);
  });

  it('keeps credentials and host intact', () => {
    const out = new URL(pooledDatabaseUrl(URL_, {})!);
    expect([out.username, out.password, out.host, out.pathname]).toEqual(['chat', 'pw', 'db.example:25060', '/jawwid']);
  });

  it.each(['0', '-1', '2.5', 'many', '51'])('refuses DATABASE_POOL_MAX=%s at startup', (v) => {
    expect(() => pooledDatabaseUrl(URL_, { DATABASE_POOL_MAX: v })).toThrow('DATABASE_POOL_MAX');
  });

  describe('statement timeout (DATABASE_STATEMENT_TIMEOUT_MS)', () => {
    it('API and worker sessions get -c statement_timeout=N in the URL options', () => {
      for (const role of ['api', 'worker'] as const) {
        expect(params(pooledDatabaseUrl(URL_, { DATABASE_STATEMENT_TIMEOUT_MS: '15000' }, role)).get('options')).toBe('-c statement_timeout=15000');
      }
    });

    it('unset or 0: no limit is added (a laptop, CI, or the escape hatch)', () => {
      expect(params(pooledDatabaseUrl(URL_, {})).has('options')).toBe(false);
      expect(params(pooledDatabaseUrl(URL_, { DATABASE_STATEMENT_TIMEOUT_MS: '0' })).has('options')).toBe(false);
      expect(statementTimeoutMs({})).toBe(0);
    });

    it("a URL that already carries options keeps the operator's own", () => {
      const own = `${URL_}&options=-c%20search_path%3Dchat`;
      expect(params(pooledDatabaseUrl(own, { DATABASE_STATEMENT_TIMEOUT_MS: '15000' })).getAll('options')).toEqual(['-c search_path=chat']);
    });

    it.each(['-1', '1.5', 'soon', '600001'])('refuses DATABASE_STATEMENT_TIMEOUT_MS=%s at startup', (v) => {
      expect(() => pooledDatabaseUrl(URL_, { DATABASE_STATEMENT_TIMEOUT_MS: v })).toThrow('DATABASE_STATEMENT_TIMEOUT_MS');
    });

    it('both deploy workflows set 15000', () => {
      for (const wf of ['deploy-staging.yml', 'deploy-production.yml']) {
        const text = readFileSync(`${__dirname}/../../../../../.github/workflows/${wf}`, 'utf8');
        expect([wf, /DATABASE_STATEMENT_TIMEOUT_MS: '(\d+)'/.exec(text)?.[1]]).toEqual([wf, '15000']);
      }
    });
  });

  describe("the 'cli' role", () => {
    it('a pool of 2 and NO statement timeout, whatever the API and worker get', () => {
      const env = { DATABASE_POOL_MAX: '7', DATABASE_WORKER_POOL_MAX: '3', DATABASE_STATEMENT_TIMEOUT_MS: '15000' };
      const p = params(pooledDatabaseUrl(URL_, env, 'cli'));
      expect(p.get('connection_limit')).toBe('2');
      expect(p.has('options')).toBe(false);
      expect(p.get('pool_timeout')).toBe('10');
    });

    it('cliPrismaClient opens the database through it', () => {
      const saved = { ...process.env };
      process.env.DATABASE_STATEMENT_TIMEOUT_MS = '15000';
      process.env.DATABASE_POOL_MAX = '7';
      try {
        const url = urlOf(cliPrismaClient(URL_));
        expect(params(url).get('connection_limit')).toBe('2');
        expect(params(url).has('options')).toBe(false);
      } finally {
        process.env = saved;
      }
    });
  });

  it('no DATABASE_URL: nothing is invented', () => {
    expect(pooledDatabaseUrl(undefined, {})).toBeUndefined();
  });
});

describe('PrismaService', () => {
  const saved = { url: process.env.DATABASE_URL, max: process.env.DATABASE_POOL_MAX };
  afterEach(() => {
    for (const [k, v] of [['DATABASE_URL', saved.url], ['DATABASE_POOL_MAX', saved.max]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });


  it('Nest builds it with the pooled URL (no constructor argument to inject)', async () => {
    process.env.DATABASE_URL = URL_;
    process.env.DATABASE_POOL_MAX = '7';
    const moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile();
    const prisma = moduleRef.get(PrismaService);
    expect(params(urlOf(prisma)).get('connection_limit')).toBe('7');
    expect(params(urlOf(prisma)).get('pool_timeout')).toBe('10');
  });

  it('in the worker (setDatabasePoolRole), Nest builds it with the worker pool', async () => {
    process.env.DATABASE_URL = URL_;
    process.env.DATABASE_POOL_MAX = '7';
    process.env.DATABASE_WORKER_POOL_MAX = '3';
    setDatabasePoolRole('worker');
    try {
      const prisma = (await Test.createTestingModule({ providers: [PrismaService] }).compile()).get(PrismaService);
      expect(params(urlOf(prisma)).get('connection_limit')).toBe('3');
    } finally {
      setDatabasePoolRole('api');
      delete process.env.DATABASE_WORKER_POOL_MAX;
    }
  });

  it('ActorScopedDatabase\'s second client (DATABASE_APP_URL) is pooled by the same budget, not left unbounded', () => {
    process.env.DATABASE_POOL_MAX = '7';
    const scoped = new ActorScopedDatabase({} as PrismaService, 'postgresql://chat_app:pw@db.example:25060/jawwid');
    const client = (scoped as unknown as { client: PrismaService }).client;
    expect(params(urlOf(client)).get('connection_limit')).toBe('7');
    expect(params(urlOf(client)).get('pool_timeout')).toBe('10');
  });

  it('a caller that names its own datasource keeps it', () => {
    process.env.DATABASE_URL = URL_;
    const own = 'postgresql://other:pw@elsewhere:5432/x';
    expect(urlOf(new PrismaService({ datasourceUrl: own }))).toBe(own);
  });
});
