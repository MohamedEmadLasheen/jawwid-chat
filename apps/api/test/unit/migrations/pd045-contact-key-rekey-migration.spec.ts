/**
 * PD-45 (review of #294): a contact key the family gained only because its
 * COUNTRY made a stored local number read as another number ("050 765 3333"
 * is +971... in the UAE, +20... in Egypt) is superseded by the next country
 * change -- so a country chosen by mistake does not leave a key that blocks a
 * stranger forever. Every other key (intake, Assign, the backfill, a recorded
 * number) is never removed while its family exists, as PD-42 S1 decided.
 *
 * Read as text; the behaviour is proven in test/integration/pd017-profiles.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const sql = read('supabase/migrations/20261030050000_chat_pd045_contact_key_rekey.sql');
const flat = sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

describe('PD-45: re-keyed contact keys', () => {
  it('is the slot the department head assigned', () => {
    const claim = read('docs/product/migration-slots/20261030050000.md');
    expect(claim).toMatch(/^pd: PD-45$/m);
    expect(claim).toMatch(/^migration: chat_pd045_contact_key_rekey$/m);
  });

  it('records where each key came from: every existing one is a recorded value', () => {
    expect(flat).toMatch(/alter table chat\.family_contact_key add column source text not null default 'record'/);
    expect(flat).toMatch(/check \(source in \('record', 'rekey'\)\)/);
    expect(flat).toMatch(/check \(source = 'record' or kind = 'phone'\)/);
  });

  it('lets a re-keyed key go only inside the family\'s own country change; any other key stays while the family exists', () => {
    const fn = flat.slice(flat.indexOf('create or replace function chat.guard_family_contact_key()'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(
      /if old\.source = 'rekey' and current_setting\('chat\.rekeying_family', true\) = old\.family_id::text then return old;/,
    );
    expect(body).toContain('a contact key is never removed while its family exists');
    expect(body).toContain('a contact key never changes');
    expect(body).toContain('this parent is already in chat');
  });

  it('waits at most five seconds for the table\'s lock', () => {
    expect(flat.indexOf("set local lock_timeout = '5s'")).toBeLessThan(flat.indexOf('alter table chat.family_contact_key'));
  });

  it('is known to Prisma', () => {
    expect(read('apps/api/prisma/schema.prisma')).toMatch(/model FamilyContactKey \{[\s\S]*?source\s+String\s+@default\("record"\)[\s\S]*?\n\}/);
  });
});
