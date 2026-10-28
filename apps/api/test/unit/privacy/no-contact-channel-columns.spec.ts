/**
 * QA (AI #5) — structural guard for the phone-privacy control (PP-13, gate G-07).
 *
 * Phone privacy in Jawwid Chat is currently enforced BY CONSTRUCTION: no actor
 * or communication entity carries a phone number, so the communication engine
 * has no code path that can obtain one, and a number cannot leak through a
 * message, thread payload, realtime event, push notification or call metadata.
 *
 * That is the strongest form of the control, and it is also the easiest to lose
 * by accident — one innocuous `phone String?` restores the entire class of leak
 * across every surface at once.
 *
 * This test fails the build if such a column appears. It is NOT a ban on ever
 * modelling a contact channel; it is a tripwire that forces the decision to be
 * deliberate and privacy-reviewed rather than incidental.
 *
 * If a channel field genuinely becomes necessary: add it to ALLOWED below with
 * a written justification, and add the corresponding redaction tests for API
 * responses, realtime events, push payloads, call metadata, logs, search and
 * exports (test-plan.md §14) in the same change.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..', '..');

/** Identifiers that would reintroduce a personal contact channel. */
const FORBIDDEN = /\b(phone|phone_number|phoneNumber|msisdn|mobile_number|mobileNumber|whatsapp|telephone|tel_number)\b/i;

/**
 * Deliberate, privacy-reviewed exceptions. Each names ONE declaration exactly.
 *
 * PD-10 (closed 2026-10-18): a teacher's phone lives in the administration-only
 * Teacher File. The structure this guard protects still holds, because the
 * communication engine cannot read that table: no request role has a grant on
 * it, and teacher-file-confinement.spec.ts fails the build if any source
 * outside src/teacher-file names it. The redaction proof for every surface
 * listed above is that confinement: the engine never holds the value.
 */
const ALLOWED: ReadonlyArray<string> = [
  'phone text constraint teacher_file_phone_is_admin_only check',
  'adminOnlyPhone String?   @map("phone")',
  // Trial journey (owner decision 2026-10-20): Sales' subscription form keeps
  // the parent's phone for the New Students page. Same structure as the Teacher
  // File: no request-role grant on chat.trial_subscription, and
  // new-students-confinement.spec.ts fails the build if any source outside
  // src/new-students names the table, its model or this field.
  'phone            text not null constraint trial_subscription_phone_is_confined check',
  'confinedParentPhone String    @map("phone")',
  // PD-17 (owner decision 2026-10-21): the Parent Profile shows the parent's
  // phone to the administration only. Same structure again: no request-role
  // grant on chat.parent_file, and parent-file-confinement.spec.ts fails the
  // build if any source outside src/parent-profile names the table, its model
  // or these fields. The audit trail names changed fields, never their values.
  'phone text constraint parent_file_phone_is_admin_only check',
  'adminOnlyParentPhone String?  @map("phone")',
  // ...and its one-time backfill, which copies the phone Sales typed for a
  // family already enrolled (PD-16) from one confined table to the other.
  // Nothing outside the two confined tables is read or written.
  'insert into chat.parent_file (contact_id, organization_id, phone, email)',
  'select e.contact_id, e.organization_id, btrim(t.phone), lower(btrim(t.email))',
  // PD-43 (adding a teacher): chat.create_teacher writes the phone the Teachers
  // department typed into the same admin-only Teacher File (PD-10 above), and
  // compares its digits to refuse a contact already on another teacher's file,
  // and compares the stored phone when a request is replayed (same adder, same
  // arguments, PD-43 review P1).
  // No new column. The writer is server-only (revoked from public, no
  // request-role grant), returns only the teacher id, never puts the phone in
  // an error, and audits `hasPhone`, never the number.
  'insert into chat.teacher_file (teacher_id, organization_id, phone, email, joined_on, teaching_market, updated_by)',
  'or (v_digits is not null and regexp_replace(coalesce(f.phone,   ),         ,   ,    ) = v_digits))) then',
  'and f.phone is not distinct from v_phone',
  // PD-43 PR-1b (the set-up checklist): chat.teacher_setup_state asks only
  // whether the admin-only Teacher File holds a phone or an e-mail. It returns
  // a boolean, never the value; server-only like the writer above.
  'exists (select 1 from chat.teacher_file f where f.teacher_id = t.id and num_nonnulls(f.phone, f.email) > 0),',
];

/** Strip comments so prose about phone privacy is not mistaken for a column. */
function stripComments(src: string, kind: 'sql' | 'prisma'): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(kind === 'sql' ? /--.*$/gm : /\/\/.*$/gm, '');
  return s;
}

/**
 * Blank out everything in SQL that is prose rather than schema: line comments,
 * block comments, and single-quoted string literals.
 *
 * This is a single left-to-right pass rather than a sequence of regexes because
 * the three constructs nest, and this schema contains every awkward case:
 *
 *   'Chat''s identity provider -- never a phone number, ...'   (literal holding
 *      a doubled-quote escape AND a `--`), and
 *   -- ... no foreign key into any other product's tables       (a comment
 *      holding a lone apostrophe).
 *
 * Strip comments first and the `--` inside that literal eats the rest of the
 * line. Strip literals first and the apostrophe in that comment opens a literal
 * that swallows real declarations until the next quote — a FALSE NEGATIVE, which
 * for a privacy tripwire is the dangerous direction. Only reading left to right,
 * as Postgres lexes it, gets both right.
 *
 * Double-quoted identifiers are deliberately NOT stripped: `"phone" text` is a
 * column declaration and must still fail.
 *
 * Newlines are preserved so offending lines are still reported verbatim.
 */
