import pin from '../../quran-pin.json';
import type { Surah } from '../quran/dataset';
import { sha256Hex } from '../quran/sha256';
import { wordsOf } from './lesson-content';

/**
 * PD-49: a surah's children's content, schema 2
 * (docs/product/pd049-children-quran-experience-plan.md, sections A and F).
 *
 * Every item is our own wording, derived from a named PUBLIC-DOMAIN source and
 * cited (owner, 2026-10-29). The Quran itself is never in it: an item points at
 * the verified text by position ({ayah}, {ayah, word, to}), and a word inside
 * prose is the token {{w:A:N}} or {{w:A:N-M}}, drawn from the verified verse.
 *
 * Ids follow the PD-29 / PD-48 contract: `<kind>-NNN`, assigned once, never
 * renumbered; a removed id goes to `retiredIds`. All text is NFC.
 *
 * A child sees an item only when ALL of these hold (otherwise it is held):
 *   - the file resolves completely against the verified surah (one bad position
 *     or malformed item refuses the whole file, as in schema 1);
 *   - an approval names the item's id and the SHA-256 of its canonical JSON
 *     (itemSha256): any change to the item makes the approval stale;
 *   - the approval carries every review step the item's kind requires
 *     (REQUIRED_STEPS; the scholar for everything but plain word meanings);
 *   - every work the item cites has a pinned edition in sources.json (none is
 *     pinned yet, so nothing that cites a source can show; a hifz quiz cites
 *     none: it is verified positions plus a teacher-approved question);
 *   - an asbab item passes the display rule (passesAsbabRule);
 *   - a quiz's basis items are all shown.
 * scripts/lessons/check-quran-content.py checks the same file in CI.
 */
export type Band = '3-5' | '6-8' | '9-12';
export const BANDS: readonly Band[] = ['3-5', '6-8', '9-12'];

export type Kind = 'intro' | 'tafsir' | 'tafsir_x' | 'word' | 'lesson' | 'reflection' | 'story' | 'theme' | 'asbab' | 'quiz';
export const KINDS: readonly Kind[] = ['intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme', 'asbab', 'quiz'];

export type Step = 'check' | 'teacher' | 'scholar';
export type QuizCategory = 'hifz' | 'meanings' | 'tafsir' | 'lessons' | 'asbab';

/** The review steps an item needs before it shows (plan section F.2). */
export function requiredSteps(item: { kind: Kind; aqeedah?: boolean; category?: QuizCategory }): Step[] {
  if (item.kind === 'word') return item.aqeedah ? ['check', 'teacher', 'scholar'] : ['check', 'teacher'];
  if (item.kind === 'quiz') {
    return item.category === 'tafsir' || item.category === 'asbab' || item.category === 'lessons' || item.aqeedah
      ? ['check', 'teacher', 'scholar']
      : ['check', 'teacher'];
  }
  return ['check', 'teacher', 'scholar'];
}

export interface Cite {
  work: string;
  ref: string;
}
export type Reason = 'is' | 'is-not';
export type Chain = 'sahih' | 'hasan' | 'daif' | 'mursal' | 'mawdu';
/** A judgement of a report, by reference only: a work, where, and what it concluded -- never its text. */
export interface Verdict extends Cite {
  reason?: Reason;
  chain?: Chain;
}

export interface Work {
  id: string;
  role: 'primary' | 'cross-check' | 'report' | 'pointer' | 'verdict';
  kinds: Kind[];
  edition: unknown;
}

const SOUND: readonly Chain[] = ['sahih', 'hasan'];
const UNSOUND: readonly Chain[] = ['daif', 'mursal', 'mawdu'];
const SAHIHAYN = ['bukhari', 'muslim'];
const CHAIN_JUDGES = ['muzaini-muharrar', 'wadii-sahih-musnad', 'ibn-hajar-fath'];
/** What an item's `source` may be: asbab tell a report; a story retells the surah (a tafsir) or a report. */
const SOURCE_ROLES: Partial<Record<Kind, Work['role'][]>> = { asbab: ['report'], story: ['primary', 'report'] };

