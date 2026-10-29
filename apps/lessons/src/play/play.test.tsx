import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import pin from '../../quran-pin.json';
import { AudioController, type AudioFactory, type AudioSource, type Playable } from '../audio/audio-controller';
import { approvalSha256, type ApprovalKey } from '../content/quran-content';
import type { Ayah } from '../quran/dataset';
import { route } from '../route';
import { snapshot } from '../test/fixtures';
import { KNOBS, segmentsFor, tierOf } from './adapt';
import { MECHANICS, approvedMechanics, parseMechanics } from './mechanics';
import registry from './mechanics.json';
import { buildSession, sessionSeed, today } from './session';
import { CountAyat } from './games/CountAyat';
import { Echo } from './games/Echo';
import { ListenGlow } from './games/ListenGlow';
import { WhichHeard, planRounds } from './games/WhichHeard';
import { FITS, GAMES, PlayLesson } from './PlayLesson';
import type { Mechanic } from './mechanics';
import committedPlay from '../content/approvals/play.json';

// signed.ts is fixed at build time and no parent passes keys or approvals; the tests replace the module.
const signed = vi.hoisted(() => ({ mechanics: [] as readonly Mechanic[], approvals: null as unknown, keys: [] as readonly ApprovalKey[] }));
vi.mock('./signed', () => ({ SIGNED: signed }));

// Stand-in verses (not Quran).
const TEXTS = ['ألف باء تاء', 'جيم حاء', 'دال ذال راء', 'شين صاد', 'قاف لام'];
const AYAHS: Ayah[] = TEXTS.map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: '' }));
const ALL = new Set(MECHANICS.map((m) => m.id));

// A test key: the engine checks the envelope's shape and key; CI (verify-approvals.mjs) verifies signatures.
const KEYS: ApprovalKey[] = [{ id: '0123456789abcdef', publicKey: 'test', env: 'production' }];
const SIG = 'A'.repeat(86) + '==';
/** The API's signed export for scope 'play', as approvals/play.json holds it. */
function envelope(approvals: { id: string; approvalSha256: string; steps: string[] }[], over: Record<string, unknown> = {}) {
  return {
    payload: {
      v: 1,
      env: 'production',
      issuedAt: '2026-10-29T12:00:00.000Z',
      datasetId: pin.datasetId,
      lessonKey: 'play',
      approvals: approvals.map((a) => ({ ...a, signers: a.steps.map((step, n) => ({ step, staffId: `staff-${n}`, at: '2026-10-29T10:00:00Z' })) })),
      ...over,
    },
    keyId: KEYS[0]!.id,
    signature: SIG,
  };
}

/** A recitation whose files end when the test says so. */
function fakeAudio() {
  const playing: Array<Playable & { url: string }> = [];
  const factory: AudioFactory = (url) => {
    const p = { url, currentTime: 0, onended: null as (() => void) | null, play: async () => undefined, pause: () => undefined };
    playing.push(p);
    return p;
  };
  const source: AudioSource = (s, a) => `https://media.test/${s}/${a}.mp3`;
  const controller = new AudioController(source, factory);
  const end = () => act(() => playing[playing.length - 1]!.onended?.());
  return { controller, playing, end };
}

const props = (over: Record<string, unknown> = {}) => ({ surah: 112, ayahs: AYAHS.slice(0, 3), pool: AYAHS, audio: null, band: '3-5' as const, seed: 7, onComplete: vi.fn(), ...over });

describe('adaptation (plan §B)', () => {
  it('length tiers', () => {
    expect([1, 8, 9, 20, 21, 50, 51, 120, 121, 286].map(tierOf)).toEqual(['L1', 'L1', 'L2', 'L2', 'L3', 'L3', 'L4', 'L4', 'L5', 'L5']);
  });
  it('a 3-5 child plays 1-3 ayat at a time, with two choices, no timer, three activities a sitting', () => {
    expect(segmentsFor('3-5', 5)).toEqual([[1, 3], [4, 5]]);
    expect(segmentsFor('3-5', 11)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 11]]);
    expect(KNOBS['3-5']).toMatchObject({ options: 2, timers: false, activities: 3 });
    expect(KNOBS['6-8'].timers).toBe(false);
  });
});