function stripSqlProse(src: string): string {
  let out = '';
  let i = 0;
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ');

  while (i < src.length) {
    // -- line comment
    if (src.startsWith('--', i)) {
      while (i < src.length && src[i] !== '\n') out += ' ', i++;
      continue;
    }
    // /* block comment */
    if (src.startsWith('/*', i)) {
      out += '  ';
      i += 2;
      while (i < src.length && !src.startsWith('*/', i)) out += blank(src[i]), i++;
      out += i < src.length ? '  ' : '';
      i += 2;
      continue;
    }
    // 'string literal', where '' is an escaped quote
    if (src[i] === "'") {
      out += ' ';
      i++;
      while (i < src.length) {
        if (src.startsWith("''", i)) {
          out += '  ';
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          out += ' ';
          i++;
          break;
        }
        out += blank(src[i]);
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

function offendingLines(src: string, kind: 'sql' | 'prisma'): string[] {
  const code = kind === 'sql' ? stripSqlProse(src) : stripComments(src, kind);
  return code
    .split('\n')
    .filter((l) => FORBIDDEN.test(l) && !ALLOWED.some((a) => l.includes(a)))
    .map((l) => l.trim());
}

describe('phone privacy is enforced structurally (G-07 / PP-13)', () => {
  it('the Prisma schema declares no contact-channel field', () => {
    const src = readFileSync(join(REPO, 'apps/api/prisma/schema.prisma'), 'utf8');
    expect(offendingLines(src, 'prisma')).toEqual([]);
  });

  it('no SQL migration declares a contact-channel column', () => {
    const dir = join(REPO, 'supabase/migrations');
    const offenders: Record<string, string[]> = {};
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const bad = offendingLines(readFileSync(join(dir, f), 'utf8'), 'sql');
      if (bad.length) offenders[f] = bad;
    }
    expect(offenders).toEqual({});
  });

  it('the Actor seam exposes no contact channel', () => {
    const src = readFileSync(join(REPO, 'apps/api/src/platform/types.ts'), 'utf8');
    expect(offendingLines(src, 'prisma')).toEqual([]);
  });

  /**
   * The guard has to tell a column apart from a sentence about columns, and it
   * had that backwards: `comment on column ... is '... never a phone number ...'`
   * is a SQL *statement*, not a SQL comment, so the prose survived stripping and
   * failed the build. The schema was innocent.
   *
   * Both directions are asserted, because a tripwire that cannot fire is worth
   * no more than one that fires at everything. The declarations below are the
   * shapes this guard exists to catch.
   */
  describe('prose is not a declaration, and a declaration is not prose', () => {
    const prose: ReadonlyArray<[string, string]> = [
      [
        'the COMMENT ON statement that actually broke the build',
        `comment on column chat.device.name is\n` +
          `  'A human label such as "iPhone". Never a phone number, and never derived '\n` +
          `  'from one (BR-2).';`,
      ],
      [
        'a literal carrying both a doubled-quote escape and a -- marker',
        `comment on table chat.account is\n` +
          `  'Chat''s identity provider -- never a phone number, an email address or any '\n` +
          `  'other contact channel.';`,
      ],
      [
        'a line comment describing the privacy rule',
        '-- chat.account deliberately holds NO contact channel: no phone, no email.',
      ],
      [
        'a block comment describing the privacy rule',
        '/* PHONE PRIVACY: no table here has a phone or msisdn column. */',
      ],
      [
        'a comment holding a lone apostrophe, followed by real schema',
        `-- no foreign key into any other product's tables\ncreate table chat.t (id uuid primary key);`,
      ],
    ];

    it.each(prose)('allows %s', (_label, sql) => {
      expect(offendingLines(sql, 'sql')).toEqual([]);
    });

    const declarations: ReadonlyArray<[string, string]> = [
      ['a bare phone column', 'create table chat.contact (phone text);'],
      ['a phone_number column', '  phone_number varchar(32) not null,'],
      ['an added msisdn column', 'alter table chat.actor add column msisdn text;'],
      ['a camelCase mobileNumber column', '  mobileNumber text,'],
      ['a whatsapp handle column', '  whatsapp text,'],
      ['a double-quoted identifier', '  "phone" text not null,'],
      [
        'a declaration on the line after a comment holding an apostrophe',
        `-- the token's sub claim lives elsewhere\n  telephone text,`,
      ],
      [
        'a declaration following a COMMENT ON statement',
        `comment on table chat.device is 'A device. Never a contact channel.';\n` +
          `alter table chat.device add column phone text;`,
      ],
    ];

    it.each(declarations)('still fails the build on %s', (_label, sql) => {
      expect(offendingLines(sql, 'sql')).not.toEqual([]);
    });
  });

  it('the client-facing DTO and event contracts expose no contact channel', () => {
    for (const rel of ['apps/api/src/communication/contracts/dto.ts',
                       'apps/api/src/communication/contracts/events.ts']) {
      expect({ rel, bad: offendingLines(readFileSync(join(REPO, rel), 'utf8'), 'prisma') })
        .toEqual({ rel, bad: [] });
    }
  });
});
