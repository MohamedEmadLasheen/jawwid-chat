/**
 * Normalizing the free text a staff member writes about themselves.
 *
 * These fields are stored and returned as PLAIN TEXT. No client renders them as
 * HTML or Markdown, so markup is not "sanitized away" here -- it is simply text,
 * and `<script>` displays as the eight characters it is. What this file removes
 * is what plain text can still abuse:
 *
 *   - C0/C1 control characters (other than a newline in the introduction),
 *     which have no meaning in a profile and can corrupt logs and exports;
 *   - Unicode bidirectional EMBEDDING / OVERRIDE / ISOLATE controls
 *     (U+202A-U+202E, U+2066-U+2069). In an Arabic/English UI an override can
 *     make a title render as something other than what is stored. The plain
 *     marks U+200E/U+200F are kept: mixed-direction text legitimately uses them.
 *
 * Arabic and English are both ordinary text here; nothing is transliterated,
 * case-folded or truncated silently. A value over the limit is REFUSED, not cut,
 * so a save never quietly loses the end of what someone wrote.
 */

export const JOB_TITLE_MAX = 80;
export const ABOUT_MAX = 1500;
export const DISPLAY_NAME_MAX = 80;
export const SCOPE_NOTE_MAX = 280;
export const REASON_MAX = 280;

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
// eslint-disable-next-line no-control-regex
const CONTROLS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-control-regex
const ALL_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

export type TextVerdict =
  | { ok: true; value: string | null }
  | { ok: false; problem: 'too_long' | 'not_text' | 'required' };

/**
 * A single-line field (job title, display name, scope note, reason).
 * Empty after trimming means "clear it" when `required` is false.
 */
export function normalizeLine(raw: unknown, max: number, required = false): TextVerdict {
  if (raw === null || raw === undefined) return required ? { ok: false, problem: 'required' } : { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, problem: 'not_text' };
  const value = raw
    .normalize('NFC')
    .replace(BIDI_CONTROLS, '')
    .replace(ALL_CONTROLS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (value.length === 0) return required ? { ok: false, problem: 'required' } : { ok: true, value: null };
  if ([...value].length > max) return { ok: false, problem: 'too_long' };
  return { ok: true, value };
}

/**
 * The introduction: paragraphs allowed, so newlines survive (CRLF folded to LF,
 * runs of blank lines capped at one). Trailing spaces on each line go.
 */
export function normalizeParagraphs(raw: unknown, max: number): TextVerdict {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, problem: 'not_text' };
  const value = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(BIDI_CONTROLS, '')
    .replace(/\t/g, ' ')
    .replace(CONTROLS_EXCEPT_NEWLINE, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (value.length === 0) return { ok: true, value: null };
  if ([...value].length > max) return { ok: false, problem: 'too_long' };
  return { ok: true, value };
}