/**
 * The asbab display rule (plan A.3), all four conditions but the scholar's
 * signature, which is the approval:
 *   1. al-Muharrar's verdict is that the report IS the reason;
 *   2. the chain is sound: the report is in al-Bukhari or Muslim, or a judge
 *      grades it sahih or hasan;
 *   3. no reference rejects it as the reason or grades it weak;
 * A conflict is "show nothing" (owner, 2026-10-29, section H Q14).
 */
export function passesAsbabRule(source: Cite, verdicts: readonly Verdict[]): boolean {
  const isReason = verdicts.some((v) => v.work === 'muzaini-muharrar' && v.reason === 'is');
  const rejected = verdicts.some((v) => v.reason === 'is-not' || (v.chain !== undefined && UNSOUND.includes(v.chain)));
  const sound = SAHIHAYN.includes(source.work) || verdicts.some((v) => CHAIN_JUDGES.includes(v.work) && v.chain !== undefined && SOUND.includes(v.chain));
  return isReason && sound && !rejected;
}

/** Canonical JSON: keys sorted at every level, no whitespace. Strings and integers only (the checker refuses floats). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const o = value as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

/** What an approval binds: SHA-256 of the item's canonical JSON (the same in scripts/lessons/check-quran-content.py). */
export function itemSha256(item: unknown): Promise<string> {
  return sha256Hex(canonicalJson(item));
}

export interface Approval {
  id: string;
  itemSha256: string;
  steps: Step[];
}

export interface Approvals {
  surah: number;
  lessonKey: string;
  approvals: Approval[];
}

/** One resolved, approved item, as the lesson shows it. Words in prose are already drawn from the verified text. */
export interface ResolvedItem {
  id: string;
  kind: Kind;
  bands: Band[];
  text: string;
  ayah: number | null;
  ayat: [number, number] | null;
  /** word: the verified word(s) the meaning is about. */
  words: string | null;
  ideas: string[];
  order: number | null;
  behaviour: 'good' | 'bad' | null;
  quiz: { category: QuizCategory; options: string[]; answer: number; prompt: string | null } | null;
}

export interface ResolvedQuranContent {
  surah: number;
  lessonKey: string;
  segments: { id: string; from: number; to: number; theme: string | null }[];
  items: ResolvedItem[];
  /** Items not shown: unapproved, stale, missing a step, citing an unpinned edition, or failing a rule. */
  held: number;
}

class Refused extends Error {}
const refuse = (why: string): never => {
  throw new Refused(why);
};

const ID = /^([a-z][a-z0-9_]*)-([0-9]{3})$/;
const TOKEN = /\{\{w:(\d+):(\d+)(?:-(\d+))?\}\}/g;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SEGMENT_ID = /^seg-[0-9]{3}$/;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

function keysExactly(o: Record<string, unknown>, required: string[], optional: string[] = []): void {
  for (const k of required) if (!(k in o)) refuse(`missing ${k}`);
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) refuse(`unknown field ${k}`);
}

function str(x: unknown): string {
  if (typeof x !== 'string' || !x.trim() || x.normalize('NFC') !== x || CONTROL.test(x)) return refuse('a text must be non-empty NFC with no control characters');
  return x;
}

