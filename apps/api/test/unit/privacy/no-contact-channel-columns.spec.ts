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

function offendingLines(src: string, kind: 'sql' | 'prisma'): string[] {
  return stripComments(src, kind)
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

  it('the client-facing DTO and event contracts expose no contact channel', () => {
    for (const rel of ['apps/api/src/communication/contracts/dto.ts',
                       'apps/api/src/communication/contracts/events.ts']) {
      expect({ rel, bad: offendingLines(readFileSync(join(REPO, rel), 'utf8'), 'prisma') })
        .toEqual({ rel, bad: [] });
    }
  });
});
