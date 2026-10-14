/**
 * GUARD: the transitional legacy read must shrink to nothing, never grow, and
 * never be reached by accident.
 *
 * AuthorizationService.canRead takes the pre-scope decision when called with
 * NO scope argument (or with UNSCOPED_LEGACY_READ), so call sites can move onto
 * resolved StaffScopeFacts one reviewed phase at a time (C2 conversations, C3
 * messages and approvals, C4 calls and realtime). This spec reads the actual
 * source and pins, by IDENTITY:
 *
 *   1. every legacy `.canRead(` call -- by file AND enclosing class member, not
 *      by a count, so migrating one site and adding another in the same file
 *      still fails;
 *   2. every scoped call (it must pass real facts, never the sentinel);
 *   3. no indirect use of canRead (`const f = x.canRead`, `x['canRead']`,
 *      `.canRead.call(`) that would hide a call from (1);
 *   4. the sentinel is named nowhere but AuthorizationService;
 *   5. canReadResolved -- whose decision carries the 404 of a foreign
 *      conversation -- is consumed only by ConversationService.requireReadable,
 *      the single throw path, so no caller can drop that status.
 *
 * A phase that migrates a call site edits LEGACY_SITES in the same diff, so the
 * shrinking is reviewed. C4 empties it, removes the no-scope signature and
 * deletes this guard together with the sentinel.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');

/** C1 baseline, 2026-10-14: 13 legacy call sites, each by file and enclosing member. */
const LEGACY_SITES = [
  'communication/approvals/approval.service.ts#history',
  'communication/calls/call.service.ts#callCapability',
  'communication/calls/call.service.ts#history',
  'communication/conversations/conversation.service.ts#listForActor',
  'communication/conversations/conversation.service.ts#readWithMembers',
  'communication/conversations/conversation.service.ts#setPreferences',
  'communication/messages/message.service.ts#list',
  'communication/messages/message.service.ts#loadForActor',
  'communication/messages/message.service.ts#markReadUpTo',
  'communication/realtime/realtime.gateway.ts#authorize',
  'communication/realtime/realtime.gateway.ts#deliverToConversationLocally',
  'platform/authorization.service.ts#canSend',
  'platform/authorization.service.ts#canStaffJoinCall',
];

/** Calls that pass resolved facts. */
const SCOPED_SITES = [
  'communication/conversations/conversation.service.ts#canReadResolved',
  'communication/conversations/conversation.service.ts#canReadResolved',
];

/** The only consumer of canReadResolved's decision. */
const CAN_READ_RESOLVED_CALLERS = ['communication/conversations/conversation.service.ts#requireReadable'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Comments replaced by spaces, so offsets are preserved and nothing commented counts. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length));
}

/** Top-level arguments of the call whose `(` is at `open`. */
function argumentsAt(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const last = text.slice(start, i).trim();
        if (last) args.push(last);
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error('unbalanced call');
}

const MEMBER = /^ {2}(?:(?:public|private|protected|static|async|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\(/gm;

/** The class member (two-space indented declaration) enclosing `index`. */
function enclosingMember(text: string, index: number): string {
  let name = '(top level)';
  for (const m of text.matchAll(MEMBER)) {
    if ((m.index ?? 0) > index) break;
    name = m[1];
  }
  return name;
}

interface Site {
  site: string;
  args: string[];
}

function callsOf(method: string): Site[] {
  const out: Site[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = code(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(new RegExp(`\\.${method}\\(`, 'g'))) {
      const open = (m.index ?? 0) + m[0].length - 1;
      out.push({
        site: `${relative(SRC, file)}#${enclosingMember(text, m.index ?? 0)}`,
        args: argumentsAt(text, open),
      });
    }
  }
  return out;
}

const isLegacy = (s: Site) => s.args.length < 4 || s.args[3] === 'UNSCOPED_LEGACY_READ';
const sorted = (xs: string[]) => [...xs].sort();

describe('legacy read guard', () => {
  it('the legacy canRead call sites are exactly the recorded ones, by file and member', () => {
    expect(sorted(callsOf('canRead').filter(isLegacy).map((s) => s.site))).toEqual(sorted(LEGACY_SITES));
  });

  it('every other canRead call passes resolved facts, and only from the recorded places', () => {
    const scoped = callsOf('canRead').filter((s) => !isLegacy(s));
    expect(sorted(scoped.map((s) => s.site))).toEqual(sorted(SCOPED_SITES));
    for (const s of scoped) expect(s.args[3]).toBe('facts');
  });

  it('canRead is never referenced indirectly (bound, aliased, bracketed)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = code(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/\bcanRead\b/g)) {
        const i = m.index ?? 0;
        const isCall = text[i - 1] === '.' && text[i + 'canRead'.length] === '(';
        const isDefinition =
          relative(SRC, file) === 'platform/authorization.service.ts' &&
          /^ {2}canRead\(/m.test(text.slice(text.lastIndexOf('\n', i) + 1, i + 'canRead('.length));
        if (!isCall && !isDefinition) offenders.push(`${relative(SRC, file)}@${i}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nothing outside AuthorizationService names the sentinel', () => {
    const naming = sourceFiles(SRC)
      .filter((f) => code(readFileSync(f, 'utf8')).includes('UNSCOPED_LEGACY_READ'))
      .map((f) => relative(SRC, f));
    expect(naming).toEqual(['platform/authorization.service.ts']);
  });

  it('canReadResolved is consumed only by requireReadable, the single throw path', () => {
    expect(sorted(callsOf('canReadResolved').map((s) => s.site))).toEqual(sorted(CAN_READ_RESOLVED_CALLERS));
  });

  it('the recorded legacy total only ever goes down (C1 baseline 13; C4 target 0)', () => {
    expect(LEGACY_SITES.length).toBeLessThanOrEqual(13);
  });
});
