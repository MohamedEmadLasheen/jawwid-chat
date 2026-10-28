/**
 * THE RELEASE GATE for Quran audio. Who may receive audio is decided on the
 * server: chat.config `quran.audio.enabled_for` (none | staff_test | all,
 * anything else = none) AND, for anyone who is not staff, a licence
 * confirmation pinned in code for the configured reciter. Paying students and
 * their families never get audio until the owner's confirmation is recorded.
 */
import { audioAllowed, parseAudience } from '../../../src/quran/audio-gate';
import { AUDIO_SOURCES, KFGQPC_HUDHAIFY } from '../../../src/quran/audio-sources';
import { isReciterCode } from '../../../src/quran/audio-key';

const STAFF = { kind: 'staff' } as const;
const CONTACT = { kind: 'contact' } as const; // a parent or a student
const TEACHER = { kind: 'teacher' } as const;
const LICENCE = { confirmedBy: 'owner', confirmedAt: '2026-11-01', reference: 'KFGQPC letter 123' };

describe('the Quran audio release gate', () => {
  it('reads the audience strictly: anything but the three values means none', () => {
    expect(parseAudience('none')).toBe('none');
    expect(parseAudience('staff_test')).toBe('staff_test');
    expect(parseAudience('all')).toBe('all');
    for (const v of [undefined, null, '', 'ALL', 'everyone', 1, true, {}, ['all']]) expect(parseAudience(v)).toBe('none');
  });

  it('none (the default): nobody', () => {
    for (const a of [STAFF, CONTACT, TEACHER]) expect(audioAllowed('none', null, a)).toBe(false);
    for (const a of [STAFF, CONTACT, TEACHER]) expect(audioAllowed('none', LICENCE, a)).toBe(false);
  });

  it('staff_test: staff accounts only, for development and testing', () => {
    expect(audioAllowed('staff_test', null, STAFF)).toBe(true);
    expect(audioAllowed('staff_test', null, CONTACT)).toBe(false);
    expect(audioAllowed('staff_test', null, TEACHER)).toBe(false);
    expect(audioAllowed('staff_test', LICENCE, CONTACT)).toBe(false);
  });

  it('all WITHOUT the recorded licence is still staff only: a student never gets audio', () => {
    expect(audioAllowed('all', null, STAFF)).toBe(true);
    expect(audioAllowed('all', null, CONTACT)).toBe(false);
    expect(audioAllowed('all', null, TEACHER)).toBe(false);
  });

  it('all WITH the recorded licence: everyone signed in', () => {
    for (const a of [STAFF, CONTACT, TEACHER]) expect(audioAllowed('all', LICENCE, a)).toBe(true);
    expect(audioAllowed('all', LICENCE, { kind: 'system' })).toBe(false);
  });

  it('KFGQPC Al-Hudhaify is configured, and its licence is NOT recorded', () => {
    expect(isReciterCode(KFGQPC_HUDHAIFY.reciter)).toBe(true);
    expect(KFGQPC_HUDHAIFY.licence).toBeNull();
    expect(KFGQPC_HUDHAIFY.attribution).toMatch(/PLACEHOLDER/);
    // No archive is listed until the licence session names the official ones (and their checksums).
    expect(KFGQPC_HUDHAIFY.archives).toEqual([]);
    expect(AUDIO_SOURCES.get(KFGQPC_HUDHAIFY.reciter)).toBe(KFGQPC_HUDHAIFY);
    // No source has a licence yet: audio reaches no student anywhere.
    expect([...AUDIO_SOURCES.values()].every((s) => s.licence === null)).toBe(true);
  });
});
