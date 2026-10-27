/**
 * PD-35 follow-up, review of #147:
 *   R3 a re-seat that fails for one conversation retries THAT conversation only,
 *      with backoff, and says so once -- not the whole set every sweep;
 *   R5 a boot that turns the switch over re-seats at once, before the first
 *      sweep.
 */
import { Logger } from '@nestjs/common';
import { TeacherScopeService } from '@platform/teacher-scope';
import { TeacherSupervisorService } from '../../../src/teacher-supervisors/teacher-supervisor.service';

type Row = { id: string; type: string };

function harness(opts: { strict: boolean; marker: string | null; rows: Row[]; failing: Set<string> }) {
  const state = { marker: opts.marker };
  const resynced: string[] = [];
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('AS reseated')) return [{ strict: opts.strict, reseated: state.marker ?? 'false' }];
      if (sql.includes('FROM chat.conversation c')) {
        // The database narrows to `only` (the second parameter) when given.
        const only = values[1] as string[] | null;
        return only ? opts.rows.filter((r) => only.includes(r.id)) : opts.rows;
      }
      return [];
    },
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      state.marker = String(values[1]);
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
  const resync = async (_tx: unknown, id: string) => {
    resynced.push(id);
    if (opts.failing.has(id)) throw new Error(`boom ${id}`);
    return { added: [], removed: [] };
  };
  const service = new TeacherSupervisorService(
    prisma as never,
    {} as never,
    {} as never,
    { strict: async () => opts.strict, changedAtBoot: false } as never,
    { resyncStaffInTx: resync } as never,
    { resyncStaffInTx: resync } as never,
    {} as never,
  );
  return { service, state, resynced };
}

describe('teacher supervisor re-seat retry', () => {
  let error: jest.SpyInstance;
  let now = 1_000_000;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('retries only the conversation that failed, with backoff, and logs the failure once', async () => {
    const failing = new Set(['b']);
    const h = harness({
      strict: true,
      marker: 'false',
      rows: [{ id: 'a', type: 'teacher_supervision' }, { id: 'b', type: 'trial_group' }],
      failing,
    });
    await h.service.reseatIfChanged();
    expect(h.resynced).toEqual(['a', 'b']);
    expect(h.state.marker).not.toBe('true');
    const logged = error.mock.calls.length;
    expect(logged).toBeGreaterThan(0);

    // The next sweep, a minute later: not due yet, nothing re-run.
    h.resynced.length = 0;
    now += 1_000;
    await h.service.reseatIfChanged();
    expect(h.resynced).toEqual([]);

    // Due: only b, and the same failure is not logged again.
    now += 10 * 60_000;
    await h.service.reseatIfChanged();
    expect(h.resynced).toEqual(['b']);
    expect(error.mock.calls.length).toBe(logged);

    // b recovers: the re-seat is complete, and its marker is written.
    failing.clear();
    h.resynced.length = 0;
    now += 60 * 60_000;
    await h.service.reseatIfChanged();
    expect(h.resynced).toEqual(['b']);
    expect(h.state.marker).toBe('true');
  });

  it('a boot that turns the switch over re-seats at once', async () => {
    const h = harness({ strict: true, marker: 'false', rows: [{ id: 'a', type: 'teacher_supervision' }], failing: new Set() });
    (h.service as unknown as { scope: { changedAtBoot: boolean } }).scope.changedAtBoot = true;
    await h.service.onApplicationBootstrap();
    expect(h.resynced).toEqual(['a']);
    expect(h.state.marker).toBe('true');
  });

  it('the scope service says when a boot changed the stored switch', async () => {
    const before = process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
    process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = 'true';
    try {
      const prisma = { $executeRaw: async () => 1, $queryRaw: async () => [{ strict: false }] };
      const scope = new TeacherScopeService(prisma as never);
      await scope.onModuleInit();
      expect(scope.changedAtBoot).toBe(true);
    } finally {
      if (before === undefined) delete process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
      else process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = before;
    }
  });
});
