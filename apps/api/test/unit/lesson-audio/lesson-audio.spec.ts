/**
 * PD-48: lesson voice-over (docs/product/pd048-lesson-voice-over-design.md).
 *
 * The promise is the gate, not the vendor: a child hears a clip only if two
 * people approved exactly those bytes for exactly that text, the voice is
 * listed in code, and the release gate lets this account hear it. Every way
 * to fail that is silence. Pure: a fake store and a fake object storage.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommError } from '@platform/errors';
import { lessonAudioAccess, legacyLessonAudioKeys } from '@platform/lesson-audio-policy';
import type { UploadAuthorization } from '../../../src/communication/attachments/object-storage';
import { NO_LESSON_AUDIO, lessonAudioAllowed, parseLessonAudience, parseLessonAudioTesters, type LessonAudioGate } from '../../../src/lesson-audio/lesson-audio-gate';
import { APPROVALS_REQUIRED, TRIES_PER_ROUND, lessonAudioKey, parseLessonAudioKey } from '../../../src/lesson-audio/lesson-audio-key';
import { parseManifest, planLessonIngest, runLessonIngest, type ClipRowWriter, type GenerationManifest } from '../../../src/lesson-audio/lesson-audio-ingest';
import { LessonAudioService, refusal, servedClip, stringStatus, unitOf } from '../../../src/lesson-audio/lesson-audio.service';
import type { ClipRow, DecisionRow, LessonAudioStore, ReviewRow } from '../../../src/lesson-audio/lesson-audio.store';
import { lessonText, parseLessonText, type LessonText } from '../../../src/lesson-audio/lesson-texts';
import { canonicalJson, parseRecipe, rateFactor, renderSha256, type RenderRecipe } from '../../../src/lesson-audio/recipe';
import { VOICE_SOURCES, familyLicence, lessonVoice, type VoiceSource } from '../../../src/lesson-audio/voice-sources';
import { admin, manager, parent, teacher } from '../../support/fixtures';

const ORG_ID = '00000000-0000-4000-8000-0000000000aa';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const MIGRATION = join(__dirname, '../../../../../supabase/migrations/20261029230000_chat_pd048_lesson_audio.sql');

// Test strings only (not lesson content): letters and marks spelled as escapes.
const BAB = 'بَابْ';
const DAR = 'دَارْ';

function textOf(lessonApproved: boolean): LessonText {
  const t = parseLessonText({
    lesson: 'arabic-001',
    lessonApproved,
    strings: [
      { id: 'ba-001', kind: 'word', text: BAB, sha256: sha(BAB) },
      { id: 'dal-001', kind: 'word', text: DAR, sha256: sha(DAR) },
    ],
  });
  if (!t) throw new Error('fixture');
  return t;
}

const AUDIO = 'a'.repeat(64);
function clip(over: Partial<ClipRow> = {}): ClipRow {
  const stringId = over.stringId ?? 'ba-001';
  const audioSha256 = over.audioSha256 ?? AUDIO;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    stringId,
    textSha256: sha(BAB),
    renderSha256: 'r'.repeat(64).replace(/r/g, 'b'),
    audioSha256,
    objectKey: lessonAudioKey('arabic-001', stringId, audioSha256),
    vendor: 'azure',
    voice: 'ar-SA-HamedNeural',
    attempt: 1,
    createdAt: new Date('2026-10-29T10:00:00Z'),
    state: 'approved',
    ...over,
  };
}

class FakeStore implements LessonAudioStore {
  clipRows: ClipRow[] = [];
  reviewRows: ReviewRow[] = [];
  decisionRows: DecisionRow[] = [];
  orgsAsked: string[] = [];
  gateValue: LessonAudioGate = NO_LESSON_AUDIO;
  clipsAsked = 0;
  reviewed: unknown[] = [];
  async gate() {
    return this.gateValue;
  }
  async clips(org: string) {
    this.clipsAsked++;
    this.orgsAsked.push(org);
    return this.clipRows;
  }
  async reviews() {
    return this.reviewRows;
  }
  async decisions() {
    return this.decisionRows;
  }
  async review(...args: unknown[]) {
    this.reviewed.push(args);
    return 'pending';
  }
  async decide() {}
}

const signed: Array<{ key: string; cacheControl?: string }> = [];
const storage = {
  async signedReadUrl(key: string, _ttl: number, opts?: { cacheControl?: string }) {
    signed.push({ key, cacheControl: opts?.cacheControl });
    return `https://media.example/${key}?sig=1`;
  },
};
const permissions = (keys: string[]) => ({ profileOf: async () => ({ tier: 'x', departmentKind: null, placement: null, permissions: new Set(keys) }) });

const HAMED = 'azure:ar-SA-HamedNeural';
function service(store: FakeStore, opts: { approved?: boolean; voices?: ReadonlyMap<string, VoiceSource>; keys?: string[]; pin?: string | null } = {}) {
  const text = textOf(opts.approved ?? true);
  const pin = opts.pin === undefined ? HAMED : opts.pin;
  return new LessonAudioService(
    store,
    permissions(opts.keys ?? []) as never,
    storage,
    opts.voices ?? VOICE_SOURCES,
    (l) => (l === 'arabic-001' ? text : null),
    () => pin,
  );
}

const LICENSED: ReadonlyMap<string, VoiceSource> = new Map([
  [
    'azure:ar-SA-HamedNeural',
    {
      vendor: 'azure',
      voice: 'ar-SA-HamedNeural',
      licence: { confirmedBy: 'owner', confirmedOn: '2026-11-01', terms: 'test terms', disclosure: 'parent notice', vendorConfirmation: 'test ref' },
    },
  ],
]);

beforeEach(() => {
  signed.length = 0;
});

describe('the key: derived, content-addressed, never Quran', () => {
  it('round-trips, and refuses anything that is not exactly one clip key', () => {
    const key = lessonAudioKey('arabic-001', 'ba-001', AUDIO);
    expect(key).toBe(`lesson-audio/arabic-001/ba-001/${AUDIO}.mp3`);
    expect(parseLessonAudioKey(key)).toEqual({ lesson: 'arabic-001', stringId: 'ba-001', audioSha256: AUDIO });
    expect(parseLessonAudioKey(lessonAudioKey('arabic-001', 'ba.name', AUDIO))?.stringId).toBe('ba.name');
    for (const bad of ['quran/audio/x/001001.mp3', `lesson-audio/arabic-001/../ba-001/${AUDIO}.mp3`, `lesson-audio/arabic-001/ba-001/${AUDIO}.wav`, `lesson-audio/arabic-001/ba-1/${AUDIO}.mp3`]) {
      expect(parseLessonAudioKey(bad)).toBeNull();
    }
    expect(() => lessonAudioKey('arabic-001', 'ba/001', AUDIO)).toThrow();
    expect(() => lessonAudioKey('arabic-001', 'ba-001', 'not-a-hash')).toThrow();
  });

  it('the two-approval rule and the tries per round are the same numbers in the migration', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(/function chat\.lesson_audio_approvals_required\(\)[\s\S]*?select (\d+) \$\$/.exec(sql)?.[1]).toBe(String(APPROVALS_REQUIRED));
    expect(/function chat\.lesson_audio_tries_per_round\(\)[\s\S]*?select (\d+) \$\$/.exec(sql)?.[1]).toBe(String(TRIES_PER_ROUND));
    expect(APPROVALS_REQUIRED).toBe(2); // the owner's rule, 2026-10-28 / 29
  });
});

describe('the recipe hash', () => {
  const recipe: RenderRecipe = { v: 1, norm: 'exact-v1', vendor: 'azure', voice: 'ar-SA-HamedNeural', locale: 'ar-SA', format: 'mp3', rate: '-10%', input: '<speak/>', lexicon: '', take: 1 };

  it('is over canonical JSON, so key order does not change it, and any field does', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).toBe('{"a":{"c":[3],"d":2},"b":1}');
    const shuffled = Object.fromEntries(Object.entries(recipe).reverse()) as unknown as RenderRecipe;
    expect(renderSha256(shuffled)).toBe(renderSha256(recipe));
    expect(renderSha256({ ...recipe, take: 2 })).not.toBe(renderSha256(recipe));
    expect(renderSha256({ ...recipe, input: '<speak>x</speak>' })).not.toBe(renderSha256(recipe));
  });

  it('is the same hash scripts/lessons/tts/tts.py computes (SHARED_RECIPE): one canonical form in both languages', () => {
    const shared: RenderRecipe = { ...recipe, format: 'audio-24khz-48kbitrate-mono-mp3', input: `<speak>${BAB}</speak>` };
    expect(renderSha256(shared)).toBe('c7c54315d470ffe3a77f3be3fa8875cb1346bf12e20ab17db372fbd6c4c32f10');
    expect(readFileSync(join(__dirname, '../../../../../scripts/lessons/tts/tts.py'), 'utf8')).toContain('SHARED_RECIPE_SHA256 = "c7c54315d470ffe3a77f3be3fa8875cb1346bf12e20ab17db372fbd6c4c32f10"');
  });

  it('parses exactly a recipe: no field more, none less', () => {
    expect(parseRecipe(recipe)).toEqual(recipe);
    expect(typeof parseRecipe({ ...recipe, extra: 1 })).toBe('string');
    expect(typeof parseRecipe({ ...recipe, norm: 'nfkc' })).toBe('string');
    expect(typeof parseRecipe({ ...recipe, lexicon: 'zz' })).toBe('string');
  });
});

describe("the lesson's approved text (generated from apps/lessons)", () => {
  it('the real arabic-001 map verifies, and every entry hashes to its own text', () => {
    const t = lessonText('arabic-001');
    expect(t).not.toBeNull();
    expect(t!.strings.size).toBeGreaterThan(0);
    for (const s of t!.strings.values()) expect(sha(s.text)).toBe(s.sha256);
  });

  it('fails closed: a tampered hash, a non-NFC text, a bad id or a duplicate is no lesson at all', () => {
    const ok = { id: 'ba-001', kind: 'word', text: BAB, sha256: sha(BAB) };
    const base = { lesson: 'arabic-001', lessonApproved: true };
    expect(parseLessonText({ ...base, strings: [ok] })).not.toBeNull();
    expect(parseLessonText({ ...base, strings: [{ ...ok, sha256: sha(DAR) }] })).toBeNull();
    const notNfc = 'بَّ'; // shadda before fatha
    expect(parseLessonText({ ...base, strings: [{ ...ok, text: notNfc, sha256: sha(notNfc) }] })).toBeNull();
    expect(parseLessonText({ ...base, strings: [{ ...ok, id: 'ba/001' }] })).toBeNull();
    expect(parseLessonText({ ...base, strings: [ok, ok] })).toBeNull();
    expect(lessonText('arabic-002')).toBeNull();
  });
});

describe('the release gate (lesson_audio.enabled_for), separate from Quran audio', () => {
  const sa = admin('sa-1', 'super_admin');
  const tester = admin('tester-1', 'admin');
  const gate = (audience: LessonAudioGate['audience']): LessonAudioGate => ({ audience, testStaffIds: ['tester-1'] });

  it('unset or unreadable is none: nobody, the owner included', () => {
    expect(parseLessonAudience(undefined)).toBe('none');
    expect(parseLessonAudience('everyone')).toBe('none');
    expect(parseLessonAudioTesters(['ok', 'not ok!'])).toEqual([]);
    expect(lessonAudioAllowed(NO_LESSON_AUDIO, true, sa)).toBe(false);
  });

  it('staff_test: the super admin and the named testers only, licensed or not', () => {
    expect(lessonAudioAllowed(gate('staff_test'), false, sa)).toBe(true);
    expect(lessonAudioAllowed(gate('staff_test'), false, tester)).toBe(true);
    expect(lessonAudioAllowed(gate('staff_test'), true, admin('other', 'admin'))).toBe(false);
    expect(lessonAudioAllowed(gate('staff_test'), true, parent())).toBe(false);
  });

  it('all: families only for a licensed voice; without the licence it is still the testers', () => {
    expect(lessonAudioAllowed(gate('all'), false, parent())).toBe(false);
    expect(lessonAudioAllowed(gate('all'), true, parent())).toBe(true);
    expect(lessonAudioAllowed(gate('all'), true, teacher())).toBe(true);
    expect(lessonAudioAllowed(gate('all'), false, tester)).toBe(true);
  });

  it('an Azure voice needs the written confirmation of the parent notice (R-48a) before families hear it', () => {
    const l = { confirmedBy: 'owner', confirmedOn: '2026-11-01', terms: 't', disclosure: 'parent notice', vendorConfirmation: null };
    expect(familyLicence({ vendor: 'azure', voice: 'v', licence: l })).toBeNull();
    expect(familyLicence({ vendor: 'azure', voice: 'v', licence: { ...l, vendorConfirmation: 'ref' } })).not.toBeNull();
    expect(familyLicence({ vendor: 'polly', voice: 'v', licence: l })).not.toBeNull();
    // Today nothing is licensed: no family hears any voice.
    expect([...VOICE_SOURCES.values()].filter((s) => familyLicence(s) !== null)).toEqual([]);
  });
});

describe('what a learner hears (GET /lesson-audio/:lesson)', () => {
  it('nothing while the gate is none -- and the clips are not even read', async () => {
    const store = new FakeStore();
    store.clipRows = [clip()];
    expect((await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'))).clips).toEqual([]);
    expect(store.clipsAsked).toBe(0);
  });

  it('a clip with two approvals of the current text, for a tester, as a no-store signed URL of the derived key', async () => {
    const store = new FakeStore();
    store.gateValue = { audience: 'staff_test', testStaffIds: [] };
    store.clipRows = [clip()];
    const out = await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'));
    expect(out.clips).toEqual([
      { id: 'ba-001', audio: { key: clip().objectKey, url: `https://media.example/${clip().objectKey}?sig=1`, sha256: AUDIO, textSha256: sha(BAB) } },
    ]);
    expect(signed).toEqual([{ key: clip().objectKey, cacheControl: 'private, no-store' }]);
  });

  it('never: one approval (pending), rejected, withdrawn, another text, an unlisted voice, a key that is not the derived one', async () => {
    const store = new FakeStore();
    store.gateValue = { audience: 'staff_test', testStaffIds: [] };
    store.clipRows = [
      clip({ state: 'pending' }),
      clip({ state: 'rejected', stringId: 'dal-001', textSha256: sha(DAR) }),
      clip({ state: 'withdrawn', stringId: 'dal-001', textSha256: sha(DAR) }),
      clip({ textSha256: sha('another text') }),
      clip({ voice: 'some-other-voice' }),
      clip({ objectKey: 'quran/audio/x/001001.mp3' }),
    ];
    expect((await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'))).clips).toEqual([]);
    expect(signed).toEqual([]);
  });

  it('the newest fully approved clip of a string wins', async () => {
    const store = new FakeStore();
    store.gateValue = { audience: 'staff_test', testStaffIds: [] };
    const newer = 'c'.repeat(64);
    store.clipRows = [clip(), clip({ audioSha256: newer, createdAt: new Date('2026-10-30T10:00:00Z') })];
    const out = await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'));
    expect(out.clips.map((c) => c.audio.sha256)).toEqual([newer]);
  });

  it('families: nothing under `all` until the voice is licensed, and nothing while the lesson file is unapproved', async () => {
    const store = new FakeStore();
    store.gateValue = { audience: 'all', testStaffIds: [] };
    store.clipRows = [clip()];
    expect((await service(store).learnerAudio('arabic-001', parent())).clips).toEqual([]);
    expect((await service(store, { voices: LICENSED }).learnerAudio('arabic-001', parent())).clips.map((c) => c.id)).toEqual(['ba-001']);
    expect((await service(store, { voices: LICENSED, approved: false }).learnerAudio('arabic-001', parent())).clips).toEqual([]);
  });

  it('an unknown lesson is a 404', async () => {
    await expect(service(new FakeStore()).learnerAudio('arabic-009', parent())).rejects.toMatchObject({ status: 404 });
  });
});

describe('the review page', () => {
  it('listening needs lesson_audio.view (or review); approving needs lesson_audio.review', async () => {
    const store = new FakeStore();
    await expect(service(store).unit('arabic-001', 'ba', manager())).rejects.toBeInstanceOf(CommError);
    const view = await service(store, { keys: ['lesson_audio.view'] }).unit('arabic-001', 'ba', manager());
    expect(view.strings.map((s) => s.id)).toEqual(['ba-001']);
    await expect(service(store, { keys: ['lesson_audio.view'] }).reviewClip(clip().id, 'approve', { textSha256: sha(BAB), audioSha256: AUDIO }, manager())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('a pending clip carries a URL and canReview; my own approval removes canReview', async () => {
    const store = new FakeStore();
    store.clipRows = [clip({ state: 'pending' })];
    store.reviewRows = [{ clipId: clip().id, action: 'approve', staffId: 'manager-1', staffName: 'M', category: null, reason: null, at: new Date() }];
    const mine = await service(store, { keys: ['lesson_audio.review'] }).unit('arabic-001', 'ba', manager());
    expect(mine.strings[0]!.clips[0]).toMatchObject({ state: 'pending', approvedByMe: true, canReview: false });
    expect(mine.strings[0]!.clips[0]!.url).toMatch(/^https:/);
    const other = await service(store, { keys: ['lesson_audio.review'] }).unit('arabic-001', 'ba', admin('reviewer-2', 'admin'));
    expect(other.strings[0]!.clips[0]).toMatchObject({ approvedByMe: false, canReview: true });
  });

  it('a review names the hashes the browser heard; a reject or withdraw needs a category and a reason', async () => {
    const store = new FakeStore();
    const svc = service(store, { keys: ['lesson_audio.review'] });
    await expect(svc.reviewClip(clip().id, 'approve', { textSha256: 'x', audioSha256: AUDIO }, manager())).rejects.toMatchObject({ status: 422 });
    await expect(svc.reviewClip(clip().id, 'reject', { textSha256: sha(BAB), audioSha256: AUDIO, category: 'vowel' }, manager())).rejects.toMatchObject({ status: 422 });
    await expect(svc.reviewClip(clip().id, 'reject', { textSha256: sha(BAB), audioSha256: AUDIO, category: 'mood', reason: 'x' }, manager())).rejects.toMatchObject({ status: 422 });
    await svc.reviewClip(clip().id, 'reject', { textSha256: sha(BAB), audioSha256: AUDIO, category: 'final_sukun', reason: ' no sukun ' }, manager());
    expect(store.reviewed[0]).toEqual([clip().id, 'reject', sha(BAB), AUDIO, 'final_sukun', 'no sukun', 'manager-1']);
  });

  it("the database's refusals become answers: a second approval by the same person, a wrong hash, a closed clip", () => {
    const pg = (code: string, message: string) => Object.assign(new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)('x', { code: 'P2010', clientVersion: 'x' }), { meta: { code, message } });
    expect(refusal(pg('23505', 'duplicate key value violates unique constraint "lesson_audio_one_approval_each"'))).toMatchObject({ status: 403 });
    expect(refusal(pg('23514', 'ERROR: what was heard is not this clip (the hashes differ): nothing is recorded'))).toMatchObject({ status: 409 });
    expect(refusal(pg('42501', 'ERROR: only an active reviewer holding lesson_audio.review reviews lesson audio'))).toMatchObject({ status: 403 });
    expect(refusal(pg('P0002', 'ERROR: no such lesson audio clip'))).toMatchObject({ status: 404 });
  });

  it("a string's standing: approved, no audio, pending, needs a decision after three failures per round", () => {
    const t = sha(BAB);
    const failed = (n: number) => Array.from({ length: n }, () => ({ textSha256: t, state: 'rejected' }));
    expect(stringStatus(t, [], [])).toBe('none');
    expect(stringStatus(t, [{ textSha256: t, state: 'pending' }], [])).toBe('pending');
    expect(stringStatus(t, failed(2), [])).toBe('none');
    expect(stringStatus(t, failed(3), [])).toBe('needsDecision');
    expect(stringStatus(t, failed(3), [{ textSha256: t, decision: 'one_more_round' }])).toBe('none');
    expect(stringStatus(t, failed(6), [{ textSha256: t, decision: 'one_more_round' }])).toBe('needsDecision');
    expect(stringStatus(t, failed(3), [{ textSha256: t, decision: 'no_audio' }])).toBe('noAudio');
    // A changed text starts again: the old text's clips and decisions do not count.
    expect(stringStatus(sha(DAR), failed(3), [{ textSha256: t, decision: 'no_audio' }])).toBe('none');
    expect(unitOf('lam_alif-012')).toBe('lam_alif');
    expect(unitOf('ba.name')).toBe('ba');
  });
});

describe('PD-40: who listens and who approves', () => {
  it('the Teachers manager both; a Teachers supervisor listens; nobody else by role', () => {
    expect([...legacyLessonAudioKeys(manager(), 'manager')].sort()).toEqual(['lesson_audio.review', 'lesson_audio.view']);
    expect([...legacyLessonAudioKeys(admin('s', 'admin'), 'member')]).toEqual(['lesson_audio.view']);
    expect([...legacyLessonAudioKeys(manager(), null)]).toEqual([]);
    expect([...legacyLessonAudioKeys(parent(), 'manager')]).toEqual([]);
    expect(lessonAudioAccess(admin('x', 'specialist'), new Set(['lesson_audio.review']))).toEqual({ view: true, review: true });
    expect(lessonAudioAccess(teacher(), new Set(['lesson_audio.review']))).toEqual({ view: false, review: false });
  });
});

describe('the ingest: what storage holds is what is recorded', () => {
  const recipe: RenderRecipe = { v: 1, norm: 'exact-v1', vendor: 'azure', voice: 'ar-SA-HamedNeural', locale: 'ar-SA', format: 'mp3', rate: '-10%', input: `<speak>${BAB}</speak>`, lexicon: '', take: 1 };
  // A real string of the generated map, so planLessonIngest checks against the built text.
  const real = [...lessonText('arabic-001')!.strings.values()][0]!;
  const bytes = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 7)]);
  const entry = (over: Record<string, unknown> = {}) => ({
    stringId: real.id,
    text: real.text,
    recipe,
    renderSha256: renderSha256(recipe),
    file: 'x.mp3',
    sha256: sha(bytes),
    ...over,
  });
  const manifest = (clips: unknown[]): GenerationManifest => {
    const m = parseManifest({ lesson: 'arabic-001', clips });
    if (typeof m === 'string') throw new Error(m);
    return m;
  };

  it('refuses stale or held text, an unlisted voice, a recipe that does not hash, and a path for a file name', () => {
    const { accepted, refused } = planLessonIngest(
      manifest([
        entry(),
        entry({ text: `${real.text}x` }),
        entry({ stringId: 'zz-999' }),
        entry({ recipe: { ...recipe, voice: 'NotListed' }, renderSha256: renderSha256({ ...recipe, voice: 'NotListed' }) }),
        entry({ renderSha256: 'f'.repeat(64) }),
      ]),
    );
    expect(accepted.map((c) => c.stringId)).toEqual([real.id]);
    expect(refused.map((r) => r.reason)).toEqual([
      expect.stringMatching(/other text/),
      expect.stringMatching(/not an approved string/),
      expect.stringMatching(/not a voice in voice-sources/),
      expect.stringMatching(/does not hash/),
    ]);
    expect(parseManifest({ lesson: 'arabic-001', clips: [entry({ file: '../etc/x.mp3' })] })).toMatch(/file/);
  });

  function fakeDeps(over: { exists?: boolean; corrupt?: boolean } = {}) {
    const objects = new Map<string, Buffer>();
    const rows: unknown[] = [];
    const writer: ClipRowWriter = {
      exists: async () => over.exists ?? false,
      count: async () => 1,
      insert: async (r) => void rows.push(r),
    };
    return {
      rows,
      objects,
      deps: {
        storage: {
          authorizeUpload: async () => ({ objectKey: 'lesson-audio-incoming/arabic-001/tmp', uploadUrl: 'u', method: 'PUT', headers: {} }) as unknown as UploadAuthorization,
          read: async (key: string) => (objects.has(key) ? { body: objects.get(key)!, mimeType: 'audio/mpeg', size: objects.get(key)!.length } : null) as never,
          copy: async (a: string, b: string) => (objects.has(a) ? (objects.set(b, objects.get(a)!), true) : false),
          delete: async (key: string) => void objects.delete(key),
        },
        upload: async (g: UploadAuthorization, b: Buffer) => void objects.set(g.objectKey, over.corrupt ? Buffer.from('html') : b),
        writer,
        readFile: async () => bytes,
      },
    };
  }

  it('writes the row with the hash of what the clip key holds, and the attempt after the earlier ones', async () => {
    const f = fakeDeps();
    const report = await runLessonIngest(manifest([entry()]), '/clips', f.deps, { dryRun: false, organizationId: ORG_ID });
    expect(report).toMatchObject({ written: 1, refused: [] });
    expect(f.rows).toEqual([expect.objectContaining({ stringId: real.id, audioSha256: sha(bytes), byteSize: bytes.length, attempt: 2 })]);
    expect([...f.objects.keys()]).toEqual([lessonAudioKey('arabic-001', real.id, sha(bytes))]); // the temporary upload is gone
  });

  it('a dry run writes nothing; a clip already ingested is never replaced; corrupted storage is refused', async () => {
    const dry = fakeDeps();
    expect(await runLessonIngest(manifest([entry()]), '/clips', dry.deps, { dryRun: true, organizationId: ORG_ID })).toMatchObject({ dryRun: true, accepted: 1, written: 0 });
    expect(dry.rows).toEqual([]);
    const again = fakeDeps({ exists: true });
    expect((await runLessonIngest(manifest([entry()]), '/clips', again.deps, { dryRun: false, organizationId: ORG_ID })).refused[0]?.reason).toMatch(/never replaced/);
    const bad = fakeDeps({ corrupt: true });
    expect((await runLessonIngest(manifest([entry()]), '/clips', bad.deps, { dryRun: false, organizationId: ORG_ID })).refused[0]?.reason).toMatch(/storage holds differs/);
    expect(bad.rows).toEqual([]);
  });
});

describe('review of #254: "no audio" is final, one voice per lesson, the rate, the lesson key, the organization', () => {
  const t = sha(BAB);
  it('"no audio" wins over an approved clip: it is not served, and the string stands as no audio', async () => {
    expect(servedClip([clip()], t, HAMED, true)).toBeNull();
    expect(servedClip([clip()], t, HAMED, false)?.id).toBe(clip().id);
    expect(stringStatus(t, [{ textSha256: t, state: 'approved' }], [{ textSha256: t, decision: 'no_audio' }])).toBe('noAudio');
    const store = new FakeStore();
    store.gateValue = { audience: 'staff_test', testStaffIds: [] };
    store.clipRows = [clip()];
    store.decisionRows = [{ stringId: 'ba-001', textSha256: t, decision: 'no_audio', staffName: 'R', reason: 'x', at: new Date() }];
    expect((await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'))).clips).toEqual([]);
  });

  it("only the lesson's one pinned voice is served; while nothing is pinned, nothing is", async () => {
    const store = new FakeStore();
    store.gateValue = { audience: 'staff_test', testStaffIds: [] };
    store.clipRows = [clip({ voice: 'ar-SA-ZariyahNeural' })];
    expect((await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'))).clips).toEqual([]);
    store.clipRows = [clip()];
    expect((await service(store, { pin: null }).learnerAudio('arabic-001', admin('sa', 'super_admin'))).clips).toEqual([]);
    expect(lessonVoice('arabic-001')).toBeNull(); // the pilot has not picked yet
    expect(lessonVoice('arabic-001', { 'arabic-001': HAMED })).toBe(HAMED);
    expect(lessonVoice('arabic-001', { 'arabic-001': 'azure:not-listed' })).toBeNull();
  });

  it('a learner is served from their own organization only, and a staff member with none gets nothing', async () => {
    const store = new FakeStore();
    store.gateValue = { audience: 'staff_test', testStaffIds: [] };
    store.clipRows = [clip()];
    await service(store).learnerAudio('arabic-001', admin('sa', 'super_admin'));
    expect(store.orgsAsked).toEqual([admin('sa', 'super_admin').organizationId]);
    expect((await service(store).learnerAudio('arabic-001', { ...admin('sa', 'super_admin'), organizationId: undefined })).clips).toEqual([]);
  });

  it('the rate is 0.85 to 1.0 of normal (owner Q6), in either vendor\'s notation', () => {
    expect(rateFactor('-10%')).toBeCloseTo(0.9);
    expect(rateFactor('90%')).toBeCloseTo(0.9);
    const base: RenderRecipe = { v: 1, norm: 'exact-v1', vendor: 'azure', voice: 'ar-SA-HamedNeural', locale: 'ar-SA', format: 'mp3', rate: '-10%', input: '<speak/>', lexicon: '', take: 1 };
    expect(parseRecipe(base)).toEqual(base);
    for (const rate of ['+10%', '110%', '-20%', '80%', 'fast', '0.9']) expect(typeof parseRecipe({ ...base, rate })).toBe('string');
    // The rate SENT must be the recipe's: a <prosody rate> in the input that differs is refused.
    expect(parseRecipe({ ...base, input: '<speak><prosody rate="-10%">x</prosody></speak>' })).toMatchObject({ rate: '-10%' });
    expect(parseRecipe({ ...base, input: '<speak><prosody rate="-30%">x</prosody></speak>' })).toMatch(/prosody rate/);
  });

  it('only arabic-NNN lessons: a quran- or surah- manifest is refused before anything is read', () => {
    for (const lesson of ['quran-001', 'surah-085', 'islamic-001']) expect(parseManifest({ lesson, clips: [] })).toMatch(/not a generation manifest/);
    expect(() => lessonAudioKey('quran-001', 'ba-001', AUDIO)).toThrow();
  });

  it('once a lesson is pinned, the ingest refuses any other voice', () => {
    const real = [...lessonText('arabic-001')!.strings.values()][0]!;
    const recipe: RenderRecipe = { v: 1, norm: 'exact-v1', vendor: 'azure', voice: 'ar-SA-ZariyahNeural', locale: 'ar-SA', format: 'mp3', rate: '-10%', input: '<speak/>', lexicon: '', take: 1 };
    const m = parseManifest({ lesson: 'arabic-001', clips: [{ stringId: real.id, text: real.text, recipe, renderSha256: renderSha256(recipe), file: 'x.mp3', sha256: AUDIO }] });
    if (typeof m === 'string') throw new Error(m);
    expect(planLessonIngest(m, () => HAMED).refused[0]?.reason).toMatch(/voiced by azure:ar-SA-HamedNeural only/);
    expect(planLessonIngest(m, () => null).accepted).toHaveLength(1);
  });
});
