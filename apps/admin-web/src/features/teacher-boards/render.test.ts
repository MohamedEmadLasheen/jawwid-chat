import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PALETTE, decodePoints, drawOrder, lookupVerse, parsePage, verseBody, type AyahsAnswer, type BoardElement, type VerseRef } from './board'
import { drawPage, isRtl, scaleAlpha, wrapLines, type Ctx } from './render'

/**
 * PD-39: the staff viewer reads a board exactly as the teacher's portal writes
 * it. The page comes from the fixture the portal and the API test too
 * (test/fixtures/whiteboards/page-every-kind.json): Flutter writes it back
 * unchanged, the API accepts it, and this draws it. jsdom has no canvas, so
 * the drawing is checked on a recorder. The verse text is SYNTHETIC: a test
 * proves the plumbing, the verified dataset proves the words.
 */
const ROOT = resolve(__dirname, '../../../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/whiteboards/page-every-kind.json'), 'utf8')) as {
  page: Record<string, unknown> & { document: { elements: Array<Record<string, unknown>> } }
  expect: { drawOrder: string[]; notDrawn: string[]; points: Record<string, Array<[number, number, number]>> }
  palette: Record<string, string>
  ayahs: AyahsAnswer
}

interface Call {
  op: string
  args: unknown[]
  state: { fillStyle: unknown; strokeStyle: unknown; font: unknown; globalAlpha: unknown }
}

/** A 2D context that records what is drawn; a character is 10 units wide. */
function recorder() {
  const calls: Call[] = []
  const state: Record<string, unknown> = { fillStyle: '', strokeStyle: '', font: '', globalAlpha: 1 }
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 10 })
      return (...args: unknown[]) => {
        calls.push({ op: prop, args, state: { fillStyle: target.fillStyle, strokeStyle: target.strokeStyle, font: target.font, globalAlpha: target.globalAlpha } })
      }
    },
    set(target, prop: string, value) {
      target[prop] = value
      return true
    },
  }) as unknown as Ctx
  return { ctx, calls, texts: () => calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])) }
}

const page = parsePage(fixture.page)
const verseEl = page.elements.find((e): e is Extract<BoardElement, { kind: 'verse' }> => e.kind === 'verse')!
const label = (e: BoardElement, found?: { status: string }) => `LABEL:${e.kind === 'opaque' ? e.type : e.kind}:${found?.status ?? ''}`

