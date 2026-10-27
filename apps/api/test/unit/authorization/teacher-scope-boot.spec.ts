/**
 * PD-35 follow-up, item 4: the switch's boot mirroring is not last-boot-wins.
 * A process that boots WITHOUT TEACHER_SUPERVISOR_STRICT_SCOPE leaves the
 * database row as it is (and says so); only an explicit value is written, and
 * a change of the stored value is logged loudly.
 */
import { Logger } from '@nestjs/common';
import { TeacherScopeService } from '@platform/teacher-scope';

function fakePrisma(stored: boolean | null) {
  const writes: unknown[] = [];
  return {
    writes,
    prisma: {
      $executeRaw: async (...args: unknown[]) => {
        writes.push(args);
        return 1;
      },
      $queryRaw: async () => (stored === null ? [] : [{ strict: stored }]),
    },
  };
}

describe('TeacherScopeService boot mirroring', () => {
  const before = process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (before === undefined) delete process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
    else process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = before;
  });

  it('an unset variable writes nothing: the stored value stands', async () => {
    delete process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
    const f = fakePrisma(true);
    await new TeacherScopeService(f.prisma as never).onModuleInit();
    expect(f.writes).toHaveLength(0);
  });

  it('an explicit value is written, and turning the stored value over is a warning', async () => {
    process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = 'false';
    const f = fakePrisma(true);
    await new TeacherScopeService(f.prisma as never).onModuleInit();
    expect(f.writes).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('an explicit value equal to the stored one is written quietly', async () => {
    process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = 'true';
    const f = fakePrisma(true);
    await new TeacherScopeService(f.prisma as never).onModuleInit();
    expect(f.writes).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