describe('the mechanics and who signs them (plan §C.4)', () => {
  it('the registry is valid, and every mechanic states its respect rules', () => {
    expect(MECHANICS.map((m) => m.id)).toEqual(['listen_glow', 'echo', 'which_heard', 'count_ayat', 'build_ayah', 'order_ayat', 'start_end', 'next_ayah']);
    // Every mechanic in the registry has its game here.
    for (const m of MECHANICS) expect(GAMES[m.id]).toBeDefined();
    for (const m of MECHANICS) expect(m.respect.length).toBeGreaterThan(0);
    // One malformed mechanic refuses them all.
    expect(parseMechanics({ mechanics: [...registry.mechanics, { ...registry.mechanics[0], id: 'Bad Id' }] })).toBeNull();
    expect(parseMechanics({ mechanics: [{ ...registry.mechanics[0], extra: 1 }] })).toBeNull();
  });

  it('nothing is signed yet: no child plays any game', async () => {
    expect([...(await approvedMechanics(MECHANICS))]).toEqual([]);
  });

  it('a mechanic plays only when a teacher AND the scholar signed exactly its record', async () => {
    const m = MECHANICS.find((x) => x.id === 'count_ayat')!;
    const sha = await approvalSha256(pin.datasetId, 'play', m);
    const with_ = (steps: string[], approvalSha = sha) => envelope([{ id: 'count_ayat', approvalSha256: approvalSha, steps }]);
    const approved = async (a: unknown, mechanics = MECHANICS, keys = KEYS) => [...(await approvedMechanics(mechanics, a, pin.datasetId, keys))];
    expect(await approved(with_(['teacher', 'scholar']))).toEqual(['count_ayat']);
    expect(await approved(with_(['teacher']))).toEqual([]);
    expect(await approved(with_(['teacher', 'scholar'], '0'.repeat(64)))).toEqual([]);
    // A changed record (another version) is a new hash: unsigned.
    expect(await approved(with_(['teacher', 'scholar']), [{ ...m, version: 2 }])).toEqual([]);
    // The envelope is read like content's: an unknown key, a staging export, another lesson, the old unsigned shape -- nothing.
    expect(await approved(with_(['teacher', 'scholar']), MECHANICS, [])).toEqual([]);
    expect(await approved(envelope([{ id: 'count_ayat', approvalSha256: sha, steps: ['teacher', 'scholar'] }], { env: 'staging' }))).toEqual([]);
    expect(await approved(envelope([{ id: 'count_ayat', approvalSha256: sha, steps: ['teacher', 'scholar'] }], { lessonKey: 'quran-112' }))).toEqual([]);
    expect(await approved({ scope: 'play', approvals: [{ id: 'count_ayat', approvalSha256: sha, steps: ['teacher', 'scholar'] }] })).toEqual([]);
    // Steps someone did not sign approve nothing.
    const e = with_(['teacher', 'scholar']);
    e.payload.approvals[0]!.signers.pop();
    expect(await approved(e)).toEqual([]);
  });
});

