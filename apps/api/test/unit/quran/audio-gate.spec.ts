/**
 * THE RELEASE GATE for Quran audio. Who may receive audio is decided on the
 * server: chat.config `quran.audio.enabled_for` (none | staff_test | all,
 * anything else = none) AND, for anyone who is not staff, a licence
 * confirmation pinned in code for the configured reciter. Paying students and
 * their families never get audio until the owner's confirmation is recorded.
 */
import { audioAllowed, parseAudience, parseTestStaffIds, type AudioAudience } from '../../../src/quran/audio-gate';
import { AUDIO_SOURCES, KFGQPC_HUDHAIFY } from '../../../src/quran/audio-sources';
import { isReciterCode } from '../../../src/quran/audio-key';

const OWNER = { kind: 'staff', actorId: 'owner-id', staffRole: 'super_admin' } as const;
const TESTER = { kind: 'staff', actorId: 'tester-id', staffRole: 'admin' } as const;
const SUPERVISOR = { kind: 'staff', actorId: 'sup-id', staffRole: 'supervisor' } as const; // family-facing
const CONTACT = { kind: 'contact', actorId: 'parent-id' } as const; // a parent or a student
const TEACHER = { kind: 'teacher', actorId: 'teacher-id' } as const;
const LICENCE = { confirmedBy: 'owner', confirmedAt: '2026-11-01', reference: 'KFGQPC letter 123' };
const gate = (audience: AudioAudience, testStaffIds: string[] = []) => ({ audience, testStaffIds });

describe('the Quran audio release gate', () => {
  it('reads the audience strictly: anything but the three values means none', () => {
    expect(parseAudience('none')).toBe('none');
    expect(parseAudience('staff_test')).toBe('staff_test');
    expect(parseAudience('all')).toBe('all');
    for (const v of [undefined, null, '', 'ALL', 'everyone', 1, true, {}, ['all']]) expect(parseAudience(v)).toBe('none');
  });

  it('reads the test allowlist strictly: an array of ids, anything else is empty', () => {
    expect(parseTestStaffIds(['a1', 'b2'])).toEqual(['a1', 'b2']);
    for (const v of [undefined, null, 'a1', [1], ['a1', 2], {}, [''], ['x'.repeat(80)]]) expect(parseTestStaffIds(v)).toEqual([]);
  });

  it('none (the default): nobody, the owner included', () => {
    for (const a of [OWNER, TESTER, CONTACT, TEACHER]) expect(audioAllowed(gate('none', ['tester-id']), LICENCE, a)).toBe(false);
  });

  it('staff_test: the super admin, and staff named in quran.audio.test_staff_ids -- not every staff role', () => {
    expect(audioAllowed(gate('staff_test'), null, OWNER)).toBe(true);
    expect(audioAllowed(gate('staff_test'), null, TESTER)).toBe(false);
    expect(audioAllowed(gate('staff_test', ['tester-id']), null, TESTER)).toBe(true);
    // A family-facing role could play it in a call with a student: not unless named.
    expect(audioAllowed(gate('staff_test'), null, SUPERVISOR)).toBe(false);
    expect(audioAllowed(gate('staff_test', ['parent-id']), LICENCE, CONTACT)).toBe(false);
    expect(audioAllowed(gate('staff_test'), LICENCE, TEACHER)).toBe(false);
  });

  it('all WITHOUT the recorded licence is still the testers only: a student never gets audio', () => {
    expect(audioAllowed(gate('all'), null, OWNER)).toBe(true);
    expect(audioAllowed(gate('all'), null, SUPERVISOR)).toBe(false);
    expect(audioAllowed(gate('all'), null, CONTACT)).toBe(false);
    expect(audioAllowed(gate('all'), null, TEACHER)).toBe(false);
  });

  it('all WITH the recorded licence: everyone signed in', () => {
    for (const a of [OWNER, TESTER, SUPERVISOR, CONTACT, TEACHER]) expect(audioAllowed(gate('all'), LICENCE, a)).toBe(true);
    expect(audioAllowed(gate('all'), LICENCE, { kind: 'system' })).toBe(false);
  });

  it('KFGQPC Al-Hudhaify is configured, and its licence is NOT recorded', () => {
    expect(KFGQPC_HUDHAIFY.reciter).toBe('kfgqpc-huthify-hafs'); // the licence record's constant
    expect(isReciterCode(KFGQPC_HUDHAIFY.reciter)).toBe(true);
    expect(KFGQPC_HUDHAIFY.licence).toBeNull();
    expect(KFGQPC_HUDHAIFY.attribution).toMatch(/PLACEHOLDER/);
    // The one official archive, as the release page publishes it (docs/legal/kfgqpc-hudhaify-licence.md section 5).
    expect(KFGQPC_HUDHAIFY.archives).toEqual([{
      file: 'huthify-ayat.rar',
      url: 'https://download.qurancomplex.gov.sa/new-sounds/huthify-01/hafs/huthify-ayat.rar',
      sha256: 'ad50fd0d8c362f6967141b5240cdbac4089efaf6d3a46ef159c3c8aaa05371f5',
      bytes: 842634506,
      // Pinned from the first verified extraction (evidence register, 2026-10-28).
      extractedManifestSha256: '7daf7f2ac325e08d2c78f52215ff3ebded8e0b29cb968baadec847cc80fe1a69',
    }]);
    expect(AUDIO_SOURCES.get(KFGQPC_HUDHAIFY.reciter)).toBe(KFGQPC_HUDHAIFY);
    // No source has a licence yet: audio reaches no student anywhere.
    expect([...AUDIO_SOURCES.values()].every((s) => s.licence === null)).toBe(true);
  });
});
