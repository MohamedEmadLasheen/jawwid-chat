/**
 * PD-41 "Their manager" (owner decision 2026-10-29): migration 20261030010000
 * replaces two functions. Each must be its earlier body word for word, apart
 * from the one branch the decision changes -- so nothing else they enforce
 * (the state machine, the actor rules, owner safeguards 1-7, PD-47's step
 * routing) can have drifted in the copy:
 *
 *   chat.guard_appreciation_certificate   (20261029110000)  the approval condition
 *   chat.work_task_certificate_assignee   (20261029235900)  who reviews a self-uploaded design
 *
 * Pure: reads the migration files, no database. The behaviour is proved by
 * test/integration/pd041-certificates.spec.ts ("Their manager").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations');
const REPLACEMENT = '20261030010000_chat_pd041_overseer_approval.sql';
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');

/** The text of `create or replace function <signature>` up to its closing `$$;`. */
export function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(`create or replace function ${signature}`);
  if (start < 0) throw new Error(`${signature} is not defined here`);
  const end = sql.indexOf('$$;', sql.indexOf('as $$', start) + 5);
  return sql.slice(start, end + 3);
}

interface Replaced {
  signature: string;
  original: string;
  before: string;
  after: string;
}

const REPLACED: readonly Replaced[] = [
  {
    signature: 'chat.guard_appreciation_certificate()',
    original: '20261029110000_chat_pd041_certificates.sql',
    before: `      if not chat.certificate_responsible(actor, new.id)
         or not chat.staff_has_permission(actor, chat.certificate_request_key(new.category)) then
        raise exception 'only the requester of record does this' using errcode = 'insufficient_privilege';`,
    after: `      if not (chat.certificate_responsible(actor, new.id)
              -- PD-41 "Their manager" (owner, 2026-10-29): when the requester uploaded the design
              -- themself and nobody else answers for it, the category's overseer approves.
              or (a = 'approved' and chat.staff_has_permission(actor, 'certificates.oversee')
                  and chat.certificate_overseer_approves(new.id)))
         or not chat.staff_has_permission(actor, chat.certificate_request_key(new.category)) then
        raise exception 'only the requester of record does this' using errcode = 'insufficient_privilege';`,
  },
  {
    signature: 'chat.work_task_certificate_assignee(p_certificate uuid)',
    original: '20261029235900_chat_pd047_phase_b_handovers.sql',
    before: `      -- PD-41: whoever uploaded a design never approves it. A requester who
      -- uploaded it themselves is reviewed by their active PD-33 cover, who
      -- acts as them (chat.certificate_acts_as). With none, it stays theirs:
      -- PD-41 then allows only a redesign or a cancel.
      select f.uploaded_by into v_uploader from chat.appreciation_certificate_file f where f.id = c.current_file_id;
      if v_uploader is not distinct from v_req then
        return coalesce(`,
    after: `      -- PD-41: whoever uploaded a design never approves it. A requester who
      -- uploaded it themselves is reviewed by their active PD-33 cover, who
      -- acts as them (chat.certificate_acts_as). With none, PD-41 "Their
      -- manager" (owner, 2026-10-29): the category's overseer reviews it.
      select f.uploaded_by into v_uploader from chat.appreciation_certificate_file f where f.id = c.current_file_id;
      if v_uploader is not distinct from v_req then
        if chat.certificate_overseer_approves(c.id) then
          -- An overseer who uploaded it themself does not review it either: the super admin does.
          return coalesce(nullif(v_overseer, v_uploader), nullif(chat.work_task_super_admin(c.organization_id), v_uploader), v_req);
        end if;
        return coalesce(`,
  },
];

describe('PD-41 "Their manager": each replaced function is its original apart from one branch', () => {
  const replacement = read(REPLACEMENT);

  describe.each(REPLACED)('$signature', ({ signature, original, before, after }) => {
    const was = functionBody(read(original), signature);
    const now = functionBody(replacement, signature);

    it('the original has the branch exactly once', () => {
      expect(was.split(before)).toHaveLength(2);
    });

    it('the replacement is the original with only that branch changed', () => {
      expect(now).toBe(was.replace(before, after));
    });

    it('no later migration defines it again (this is the body that runs)', () => {
      const later = readdirSync(MIGRATIONS)
        .filter((f) => f > REPLACEMENT && f.endsWith('.sql'))
        .filter((f) => read(f).includes(`function ${signature.split('(')[0]}(`));
      expect(later).toEqual([]);
    });
  });

  it('the guard widens an approval only, by an overseer, in the case the database decides; four eyes stays', () => {
    const [guard] = REPLACED;
    expect(guard!.after).toContain("a = 'approved'");
    expect(guard!.after).toContain("'certificates.oversee'");
    expect(guard!.after).toContain('chat.certificate_overseer_approves(new.id)');
    const now = functionBody(replacement, guard!.signature);
    expect(now).toContain("raise exception 'the person who uploaded a design does not approve it'");
  });

  it('the proof can fail: one changed word elsewhere is caught', () => {
    const [guard] = REPLACED;
    const was = functionBody(read(guard!.original), guard!.signature);
    const drifted = functionBody(replacement, guard!.signature).replace("'a certificate is sent once'", "'a certificate is sent'");
    expect(drifted).not.toBe(was.replace(guard!.before, guard!.after));
  });
});
