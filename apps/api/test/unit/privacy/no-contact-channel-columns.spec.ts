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

/** Deliberate, privacy-reviewed exceptions. Empty by design. */
const ALLOWED: ReadonlyArray<string> = [];

/** Strip comments so prose about phone privacy is not mistaken for a column. */
function stripComments(src: string, kind: 'sql' | 'prisma'): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(kind === 'sql' ? /--.*$/gm : /\/\/.*$/gm, '');
  return s;
}

/**
 * Blank out quoted string LITERALS before matching (Phase 6).
 *
 * WHY THIS IS A NARROWING AND NOT A WEAKENING. The control this test guards is
 * "no entity carries a contact channel", and a contact channel is a COLUMN or a
 * FIELD. A column is never written inside quotes: `phone text not null` is a
 * declaration, `'phone_number'` is a value. The distinction is total, so
 * ignoring quoted text cannot hide a single declaration -- and the test at the
 * bottom of this file proves exactly that, on the four shapes that matter.
 *
 * What it stops hiding behind an ALLOWED entry: Phase 6's moderation vocabulary
 * has a CATEGORY called 'phone_number', because detecting a phone number in a
 * message is how the academy stops one being shared. Adding that string to
 * ALLOWED would have exempted every line containing it -- including a real
 * `phone_number text` column -- which is how a tripwire quietly stops working.
 * ALLOWED stays empty, as designed.
 *
 * `''` is SQL's escape for a quote inside a literal, so it is neutralised first
 * or the pairing goes wrong halfway through a migration and the rest of the
 * file stops being scanned at all.
 */
function stripStringLiterals(src: string): string {
  return src
    .replace(/''/g, '\u0000')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/\u0000/g, '');
}

function offendingLines(src: string, kind: 'sql' | 'prisma'): string[] {
  return stripComments(src, kind)
    .split('\n')
    .filter((l) => FORBIDDEN.test(stripStringLiterals(l)) && !ALLOWED.some((a) => l.includes(a)))
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
   * THE TRIPWIRE ITSELF IS TESTED (Phase 6).
   *
   * `stripStringLiterals` above made the match narrower, and a guard nobody
   * checks is a guard that has already stopped working. These are the shapes a
   * contact channel would actually arrive in; every one must still fire.
   */
  it('still catches a contact-channel declaration in every shape it could arrive in', () => {
    const declarations = [
      'phone text not null,',
      '  phone_number  text,',
      'add column if not exists mobile_number text,',
      'whatsapp   String?  @map("whatsapp")',
      'phoneNumber: string;',
      'alter table chat.contact add column telephone text;',
    ];
    for (const line of declarations) {
      expect({ line, caught: offendingLines(line, 'sql').length }).toEqual({ line, caught: 1 });
    }
  });

  it('does not fire on a quoted value, which is never a column', () => {
    // Phase 6's moderation category, and the prose beside it.
    const values = [
      "check (category in ('phone_number', 'email_address')),",
      "('Egyptian mobile number', 'phone_number', 'high', 'regex',",
      "'a phone number is a contact channel outside Jawwid'),",
    ];
    for (const line of values) {
      expect({ line, caught: offendingLines(line, 'sql').length }).toEqual({ line, caught: 0 });
    }
  });

  it('the client-facing DTO and event contracts expose no contact channel', () => {
    for (const rel of ['apps/api/src/communication/contracts/dto.ts',
                       'apps/api/src/communication/contracts/events.ts']) {
      expect({ rel, bad: offendingLines(readFileSync(join(REPO, rel), 'utf8'), 'prisma') })
        .toEqual({ rel, bad: [] });
    }
  });
});