describe('the shared fixture, read by the staff viewer', () => {
  it('reads every element as the portal does; only what it cannot draw is a labelled box', () => {
    expect(page.layout).toBe('arabic_lines')
    expect(page.background).toBe('cream')
    expect(page.elements.map((e) => e.id)).toEqual(fixture.page.document.elements.map((e) => e.id))
    expect(page.elements.filter((e) => e.kind === 'opaque').map((e) => e.id)).toEqual(fixture.expect.notDrawn)
  })

  it('decodes the packed stroke points to the fixture points', () => {
    for (const [id, want] of Object.entries(fixture.expect.points)) {
      const raw = fixture.page.document.elements.find((e) => e.id === id)!
      const got = decodePoints(raw.points as string)
      expect(got).toHaveLength(want.length)
      got.forEach((p, i) => {
        const [x, y, pressure] = want[i]!
        expect(p.x).toBeCloseTo(x, 1)
        expect(p.y).toBeCloseTo(y, 1)
        expect(p.pressure).toBeCloseTo(pressure / 255, 9)
      })
    }
    expect(decodePoints('not base64!')).toEqual([])
    expect(decodePoints('AAAA')).toEqual([])
  })

  it('paints the highlighter under everything else, and the page colours are the portal\'s', () => {
    expect(drawOrder(page.elements).map((e) => e.id)).toEqual(fixture.expect.drawOrder)
    expect(PALETTE).toEqual(fixture.palette)
    // The Arabic-lines base rule is the portal's 1.6 x the rule colour, the guide 0.6 x.
    expect(scaleAlpha(PALETTE.ruleOnLight, 1.6)).toBe('#5b708372')
    expect(scaleAlpha(PALETTE.ruleOnDark, 10)).toBe('#ffffffff')
  })

  it('draws the page: its background, the ink, the words, and the verse once its text is exactly the reference', () => {
    const { ctx, calls, texts } = recorder()
    drawPage(ctx, page, { verse: (ref) => lookupVerse(ref, fixture.ayahs, false), label })
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 1920, 1080], state: { fillStyle: PALETTE.cream } })
    const drawn = texts()
    expect(drawn).toContain('SYNTHETIC-BASMALA')
    // Every ayah, each closed by U+06DD and its number in Arabic-Indic digits.
    for (let a = 1; a <= 7; a++) expect(drawn.join(' ')).toContain(`SYNTHETIC-${a} ۝${'٠١٢٣٤٥٦٧٨٩'[a]}`)
    expect(drawn).toContain('اقرأ الآيات مرتين')
    expect(drawn).toContain('ممتاز')
    expect(drawn).toContain('LABEL:image:')
    // The verse in Amiri Quran, the rest in the board font.
    const verseCall = calls.find((c) => c.op === 'fillText' && String(c.args[0]).startsWith('SYNTHETIC'))!
    expect(String(verseCall.state.font)).toContain('Amiri Quran')
    const textCall = calls.find((c) => c.op === 'fillText' && c.args[0] === 'ممتاز')!
    expect(String(textCall.state.font)).toContain('IBM Plex Sans Arabic')
    // The highlighter is translucent; the pen is not.
    const strokes = calls.filter((c) => c.op === 'stroke' && (c.state.strokeStyle === '#e53935' || c.state.strokeStyle === '#1b1b1b'))
    expect(strokes.find((c) => c.state.strokeStyle === '#e53935')?.state.globalAlpha).toBe(0.35)
  })

  it('never draws a verse text that is not exactly its reference, and says why', () => {
    const cases: Array<[string, AyahsAnswer | undefined, boolean]> = [
      ['changed', { ...fixture.ayahs, rangeSha256: 'b'.repeat(64) }, false],
      ['changed', { ...fixture.ayahs, dataset: { id: 'another-dataset' } }, false],
      ['unavailable', { ...fixture.ayahs, ayahs: fixture.ayahs.ayahs.slice(1) }, false],
      ['unavailable', { ...fixture.ayahs, surah: { number: 2 } }, false],
      ['unavailable', undefined, true],
      ['loading', undefined, false],
    ]
    for (const [status, answer, failed] of cases) {
      const { ctx, texts } = recorder()
      drawPage(ctx, page, { verse: (ref) => lookupVerse(ref, answer, failed), label })
      expect(texts().some((t) => t.includes('SYNTHETIC'))).toBe(false)
      expect(texts()).toContain(`LABEL:verse:${status}`)
    }
  })

  it('reads a verse reference only: an element carrying text is never shown as Quran', () => {
    const ref: VerseRef = verseEl.ref
    expect(Object.keys(ref).sort()).toEqual(['datasetId', 'fromAyah', 'rangeSha256', 'surah', 'toAyah'])
    expect(verseBody(fixture.ayahs)).not.toContain('BASMALA')
  })
})

describe('text', () => {
  it('reads right to left from the first strong character, as the portal does', () => {
    expect(isRtl('اقرأ')).toBe(true)
    expect(isRtl('123 اقرأ')).toBe(true)
    expect(isRtl('Read اقرأ')).toBe(false)
  })

  it('wraps on words, never inside one, and keeps line breaks', () => {
    const { ctx } = recorder()
    expect(wrapLines(ctx, 'one two three', 80)).toEqual(['one two', 'three'])
    expect(wrapLines(ctx, 'unbreakableword', 30)).toEqual(['unbreakableword'])
    expect(wrapLines(ctx, 'a\nb', 500)).toEqual(['a', 'b'])
  })
})

describe('the Quran font', () => {
  it('is the very file the teacher portal bundles', () => {
    const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
    const here = sha(resolve(__dirname, '../../assets/fonts/AmiriQuran.ttf'))
    expect(here).toBe('e2a47644762d16bdfb6d33e0d8db8c6ff30beae84150ef5a705316bbd829455c')
    expect(sha(resolve(ROOT, 'assets/fonts/AmiriQuran.ttf'))).toBe(here)
  })
})
