/**
 * LR-34: migration 20261117100000_chat_pd027_card_pause_seed.
 *
 * The deploy that first carries the live Stripe secrets must start with card payments paused, and an
 * administrator's own choice must survive every later migration run. This runs the migration's SQL
 * against the integration database in each state the key can be in:
 *
 *   absent            -> seeded true (the app reads it as paused)
 *   false (resumed)   -> untouched: the administrator's choice wins
 *   true  (paused)    -> untouched
 *   malformed         -> untouched (card-pause.ts fails safe to paused on its own)
 *   run twice         -> no change, one row, no other key written
 *
 * The spec restores whatever it found, so it cannot change another spec's starting state.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './harness';
import { PrismaService } from '@platform/prisma.service';
import { CARD_PAUSED_KEY, isCardPaused } from '../../src/billing/card-pause';

const SQL = readFileSync(join(__dirname, '../../../../supabase/migrations/20261117100000_chat_pd027_card_pause_seed.sql'), 'utf8');

const prisma = new PrismaService();

interface Row { value: unknown; scope: string; description: string | null; updatedAt: Date }
let saved: Row | null = null;

const run = () => prisma.$executeRawUnsafe(SQL);
// Raw SQL: the Prisma model has no `description` column, and this spec needs to see it.
const row = async (): Promise<Row | null> => {
  const r = await prisma.$queryRaw<Array<{ value: unknown; scope: string; description: string | null; updated_at: Date }>>`
    select value, scope, description, updated_at from chat.config where key = ${CARD_PAUSED_KEY}`;
  return r[0] ? { value: r[0].value, scope: r[0].scope, description: r[0].description, updatedAt: r[0].updated_at } : null;
};
const put = (value: unknown, description: string | null, updatedAt: Date) =>
  prisma.$executeRaw`
    insert into chat.config (key, value, scope, description, updated_at)
    values (${CARD_PAUSED_KEY}, ${JSON.stringify(value)}::jsonb, 'global', ${description}, ${updatedAt})`;
const countKeys = () => prisma.config.count();

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  saved = await row();
  await prisma.config.deleteMany({ where: { key: CARD_PAUSED_KEY } });
});

afterEach(async () => {
  await prisma.config.deleteMany({ where: { key: CARD_PAUSED_KEY } });
  if (saved) await put(saved.value, saved.description, saved.updatedAt);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('20261117100000: billing.card_paused is seeded true only when absent', () => {
  it('absent: inserts true, and the app reads card payments as paused', async () => {
    expect(await row()).toBeNull();
    await run();
    const r = await row();
    expect(r).toMatchObject({ value: true, scope: 'global' });
    expect(r?.description).toMatch(/paused until the super admin or Operations Manager resumes/);
    expect(await isCardPaused(prisma)).toBe(true);
  });

  it('an administrator who resumed cards (false) is never overwritten', async () => {
    const at = new Date('2026-11-01T10:00:00Z');
    await put(false, 'set by an admin', at);
    await run();
    expect(await row()).toMatchObject({ value: false, description: 'set by an admin', updatedAt: at });
    expect(await isCardPaused(prisma)).toBe(false);
  });

  it('an administrator pause (true) is left exactly as it is', async () => {
    const at = new Date('2026-11-02T10:00:00Z');
    await put(true, 'paused by an admin', at);
    await run();
    expect(await row()).toMatchObject({ value: true, description: 'paused by an admin', updatedAt: at });
  });

  it('a malformed existing value is not rewritten', async () => {
    await put('yes', null, new Date('2026-11-03T10:00:00Z'));
    await run();
    expect((await row())?.value).toBe('yes');
  });

  it('running it twice changes nothing and writes no other key', async () => {
    const before = await countKeys();
    await run();
    const first = await row();
    await run();
    const second = await row();
    expect(second).toEqual(first);
    expect(await countKeys()).toBe(before + 1);
    expect(await prisma.config.count({ where: { key: CARD_PAUSED_KEY } })).toBe(1);
  });

  it('after an administrator resumes cards, a later run keeps them resumed', async () => {
    await run();
    await prisma.config.update({ where: { key: CARD_PAUSED_KEY }, data: { value: false } });
    await run();
    expect(await isCardPaused(prisma)).toBe(false);
  });
});
