/**
 * PD-39: a board page as the teacher's portal writes it (Flutter,
 * lib/features/whiteboards/domain/board_elements.dart), read here to be drawn
 * for staff, read-only. The JSON is the portal's; the API checks ids, kinds,
 * sizes, verses and images only (apps/api/src/whiteboards/whiteboard-document.ts).
 * The three agree through one fixture: test/fixtures/whiteboards/page-every-kind.json.
 *
 * Every default below is the portal's own, so a page looks the same in both.
 * An element this viewer cannot draw -- an image (PR-4), a newer kind, a
 * malformed one -- is shown as a labelled box, never dropped.
 */

/** The page every board is drawn on (design §4.2). */
export const PAGE_WIDTH = 1920
export const PAGE_HEIGHT = 1080

export type Layout = 'plain' | 'ruled' | 'narrow_ruled' | 'grid' | 'arabic_lines'
export type Background = 'white' | 'cream' | 'grey' | 'green' | 'dark'

const LAYOUTS: readonly Layout[] = ['plain', 'ruled', 'narrow_ruled', 'grid', 'arabic_lines']
const BACKGROUNDS: readonly Background[] = ['white', 'cream', 'grey', 'green', 'dark']

/** The portal's BoardPalette (lib/design/tokens.dart); the fixture pins both. */
export const PALETTE = {
  ink: '#1b1b1b',
  white: '#ffffff',
  cream: '#fbf6e9',
  grey: '#eff1f3',
  green: '#1f4a3a',
  dark: '#1d232a',
  ruleOnLight: '#5b708347',
  ruleOnDark: '#ffffff38',
  placeholderOnLight: '#5b7083ff',
  placeholderOnDark: '#ffffffb3',
} as const

export const isDarkBackground = (b: Background) => b === 'green' || b === 'dark'

/** One sampled pen point in page units, with its pressure (0..1). */
export interface StrokePoint {
  x: number
  y: number
  pressure: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type StampKind = 'star' | 'check' | 'heart' | 'thumbsUp' | 'excellentAr' | 'wellDoneAr' | 'excellentEn' | 'wellDoneEn'
const STAMPS: readonly StampKind[] = ['star', 'check', 'heart', 'thumbsUp', 'excellentAr', 'wellDoneAr', 'excellentEn', 'wellDoneEn']
export type ShapeKind = 'rect' | 'ellipse' | 'triangle'
const SHAPES: readonly ShapeKind[] = ['rect', 'ellipse', 'triangle']

export type BoardElement =
  | { kind: 'ink'; id: string; highlight: boolean; points: StrokePoint[]; color: string; width: number }
  | { kind: 'shape'; id: string; shape: ShapeKind; rect: Rect; stroke: string; fill: string | null; width: number }
  | { kind: 'line'; id: string; arrow: boolean; bothEnds: boolean; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'text'; id: string; text: string; rect: Rect; size: number; color: string }
  | { kind: 'stamp'; id: string; stamp: StampKind; rect: Rect; color: string; text: string | null }
  | { kind: 'verse'; id: string; ref: VerseRef; rect: Rect; size: number; color: string }
  /** Not drawn here: shown as a box labelled with its kind. */
  | { kind: 'opaque'; id: string; type: string; rect: Rect }

/** A verse is a reference to the shared, verified dataset, never its text (§4.3). */
export interface VerseRef {
  surah: number
  fromAyah: number
  toAyah: number
  datasetId: string
  rangeSha256: string
}

export interface BoardPage {
  id: string
  position: number
  layout: Layout
  background: Background
  elements: BoardElement[]
}

type Json = Record<string, unknown>

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : PALETTE.ink)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const rectOf = (j: Json, w: number, h: number): Rect => ({ x: num(j.x, 0), y: num(j.y, 0), w: num(j.w, w), h: num(j.h, h) })

/**
 * A stroke's packed points (stroke_points.dart): base64 of the first point as
 * two int32 and every next one as two int16 deltas, in 0.1 units, each with a
 * pressure byte. A damaged value gives no points, so one bad stroke never
 * stops a page from being drawn.
 */
export function decodePoints(encoded: string): StrokePoint[] {
  if (!encoded) return []
  let bytes: Uint8Array
  try {
    const bin = atob(encoded)
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return []
  }
  if (bytes.length < 9 || (bytes.length - 9) % 5 !== 0) return []
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let x = data.getInt32(0, true)
  let y = data.getInt32(4, true)
  const points: StrokePoint[] = [{ x: x / 10, y: y / 10, pressure: data.getUint8(8) / 255 }]
  for (let i = 9; i < bytes.length; i += 5) {
    x += data.getInt16(i, true)
    y += data.getInt16(i + 2, true)
    points.push({ x: x / 10, y: y / 10, pressure: data.getUint8(i + 4) / 255 })
  }
  return points
}