/** Validates a schema-2 file and resolves every position against the verified surah. Throws Refused. */
function parse(raw: unknown, surah: Surah, works: Map<string, Work>) {
  if (!isObj(raw)) return refuse('not an object');
  keysExactly(raw, ['schema', 'surah', 'datasetId', 'lessonKey', 'retiredIds', 'segments', 'items']);
  const n = surah.ayahs.length;
  if (raw.schema !== 2 || raw.surah !== surah.info.number || raw.datasetId !== pin.datasetId) refuse('not schema 2 of this surah and dataset');
  if (raw.lessonKey !== `quran-${String(surah.info.number).padStart(3, '0')}`) refuse('lessonKey');
  const words = surah.ayahs.map((a) => wordsOf(a.text));
  const ayah = (x: unknown): number => (isInt(x) && x >= 1 && x <= n ? x : refuse('not an ayah of this surah'));
  const span = (a: unknown, from: unknown, to: unknown): string => {
    const ws = words[ayah(a) - 1]!;
    if (!isInt(from) || !isInt(to) || from < 1 || to < from || to > ws.length) return refuse('not words of this ayah');
    return ws.slice(from - 1, to).join(' ');
  };
  const prose = (x: unknown): string =>
    str(x).replace(TOKEN, (_, a: string, f: string, t: string | undefined) => span(Number(a), Number(f), Number(t ?? f)));
  const cite = (x: unknown, roles: Work['role'][], kind: Kind): Cite => {
    if (!isObj(x)) return refuse('a citation must be an object');
    keysExactly(x, ['work', 'ref']);
    const w = works.get(String(x.work));
    if (!w || !roles.includes(w.role) || (w.role !== 'verdict' && w.role !== 'pointer' && !w.kinds.includes(kind))) refuse(`work ${String(x.work)} cannot be cited here`);
    return { work: String(x.work), ref: str(x.ref) };
  };
  const bands = (x: unknown): Band[] => {
    if (!Array.isArray(x) || x.length === 0 || new Set(x).size !== x.length || !x.every((b) => BANDS.includes(b as Band))) refuse('bands');
    return x as Band[];
  };

  const retired = raw.retiredIds;
  if (!Array.isArray(retired) || !retired.every((r) => typeof r === 'string' && ID.test(r)) || new Set(retired).size !== retired.length) refuse('retiredIds');
  const retiredSet = new Set(retired as string[]);

  const segs = raw.segments;
  if (!Array.isArray(segs) || segs.length === 0) return refuse('segments');
  let next = 1;
  const segments = segs.map((s) => {
    if (!isObj(s)) return refuse('segment');
    keysExactly(s, ['id', 'from', 'to'], ['theme']);
    if (typeof s.id !== 'string' || !SEGMENT_ID.test(s.id) || s.from !== next || !isInt(s.to) || s.to < next || s.to > n) refuse('segments must cover the ayat in order');
    next = (s.to as number) + 1;
    return { id: s.id as string, from: s.from as number, to: s.to as number, theme: s.theme === undefined ? null : String(s.theme) };
  });
  if (next !== n + 1) refuse('segments must cover every ayah');

  if (!Array.isArray(raw.items)) return refuse('items');
  const seen = new Set<string>();
  const items = raw.items.map((it) => {
    if (!isObj(it)) return refuse('item');
    const id = String(it.id);
    const m = ID.exec(id);
    const kind = it.kind as Kind;
    if (!m || !KINDS.includes(kind) || m[1] !== kind || seen.has(id) || retiredSet.has(id)) refuse(`bad or repeated id ${id}`);
    seen.add(id);
    const out: ResolvedItem = {
      id, kind, bands: bands(it.bands), text: '', ayah: null, ayat: null, words: null, ideas: [], order: null, behaviour: null, quiz: null,
    };
    const common = ['id', 'kind', 'bands', 'text'];
    const cited = ['crossCheck', 'ladder', 'aqeedah'];
    const cites: Cite[] = [];
    const extra = (x: Record<string, unknown>) => {
      if (x.crossCheck !== undefined) cites.push(cite(x.crossCheck, ['primary', 'cross-check'], kind));
      if (x.ladder !== undefined && (!Array.isArray(x.ladder) || x.ladder.length === 0)) refuse('ladder');
      if (Array.isArray(x.ladder)) x.ladder.forEach(prose);
      if (x.aqeedah !== undefined && typeof x.aqeedah !== 'boolean') refuse('aqeedah');
    };
    const pair = (x: unknown): [number, number] => {
      if (!Array.isArray(x) || x.length !== 2) return refuse('ayat must be [from, to]');
      const a = ayah(x[0]);
      const b = ayah(x[1]);
      return b >= a ? [a, b] : refuse('ayat must be [from, to]');
    };
    switch (kind) {
      case 'intro':
      case 'theme':
        keysExactly(it, [...common, 'source'], cited);
        break;
      case 'tafsir':
      case 'tafsir_x':
        keysExactly(it, [...common, 'source', 'ayah'], cited);
        out.ayah = ayah(it.ayah);
        break;
      case 'word':
        keysExactly(it, [...common, 'source', 'ayah', 'word', 'to'], cited);
        out.ayah = ayah(it.ayah);
        out.words = span(it.ayah, it.word, it.to);
        break;
      case 'lesson':
        keysExactly(it, [...common, 'source'], [...cited, 'ayat', 'behaviour']);
        if (it.ayat !== undefined) out.ayat = pair(it.ayat);
        if (it.behaviour !== undefined && it.behaviour !== 'good' && it.behaviour !== 'bad') refuse('behaviour');
        out.behaviour = (it.behaviour as 'good' | 'bad' | undefined) ?? null;
        break;
      case 'reflection':
        keysExactly(it, [...common, 'source', 'ideas'], cited);
        if (!Array.isArray(it.ideas) || it.ideas.length === 0) refuse('ideas');
        out.ideas = (it.ideas as unknown[]).map(prose);
        break;
      case 'story':
        keysExactly(it, [...common, 'source', 'order'], [...cited, 'ayat']);
        if (!isInt(it.order) || it.order < 1) refuse('order');
        out.order = it.order as number;
        if (it.ayat !== undefined) out.ayat = pair(it.ayat);
        break;
      case 'asbab': {
        keysExactly(it, [...common, 'source', 'ayat', 'verdicts'], ['pointer', 'aqeedah']);
        if (!out.bands.every((b) => b === '9-12')) refuse('asbab is for 9-12 only');
        out.ayat = pair(it.ayat);
        if (it.pointer !== undefined) cites.push(cite(it.pointer, ['pointer'], kind));
        if (!Array.isArray(it.verdicts) || it.verdicts.length === 0) refuse('verdicts');
        for (const v of it.verdicts as unknown[]) {
          if (!isObj(v)) refuse('verdict');
          const vo = v as Record<string, unknown>;
          keysExactly(vo, ['work', 'ref'], ['reason', 'chain']);
          if (vo.reason !== undefined && vo.reason !== 'is' && vo.reason !== 'is-not') refuse('reason');
          if (vo.chain !== undefined && ![...SOUND, ...UNSOUND].includes(vo.chain as Chain)) refuse('chain');
          cites.push(cite({ work: vo.work, ref: vo.ref }, ['verdict'], kind));
        }
        break;
      }
      case 'quiz': {
        keysExactly(it, [...common, 'category', 'options', 'answer', 'basis'], ['prompt', 'word', 'aqeedah']);
        const category = it.category as QuizCategory;
        if (!['hifz', 'meanings', 'tafsir', 'lessons', 'asbab'].includes(category)) refuse('category');
        if (!Array.isArray(it.options) || it.options.length < 2 || it.options.length > 4) return refuse('2 to 4 options');
        const options = (it.options as unknown[]).map((o) => {
          if (!isObj(o)) return refuse('option');
          if ('text' in o) {
            keysExactly(o, ['text']);
            return prose(o.text);
          }
          if ('word' in o) {
            keysExactly(o, ['ayah', 'word', 'to']);
            return span(o.ayah, o.word, o.to);
          }
          keysExactly(o, ['ayah']);
          return surah.ayahs[ayah(o.ayah) - 1]!.text;
        });
        if (new Set(options).size !== options.length) refuse('options must be distinct');
        if (!isInt(it.answer) || it.answer < 0 || it.answer >= options.length) refuse('answer');
        if (!Array.isArray(it.basis) || !it.basis.every((b) => typeof b === 'string')) refuse('basis');
        if (category !== 'hifz' && (it.basis as string[]).length === 0) refuse('a quiz beyond hifz names the items it rests on');
        let prompt: string | null = null;
        if (it.prompt !== undefined) {
          const p = it.prompt;
          if (!isObj(p)) return refuse('prompt');
          keysExactly(p, ['ayah', 'words']);
          const ws = words[ayah(p.ayah) - 1]!;
          if (!isInt(p.words) || p.words < 1 || p.words >= ws.length) refuse('prompt');
          prompt = ws.slice(0, p.words as number).join(' ');
        }
        if (it.word !== undefined) {
          const w = it.word;
          if (!isObj(w)) return refuse('word');
          keysExactly(w, ['ayah', 'word', 'to']);
          out.words = span(w.ayah, w.word, w.to);
        }
        if (it.aqeedah !== undefined && typeof it.aqeedah !== 'boolean') refuse('aqeedah');
        out.quiz = { category, options, answer: it.answer as number, prompt };
        break;
      }
    }
    out.text = prose(it.text);
    if (kind !== 'quiz') {
      cites.unshift(cite(it.source, SOURCE_ROLES[kind] ?? ['primary'], kind));
      extra(it);
    }
    return { raw: it, out, cites, basis: kind === 'quiz' ? (it.basis as string[]) : [] };
  });
  for (const s of segments) if (s.theme !== null && !items.some((i) => i.out.id === s.theme && i.out.kind === 'theme')) refuse('a segment theme must be a theme item');
  for (const i of items) for (const b of i.basis) if (!seen.has(b)) refuse(`quiz basis ${b} is not an item`);
  return { segments, items };
}

