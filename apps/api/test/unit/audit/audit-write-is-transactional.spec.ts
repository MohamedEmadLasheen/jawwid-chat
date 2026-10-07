/**
 * Structural guard: every audit write happens on the caller's TRANSACTION.
 *
 * ## Why this is a source guard and not a behavioural test
 *
 * `AuditService.audit(tx, …)` takes the transaction client, so an audit row
 * shares the fate of the mutation that wrote it. Pass `this.prisma` instead and
 * the row is committed immediately, on its own -- which means a mutation that
 * later fails leaves an audit record claiming something happened that did not.
 *
 * That bug is invisible to a black-box test, and this file exists because a
 * mutation test proved it: replacing `audit(tx, …)` with `audit(this.prisma, …)`
 * inside `TeacherProfileService.decideCertificate` left ALL 77 integration tests
 * green. The reason is structural -- in these services nothing can fail AFTER
 * the audit write (the last statement is a `findUniqueOrThrow` on a row the
 * mutation itself just guaranteed), so a non-transactional write has no
 * observable consequence to assert on.
 *
 * Two honest options follow from that: leave the coupling uncovered, or assert
 * it where it is actually expressed -- at the call site. This file does the
 * latter, in the same spirit as `no-contact-channel-columns.spec.ts`: a tripwire
 * that fails the build when a control that currently holds BY CONSTRUCTION is
 * removed by accident.
 *
 * `teacher-profile.spec.ts` covers the other half -- that the real
 * `PrismaAuditService` genuinely rolls back with its transaction.
 *
 * If a deliberate non-transactional audit write ever becomes necessary, add it
 * to ALLOWED with a written justification, and say in the same change what
 * happens to the row when the surrounding work fails.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');

/** Deliberate, reviewed exceptions. Empty by design. */
const ALLOWED: ReadonlyArray<string> = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Strip comments, so prose about `this.prisma` is not read as a call site. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Every `.audit(` / `.event(` call, with the identifier it was handed first.
 *
 * Deliberately a regex over source rather than a TypeScript AST walk: the
 * property is one argument in one position, the repository has no AST tooling in
 * its test dependencies, and a guard nobody can read is a guard nobody
 * maintains.
 */
function auditCallSites(src: string): { call: string; firstArg: string }[] {
  const pattern = /\.(audit|event)\(\s*([A-Za-z_$][\w.$]*)/g;
  const found: { call: string; firstArg: string }[] = [];
  for (const match of src.matchAll(pattern)) {
    found.push({ call: match[1], firstArg: match[2] });
  }
  return found;
}

describe('every audit write is handed a transaction', () => {
  const files = sourceFiles(SRC).filter((f) => !ALLOWED.some((a) => f.endsWith(a)));

  it('finds the call sites it is meant to be guarding', () => {
    // A guard that silently matches nothing is worse than no guard: it reports
    // PASS forever. This asserts the regex still sees real call sites.
    const total = files
      .map((f) => auditCallSites(stripComments(readFileSync(f, 'utf8'))).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(8);
  });

  it('passes `tx` and never a long-lived client', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const site of auditCallSites(src)) {
        // `tx` is the transaction client every service threads through. Anything
        // else -- `this.prisma`, a module-level client, a captured variable --
        // escapes the transaction.
        if (site.firstArg !== 'tx') {
          offenders.push(`${file.replace(SRC, 'src')}: .${site.call}(${site.firstArg}, …)`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the teacher profile service audits every write it performs', () => {
    // Named explicitly because V1 shipped with NO certificate audit records and
    // nothing noticed. These are the actions whose absence was the original bug.
    const src = readFileSync(
      join(SRC, 'communication', 'teacher-profile', 'teacher-profile.service.ts'),
      'utf8',
    );

    for (const action of [
      'teacher_profile.certificate_added',
      'teacher_profile.certificate_edited',
      'teacher_profile.certificate_removed',
      'teacher_profile.certificate_approved',
      'teacher_profile.certificate_rejected',
    ]) {
      expect(src).toContain(`'${action}'`);
    }

    // And each of them on the transaction.
    const sites = auditCallSites(stripComments(src));
    expect(sites.length).toBeGreaterThanOrEqual(8);
    expect(sites.every((s) => s.firstArg === 'tx')).toBe(true);
  });
});
