/**
 * PD-34 QA defect (Android smoke test on systest, 2026-10-27): the Notification
 * Center showed a literal "{child}". Entries written before PD-34 lacked the
 * variable its in-app template uses. The Center must NEVER show an unfilled
 * {placeholder}: it falls back to the lock-screen template (which names nobody)
 * and finally to the generic one.
 *
 * Checked against every template the migrations seed, with no variables and
 * with partial ones.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACEHOLDER, inboxCandidates, renderFirstComplete } from '../../../src/communication/notifications/inbox-render';

type Tpl = { title: string; body: string };

/** Every (key, locale) template the migrations insert, the latest file winning. */
function seededTemplates(): Map<string, Tpl> {
  const dir = join(__dirname, '../../../../../supabase/migrations');
  const out = new Map<string, Tpl>();
  const row = /\(\s*'([a-z_.]+)',\s*'(ar|en)',\s*(?:\d+,\s*)?'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\s*\)/g;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(row)) {
      out.set(`${m[1]}|${m[2]}`, { title: m[3]!.replace(/''/g, "'"), body: m[4]!.replace(/''/g, "'") });
    }
  }
  return out;
}

const templates = seededTemplates();
const lookup = (key: string, locale: string) => templates.get(`${key}|${locale}`) ?? null;
const inboxKeys = [...new Set([...templates.keys()].map((k) => k.split('|')[0]!).filter((k) => k.startsWith('inbox.')))];

describe('the Center never shows an unfilled {placeholder}', () => {
  it('finds the seeded in-app templates (the parser works)', () => {
    expect(inboxKeys).toEqual(expect.arrayContaining(['inbox.lesson_reminder_soon', 'inbox.payment_reminder', 'inbox.generic']));
  });

  it('the last resort, inbox.generic, has no placeholder in either language', () => {
    for (const locale of ['ar', 'en']) {
      const g = lookup('inbox.generic', locale)!;
      expect(PLACEHOLDER.test(g.title) || PLACEHOLDER.test(g.body)).toBe(false);
    }
  });

  it.each(inboxKeys.flatMap((k) => ['ar', 'en'].map((l) => [k, l] as const)))(
    '%s (%s) with no variables, and with each one alone, renders with no "{"',
    (key, locale) => {
      const own = lookup(key, locale);
      const names = own ? [...`${own.title} ${own.body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!) : [];
      const partials: Array<Record<string, unknown>> = [{}, ...names.map((n) => ({ [n]: 'x' }))];
      for (const vars of partials) {
        const text = renderFirstComplete(inboxCandidates(key).map((k) => lookup(k, locale)), vars);
        expect(text).not.toBeNull();
        expect(`${text!.title} ${text!.body}`).not.toMatch(/\{/);
      }
    },
  );

  it('a lesson reminder without {child} falls back to the lock-screen text, which keeps the time', () => {
    const text = renderFirstComplete(inboxCandidates('inbox.lesson_reminder_soon').map((k) => lookup(k, 'en')), { time: '17:00' });
    expect(text!.body).toContain('17:00');
    expect(text!.body).not.toMatch(/\{/);
  });

  it('with every variable it needs, the in-app text itself is used', () => {
    const text = renderFirstComplete(inboxCandidates('inbox.lesson_reminder_soon').map((k) => lookup(k, 'en')), { child: 'learner_m', time: '17:00' });
    expect(text!.body).toContain('learner_m');
  });
});