/**
 * The approved, shown content of a schema-2 file, or null when the file is
 * refused (it is then not shown at all; the lesson keeps its Quran sections).
 */
export async function resolveQuranContent(
  raw: unknown,
  surah: Surah,
  approvals: Approvals | null,
  works: readonly Work[],
): Promise<ResolvedQuranContent | null> {
  const byId = new Map(works.map((w) => [w.id, w]));
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(raw, surah, byId);
  } catch {
    return null;
  }
  const lessonKey = (raw as { lessonKey: string }).lessonKey;
  const approved = new Map<string, Approval>();
  if (approvals && approvals.surah === surah.info.number && approvals.lessonKey === lessonKey && Array.isArray(approvals.approvals)) {
    for (const a of approvals.approvals) approved.set(a.id, a);
  }
  const shownIds = new Set<string>();
  const candidates: typeof parsed.items = [];
  for (const i of parsed.items) {
    const a = approved.get(i.out.id);
    if (!a || !Array.isArray(a.steps) || a.itemSha256 !== (await itemSha256(i.raw))) continue;
    const r = i.raw as { kind: Kind; aqeedah?: boolean; category?: QuizCategory };
    if (!requiredSteps(r).every((s) => a.steps.includes(s))) continue;
    if (!i.cites.every((c) => byId.get(c.work)?.edition)) continue;
    if (i.out.kind === 'asbab') {
      const it = i.raw as { source: Cite; verdicts: Verdict[] };
      if (!passesAsbabRule(it.source, it.verdicts)) continue;
    }
    candidates.push(i);
    shownIds.add(i.out.id);
  }
  // A quiz shows only when everything it rests on shows.
  const items = candidates.filter((i) => i.basis.every((b) => shownIds.has(b))).map((i) => i.out);
  const shown = new Set(items.map((i) => i.id));
  return {
    surah: surah.info.number,
    lessonKey,
    segments: parsed.segments.map((s) => ({ ...s, theme: s.theme !== null && shown.has(s.theme) ? s.theme : null })),
    items,
    held: parsed.items.length - items.length,
  };
}