export function parseElement(j: Json): BoardElement {
  const id = typeof j.id === 'string' ? j.id : ''
  switch (j.kind) {
    case 'stroke':
    case 'highlight':
      return {
        kind: 'ink',
        id,
        highlight: j.kind === 'highlight',
        points: decodePoints(typeof j.points === 'string' ? j.points : ''),
        color: color(j.color),
        width: num(j.width, 4),
      }
    case 'shape':
      return {
        kind: 'shape',
        id,
        shape: SHAPES.includes(j.shape as ShapeKind) ? (j.shape as ShapeKind) : 'rect',
        rect: rectOf(j, 10, 10),
        stroke: color(j.color),
        fill: j.fill == null ? null : color(j.fill),
        width: num(j.width, 4),
      }
    case 'line':
    case 'arrow':
      return {
        kind: 'line',
        id,
        arrow: j.kind === 'arrow',
        bothEnds: j.heads === 'both',
        x1: num(j.x1, 0),
        y1: num(j.y1, 0),
        x2: num(j.x2, 10),
        y2: num(j.y2, 10),
        color: color(j.color),
        width: num(j.width, 4),
      }
    case 'text':
      return { kind: 'text', id, text: typeof j.text === 'string' ? j.text : '', rect: rectOf(j, 300, 60), size: num(j.size, 48), color: color(j.color) }
    case 'stamp':
      return {
        kind: 'stamp',
        id,
        stamp: STAMPS.includes(j.stamp as StampKind) ? (j.stamp as StampKind) : 'star',
        rect: rectOf(j, 120, 120),
        color: color(j.color),
        text: typeof j.text === 'string' ? j.text : null,
      }
    case 'verse': {
      const t = j.transform && typeof j.transform === 'object' ? (j.transform as Json) : {}
      const s = j.style && typeof j.style === 'object' ? (j.style as Json) : {}
      if (isInt(j.surah) && isInt(j.fromAyah) && isInt(j.toAyah) && typeof j.datasetId === 'string' && typeof j.rangeSha256 === 'string') {
        return {
          kind: 'verse',
          id,
          ref: { surah: j.surah, fromAyah: j.fromAyah, toAyah: j.toAyah, datasetId: j.datasetId, rangeSha256: j.rangeSha256 },
          rect: rectOf(t, 1400, 200),
          size: num(s.size, 64),
          color: color(s.color),
        }
      }
      break
    }
  }
  return { kind: 'opaque', id, type: typeof j.kind === 'string' ? j.kind : 'unknown', rect: rectOf(j, 400, 120) }
}

/** A page from GET /teacher-boards/:id. */
export function parsePage(j: Json): BoardPage {
  const doc = j.document && typeof j.document === 'object' ? (j.document as Json) : {}
  const raw = Array.isArray(doc.elements) ? doc.elements : []
  return {
    id: typeof j.id === 'string' ? j.id : '',
    position: num(j.position, 0),
    layout: LAYOUTS.includes(j.layout as Layout) ? (j.layout as Layout) : 'plain',
    background: BACKGROUNDS.includes(j.background as Background) ? (j.background as Background) : 'white',
    elements: raw.filter((e): e is Json => !!e && typeof e === 'object' && !Array.isArray(e)).map(parseElement),
  }
}

/** The key of a verse's text: one request per range. */
export const verseKey = (r: VerseRef) => `${r.datasetId}/${r.surah}/${r.fromAyah}-${r.toAyah}`

/** The order the portal paints in: every highlighter stroke under everything else (§4.1). */
export function drawOrder(elements: BoardElement[]): BoardElement[] {
  const under = elements.filter((e) => e.kind === 'ink' && e.highlight)
  return [...under, ...elements.filter((e) => !(e.kind === 'ink' && e.highlight))]
}

// ---------------------------------------------------------------------------
// Verse text: GET /quran/ayahs (PD-29 P0-2), checked before it is ever drawn.

export interface AyahsAnswer {
  dataset: { id: string; attribution?: string }
  surah: { number: number; ayahCount?: number }
  rangeSha256: string
  ayahs: Array<{ ayah: number; text: string; basmala?: string | null }>
}

export type VerseLookup =
  | { status: 'loading' }
  | { status: 'ready'; text: AyahsAnswer }
  /** The dataset could not be reached, or did not answer with exactly the range. */
  | { status: 'unavailable' }
  /** The served range's SHA-256 (or dataset) is not the one the board stores: never redrawn silently. */
  | { status: 'changed' }

/** Exactly the reference's surah and ayat, every ayah once and in order. */
export function covers(answer: AyahsAnswer, ref: VerseRef): boolean {
  if (answer.surah?.number !== ref.surah || !Array.isArray(answer.ayahs)) return false
  if (answer.ayahs.length !== ref.toAyah - ref.fromAyah + 1) return false
  return answer.ayahs.every((a, i) => a.ayah === ref.fromAyah + i && typeof a.text === 'string')
}

/** What the board may show for a verse, given the dataset's answer (or its failure). */
export function lookupVerse(ref: VerseRef, answer: AyahsAnswer | undefined, failed: boolean): VerseLookup {
  if (failed) return { status: 'unavailable' }
  if (!answer) return { status: 'loading' }
  if (!covers(answer, ref)) return { status: 'unavailable' }
  if (answer.dataset?.id !== ref.datasetId || answer.rangeSha256 !== ref.rangeSha256) return { status: 'changed' }
  return { status: 'ready', text: answer }
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

/** "١٢" for 12: the ayah number inside its end-of-ayah sign. */
export const arabicIndic = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_INDIC[Number(d)] ?? d)

/** The ayat as one run, each closed by the end-of-ayah sign (U+06DD) and its number; never the Basmala. */
export const verseBody = (answer: AyahsAnswer) => answer.ayahs.map((a) => `${a.text} \u06DD${arabicIndic(a.ayah)}`).join(' ')