describe('the session (plan §C.3)', () => {
  const session = (over: Partial<Parameters<typeof buildSession>[1]> = {}) =>
    buildSession(MECHANICS, { band: '3-5', ayahCount: 5, segment: [1, 3], audio: true, approved: ALL, seed: 1, ...over }).map((a) => a.mechanic);

  it('listen, then repeat, then recognise -- three for a 3-5 sitting, never the same twice in a row', () => {
    expect(session()).toEqual(['listen_glow', 'echo', 'which_heard']);
    const s = session({ seed: 99 });
    expect(s.every((m, i) => i === 0 || m !== s[i - 1])).toBe(true);
  });

  it('without recitation, only what works without it: counting (in a short surah) and ordering', () => {
    expect(session({ audio: false })).toEqual(['count_ayat', 'order_ayat']);
    expect(session({ audio: false, ayahCount: 30 })).toEqual(['order_ayat']);
  });

  it('the length tier decides: no listen-and-glow or counting in a 30-ayah surah', () => {
    expect(session({ ayahCount: 30 })).toEqual(['echo', 'which_heard', 'order_ayat']);
  });

  it('only signed mechanics, and only for their band: order before recall', () => {
    expect(session({ approved: new Set(['echo']) })).toEqual(['echo']);
    const older = session({ band: '9-12' });
    expect([...older].sort()).toEqual(['build_ayah', 'order_ayat', 'start_end']);
    expect(older[2]).toBe('start_end');
    // "What comes next" is for longer surahs (L2 and up).
    expect(session({ band: '6-8', ayahCount: 12 })).toContain('next_ayah');
    expect(session({ band: '6-8' })).not.toContain('next_ayah');
  });

  it("does not open with the last sitting's mechanic", () => {
    expect(session({ last: 'listen_glow' })[0]).not.toBe('listen_glow');
  });

  it('the seed is (surah, segment, band, levels, date): the same day reproduces a sitting, another day varies it', () => {
    const o = { surah: 112, segment: 0, band: '3-5' as const, date: '2026-10-29' };
    expect(sessionSeed(o)).toBe(sessionSeed({ ...o }));
    const seeds = new Set(['2026-10-29', '2026-10-30', '2026-10-31'].map((date) => sessionSeed({ ...o, date })));
    expect(seeds.size).toBe(3);
    expect(sessionSeed({ ...o, segment: 1 })).not.toBe(sessionSeed(o));
    expect(sessionSeed({ ...o, levels: 'listening:2' })).not.toBe(sessionSeed(o));
    expect(today(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('the games: a whole verse, still, on a big card', () => {
  it('Listen & Glow: a touch plays the ayah, its frame glows, done when each was heard', () => {
    const { controller, end } = fakeAudio();
    const onComplete = vi.fn();
    render(<ListenGlow {...props({ audio: controller, onComplete })} />);
    const cards = screen.getAllByRole('button');
    // The verse is the verified text, verbatim.
    expect(cards.map((c) => c.querySelector('.play-card__verse')!.textContent)).toEqual(TEXTS.slice(0, 3));
    fireEvent.click(cards[0]!);
    expect(cards[0]!.className).toContain('play-card--glow');
    end();
    fireEvent.click(cards[1]!);
    end();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(cards[2]!);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("Echo: after the recitation it is the child's turn; three echoes, then the next ayah", () => {
    const { controller, end } = fakeAudio();
    const onComplete = vi.fn();
    render(<Echo {...props({ audio: controller, ayahs: AYAHS.slice(0, 1), onComplete })} />);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /استمع/ }));
      expect(screen.queryByText('دورك! ردّد الآية')).toBeNull();
      end();
      fireEvent.click(screen.getByRole('button', { name: /ردّدها/ }));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Which did you hear: two whole, real ayat; a wrong touch is refused where it is, and after two the answer is shown', () => {
    const rounds = planRounds(AYAHS.slice(0, 3), AYAHS, 3, 2, 7);
    for (const r of rounds) {
      expect(r.options).toHaveLength(2);
      expect(r.options).toContain(r.target);
      expect(new Set(r.options.map((o) => o.text)).size).toBe(2);
      for (const o of r.options) expect(AYAHS).toContain(o); // never an altered ayah
    }
    const { controller } = fakeAudio();
    const onComplete = vi.fn();
    render(<WhichHeard {...props({ audio: controller, onComplete })} />);
    const wrong = () => {
      const target = rounds[0]!.target.ayah;
      return screen.getAllByRole('button').find((b) => b.dataset.ayah && Number(b.dataset.ayah) !== target)!;
    };
    fireEvent.click(wrong());
    expect(screen.getByText('حاول مرة أخرى')).toBeTruthy();
    fireEvent.click(wrong());
    expect(screen.getByText('✓ هذه هي')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    for (let r = 1; r < 3; r++) {
      const target = rounds[r]!.target.ayah;
      fireEvent.click(screen.getAllByRole('button').find((b) => Number(b.dataset.ayah) === target)!);
      expect(screen.getByText('✓ أحسنت')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Which did you hear: the right card is not always in one place', () => {
    for (const options of [2, 4]) {
      const at = new Set<number>();
      for (let seed = 0; seed < 40; seed++) {
        for (const r of planRounds(AYAHS.slice(0, 3), AYAHS, 3, options, seed)) at.add(r.options.indexOf(r.target));
      }
      expect([...at].sort()).toEqual(Array.from({ length: options }, (_, i) => i));
    }
  });

  it('a verse card is named by what it shows: the ayah number and the verse itself', () => {
    render(<CountAyat {...props({ ayahs: AYAHS.slice(0, 1) })} />);
    expect(screen.getByRole('button', { name: `الآية ١ ${TEXTS[0]}` })).toBeTruthy();
    expect(screen.getByText('الآيات التي عددتها: ٠ من ١')).toBeTruthy();
  });

  it('Count the ayat, without recitation: a grown-up reads, the child counts in order; another touch does nothing', () => {
    const onComplete = vi.fn();
    render(<CountAyat {...props({ ayahs: AYAHS, onComplete })} />);
    expect(screen.getByText(/يقرأ لك الكبير/)).toBeTruthy();
    const cards = screen.getAllByRole('button');
    fireEvent.click(cards[3]!);
    expect(cards[0]!.className).toContain('play-card--glow');
    for (const c of cards) fireEvent.click(c);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/عددتَ ٥ آيات/)).toBeTruthy();
  });
});

describe('the games page', () => {
  const sign = async (...ids: string[]) =>
    envelope(
      await Promise.all(
        ids.map(async (id) => ({ id, approvalSha256: await approvalSha256(pin.datasetId, 'play', MECHANICS.find((m) => m.id === id)!), steps: ['teacher', 'scholar'] })),
      ),
    );
  /** A recitation list as the opener hands it over: `missing` ayat have no file. */
  function recitation(missing: number[] = []) {
    const files: Array<Playable & { url: string }> = [];
    const audioFactory: AudioFactory = (url) => {
      const p = { url, currentTime: 0, onended: null as (() => void) | null, play: async () => undefined, pause: () => undefined };
      files.push(p);
      return p;
    };
    const audioSource: AudioSource = (s, a) => (missing.includes(a) ? null : `https://media.test/${s}/${a}.mp3`);
    const end = () => act(() => files[files.length - 1]!.onended?.());
    return { audioSource, audioFactory, end };
  }
  beforeEach(() => {
    Object.assign(signed, { mechanics: MECHANICS, approvals: committedPlay, keys: KEYS });
  });
  async function page({ approvals, mechanics, ...over }: Partial<Parameters<typeof PlayLesson>[0]> & { approvals?: unknown; mechanics?: readonly Mechanic[] } = {}) {
    if (approvals !== undefined) signed.approvals = approvals;
    if (mechanics !== undefined) signed.mechanics = mechanics;
    const s = await snapshot(112, 5, { texts: TEXTS, basmala: true });
    const el = (o: Partial<Parameters<typeof PlayLesson>[0]>) => (
      <PlayLesson surah={112} fetcher={s.fetcher} anchor={s.anchor} date="2026-10-29" audioWaitMs={0} {...over} {...o} />
    );
    const r = render(el({}));
    return { rerender: (o: Partial<Parameters<typeof PlayLesson>[0]>) => r.rerender(el(o)) };
  }
  const region = () => document.querySelector('section.play')?.getAttribute('aria-label') ?? null;
  /** Opens the folded grown-up controls (the child does not see them). */
  const grownUp = () => {
    const t = screen.getByRole('button', { name: /للكبار/ });
    if (t.getAttribute('aria-expanded') !== 'true') fireEvent.click(t);
  };

  it('no page passes keys, approvals or mechanics: they are fixed at build time (signed.ts), frozen', async () => {
    const refused = [
      // @ts-expect-error -- not a prop: a parent cannot hand PlayLesson its own keys
      <PlayLesson key="k" surah={112} approvalKeys={[]} />,
      // @ts-expect-error -- not a prop: nor its own approvals
      <PlayLesson key="a" surah={112} approvals={{}} />,
      // @ts-expect-error -- not a prop: nor its own mechanics
      <PlayLesson key="m" surah={112} mechanics={[]} />,
    ];
    expect(refused).toHaveLength(3);
    const real = await vi.importActual<typeof import('./signed')>('./signed');
    const { APPROVAL_KEYS } = await vi.importActual<typeof import('../content/quran-content')>('../content/quran-content');
    expect(Object.isFrozen(real.SIGNED)).toBe(true);
    expect(real.SIGNED.approvals).toEqual(committedPlay);
    expect(real.SIGNED.keys).toBe(APPROVAL_KEYS);
    expect(real.SIGNED.mechanics).toBe(MECHANICS);
  });

  it('shows no game while none is signed', async () => {
    await page();
    expect(await screen.findByText(/الألعاب قيد المراجعة/)).toBeTruthy();
    expect(document.querySelectorAll('.play-card')).toHaveLength(0);
  });

  it('plays a signed mechanic that works without recitation, on the segment only', async () => {
    await page({ approvals: await sign('count_ayat') });
    const game = await screen.findByRole('region', { name: 'عُدّ الآيات' });
    // 3-5 plays 112 (5 stand-in ayat) as [1-3], [4-5]: the counting game counts the segment.
    expect(within(game).getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText(/الآيات ١–٣/)).toBeTruthy();
  });

  it('waits for the recitation list, then plays the mechanics that need it', async () => {
    const r = recitation();
    const { rerender } = await page({ approvals: await sign('listen_glow', 'count_ayat'), audioWaitMs: 60_000 });
    expect(await screen.findByText('جارٍ تجهيز الألعاب…')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/ألعاب سورة/);
    rerender({ audioSource: r.audioSource, audioFactory: r.audioFactory });
    expect(await screen.findByRole('region', { name: 'اسمع والمس' })).toBeTruthy();
  });

  it('a recitation list arriving late does not change the sitting under the child; the next segment uses it', async () => {
    const r = recitation();
    const { rerender } = await page({ approvals: await sign('listen_glow', 'count_ayat') });
    const game = await screen.findByRole('region', { name: 'عُدّ الآيات' });
    fireEvent.click(within(game).getAllByRole('button')[0]!);
    rerender({ audioSource: r.audioSource, audioFactory: r.audioFactory });
    // Same game, same progress: one counted of three.
    expect(region()).toBe('عُدّ الآيات');
    expect(screen.getByText('الآيات التي عددتها: ١ من ٣')).toBeTruthy();
    expect(screen.getByText(/اللعبة ١ من ١/)).toBeTruthy();
    for (const c of within(game).getAllByRole('button')) fireEvent.click(c);
    fireEvent.click(await screen.findByRole('button', { name: /الآيات التالية/ }));
    expect(await screen.findByRole('region', { name: 'اسمع والمس' })).toBeTruthy();
  });

  it('a segment with an ayah missing its file gets no game that needs recitation', async () => {
    const r = recitation([2]);
    await page({ approvals: await sign('listen_glow', 'count_ayat'), audioSource: r.audioSource, audioFactory: r.audioFactory });
    expect(await screen.findByRole('region', { name: 'عُدّ الآيات' })).toBeTruthy();
    // Without recitation for the segment, the counting game is read by a grown-up.
    expect(screen.getByText(/يقرأ لك الكبير/)).toBeTruthy();
  });

  it('an audio game across segments: each segment plays its own ayat', async () => {
    const r = recitation();
    await page({ approvals: await sign('listen_glow'), audioSource: r.audioSource, audioFactory: r.audioFactory });
    let game = await screen.findByRole('region', { name: 'اسمع والمس' });
    expect(within(game).getAllByRole('button').map((b) => b.dataset.ayah)).toEqual(['1', '2', '3']);
    for (const c of within(game).getAllByRole('button')) {
      fireEvent.click(c);
      r.end();
    }
    fireEvent.click(await screen.findByRole('button', { name: /الآيات التالية/ }));
    game = await screen.findByRole('region', { name: 'اسمع والمس' });
    expect(within(game).getAllByRole('button').map((b) => b.dataset.ayah)).toEqual(['4', '5']);
    expect(screen.getByText(/الآيات ٤–٥/)).toBeTruthy();
  });

  it('the grown-up can skip a game that waits on recitation, stop, and carry on', async () => {
    const r = recitation();
    await page({ approvals: await sign('listen_glow', 'echo'), audioSource: r.audioSource, audioFactory: r.audioFactory });
    expect(await screen.findByRole('region', { name: 'اسمع والمس' })).toBeTruthy();
    // Folded away from the child until a grown-up opens them.
    expect(screen.queryByRole('button', { name: /أوقف/ })).toBeNull();
    expect(screen.getByRole('button', { name: /للكبار/ }).getAttribute('aria-expanded')).toBe('false');
    grownUp();
    fireEvent.click(screen.getByRole('button', { name: /أوقف/ }));
    expect(screen.getByText('توقّفت الألعاب.')).toBeTruthy();
    expect(document.querySelectorAll('.play-card')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'تابع' }));
    fireEvent.click(screen.getByRole('button', { name: /تخطَّ اللعبة/ }));
    expect(await screen.findByRole('region', { name: 'ردّد معي' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /تخطَّ اللعبة/ }));
    expect(await screen.findByText('أحسنت! انتهت ألعاب هذه الآيات')).toBeTruthy();
  });

  it('turning the recitation off restarts the sitting without it; the verse size can change', async () => {
    const r = recitation();
    await page({ approvals: await sign('listen_glow', 'count_ayat'), audioSource: r.audioSource, audioFactory: r.audioFactory });
    expect(await screen.findByRole('region', { name: 'اسمع والمس' })).toBeTruthy();
    grownUp();
    fireEvent.click(screen.getByRole('button', { name: /بلا تلاوة/ }));
    expect(await screen.findByRole('region', { name: 'عُدّ الآيات' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /شغّل التلاوة/ }).getAttribute('aria-pressed')).toBe('true');
    const main = document.querySelector('main')!;
    expect(main.style.getPropertyValue('--verse-scale')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: /تكبير الآيات/ }));
    expect(main.style.getPropertyValue('--verse-scale')).toBe('1.25');
  });

  it('a signed mechanic with no game here is never offered, and no praise is shown for it', async () => {
    const ghost = { ...MECHANICS.find((m) => m.id === 'count_ayat')!, id: 'ghost_game' };
    expect(GAMES.ghost_game).toBeUndefined();
    const approvals = envelope([{ id: 'ghost_game', approvalSha256: await approvalSha256(pin.datasetId, 'play', ghost), steps: ['teacher', 'scholar'] }]);
    await page({ mechanics: [...MECHANICS, ghost], approvals });
    expect(await screen.findByText('لا توجد لعبة لهذه الآيات بعد.')).toBeTruthy();
    expect(screen.queryByText(/أحسنت/)).toBeNull();
  });

  it('the grown-up moves the age band one step: the sitting restarts for it, with that band\'s games and segments', async () => {
    await page({ approvals: await sign('order_ayat', 'build_ayah') });
    // 3-5 by default: ordering pairs (building is not for 3-5), on 1-3.
    expect(await screen.findByRole('region', { name: 'رتّب الآيات' })).toBeTruthy();
    expect(screen.getByText(/الآيات ١–٣ · اللعبة ١ من ١/)).toBeTruthy();
    grownUp();
    // One band up or down only (plan §B.1): from 3-5, not 9-12.
    expect(screen.queryByRole('button', { name: '٩–١٢' })).toBeNull();
    expect(screen.getByRole('button', { name: '٣–٥' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '٦–٨' }));
    expect(screen.getByRole('button', { name: '٦–٨' }).getAttribute('aria-pressed')).toBe('true');
    // 6-8 plays the short surah as one segment, both games.
    expect(await screen.findByText(/الآيات ١–٥ · اللعبة ١ من ٢/)).toBeTruthy();
  });

  it('a game that cannot be played on these ayat is not offered (no ayah long enough to cut in two)', async () => {
    expect(FITS.start_end!(AYAHS, AYAHS, '6-8')).toBe(false);
    expect(FITS.build_ayah!(AYAHS, AYAHS, '6-8')).toBe(true);
    await page({ approvals: await sign('start_end'), band: '6-8' });
    expect(await screen.findByText('لا توجد لعبة لهذه الآيات بعد.')).toBeTruthy();
  });

  it('lives at /lessons/quran/surah-N/play', () => {
    expect(route('/lessons/quran/surah-112/play')).toEqual({ kind: 'play', surah: 112 });
    expect(route('/lessons/quran/surah-112')).toEqual({ kind: 'surah', surah: 112 });
    expect(route('/lessons/quran/surah-115/play')).toEqual({ kind: 'not-found' });
  });
});
