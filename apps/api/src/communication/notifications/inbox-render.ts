import { TemplateService } from './template.service';

/** An unfilled {placeholder}. */
export const PLACEHOLDER = /\{\w+\}/;

/**
 * Which templates the Center tries for an entry, best first: its own in-app
 * text (names allowed, behind sign-in); then the lock-screen text of the same
 * notification (`inbox.<key>` -> `<key>`, which names nobody); then the
 * generic line, which has no placeholder at all.
 */
export function inboxCandidates(templateKey: string): string[] {
  const out = [templateKey];
  if (templateKey.startsWith('inbox.')) out.push(templateKey.slice('inbox.'.length));
  if (templateKey !== 'inbox.generic') out.push('inbox.generic');
  return out;
}

/**
 * The first candidate that renders COMPLETELY with these variables. The Center
 * never shows "{child}": an entry written before its template's variable
 * existed (PD-34 QA, 2026-10-27) reads as the next, plainer text instead. Null
 * only when no candidate exists at all.
 */
export function renderFirstComplete(
  candidates: ReadonlyArray<{ title: string; body: string } | null>,
  vars: Record<string, unknown>,
): { title: string; body: string } | null {
  let last: { title: string; body: string } | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const text = { title: TemplateService.interpolate(c.title, vars), body: TemplateService.interpolate(c.body, vars) };
    if (!PLACEHOLDER.test(text.title) && !PLACEHOLDER.test(text.body)) return text;
    last = text;
  }
  // Every candidate left a placeholder: strip what is left rather than show it.
  return last ? { title: last.title.replace(/\{\w+\}/g, '').trim(), body: last.body.replace(/\{\w+\}/g, '').trim() } : null;
}
