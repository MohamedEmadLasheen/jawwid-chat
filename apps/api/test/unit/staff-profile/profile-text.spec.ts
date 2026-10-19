/**
 * Profile text is stored and rendered as PLAIN TEXT. These tests pin what the
 * normalizer removes (controls, bidi overrides), what it keeps (Arabic, newlines
 * in the introduction, markup characters as characters), and that an over-long
 * value is refused rather than silently cut.
 */
import { ABOUT_MAX, JOB_TITLE_MAX, normalizeLine, normalizeParagraphs } from '../../../src/staff-profile/profile-text';

const BS = String.fromCharCode(92);
const ch = (code: number) => String.fromCharCode(code);

describe('normalizeLine (job title, name, notes)', () => {
  it('keeps Arabic and mixed text, trims and collapses whitespace', () => {
    expect(normalizeLine('  مشرفة   متابعة  الأسر ', JOB_TITLE_MAX)).toEqual({ ok: true, value: 'مشرفة متابعة الأسر' });
    expect(normalizeLine('Family Follow-up — مشرف', JOB_TITLE_MAX)).toEqual({ ok: true, value: 'Family Follow-up — مشرف' });
  });

  it('keeps markup as literal text: nothing renders it, so nothing needs to strip it', () => {
    expect(normalizeLine('<script>alert(1)</script>', JOB_TITLE_MAX)).toEqual({ ok: true, value: '<script>alert(1)</script>' });
  });

  it('removes control characters and bidi overrides, keeps the plain direction marks', () => {
    const value = `Lead${ch(0x202e)}gnp.exe${ch(0)} ${ch(0x200f)}x`;
    expect(normalizeLine(value, JOB_TITLE_MAX)).toEqual({ ok: true, value: `Leadgnp.exe ${ch(0x200f)}x` });
    expect(normalizeLine(`a${ch(10)}b`, JOB_TITLE_MAX)).toEqual({ ok: true, value: 'a b' });
  });

  it('refuses over-long input instead of truncating it, and refuses non-text', () => {
    expect(normalizeLine('x'.repeat(JOB_TITLE_MAX + 1), JOB_TITLE_MAX)).toEqual({ ok: false, problem: 'too_long' });
    expect(normalizeLine('x'.repeat(JOB_TITLE_MAX), JOB_TITLE_MAX).ok).toBe(true);
    expect(normalizeLine(42, JOB_TITLE_MAX)).toEqual({ ok: false, problem: 'not_text' });
    expect(normalizeLine({ toString: () => 'x' }, JOB_TITLE_MAX)).toEqual({ ok: false, problem: 'not_text' });
  });

  it('empty clears an optional field and is refused for a required one', () => {
    expect(normalizeLine('   ', JOB_TITLE_MAX)).toEqual({ ok: true, value: null });
    expect(normalizeLine(null, JOB_TITLE_MAX)).toEqual({ ok: true, value: null });
    expect(normalizeLine('  ', JOB_TITLE_MAX, true)).toEqual({ ok: false, problem: 'required' });
  });

  it('counts characters, not UTF-16 units', () => {
    expect(normalizeLine('😀'.repeat(JOB_TITLE_MAX), JOB_TITLE_MAX).ok).toBe(true);
  });
});

describe('normalizeParagraphs (About me)', () => {
  it('keeps paragraphs, folds CRLF, caps blank-line runs', () => {
    const raw = `أعمل في متابعة الأسر.${ch(13)}${ch(10)}${ch(13)}${ch(10)}${ch(13)}${ch(10)}${ch(13)}${ch(10)}I speak English.   `;
    expect(normalizeParagraphs(raw, ABOUT_MAX)).toEqual({ ok: true, value: `أعمل في متابعة الأسر.${ch(10)}${ch(10)}I speak English.` });
  });

  it('removes controls and isolates but keeps the text', () => {
    expect(normalizeParagraphs(`a${ch(7)}b${ch(0x2066)}c${ch(0x2069)}`, ABOUT_MAX)).toEqual({ ok: true, value: 'abc' });
  });

  it('refuses over the limit', () => {
    expect(normalizeParagraphs('x'.repeat(ABOUT_MAX + 1), ABOUT_MAX)).toEqual({ ok: false, problem: 'too_long' });
  });

  it('a backslash is just a character', () => {
    expect(normalizeParagraphs(`${BS}u202e`, ABOUT_MAX)).toEqual({ ok: true, value: `${BS}u202e` });
  });
});
