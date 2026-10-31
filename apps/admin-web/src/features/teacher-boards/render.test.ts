import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PALETTE, decodePoints, drawOrder, lookupVerse, parsePage, verseBody, type AyahsAnswer, type BoardElement, type VerseRef } from './board'
import { drawPage, drawVerse, isRtl, scaleAlpha, verseTokens, wrapLines, wrapTokens, type Ctx } from './render'
import { familyLoaded } from './BoardCanvas'

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
  expect: { drawOrder: string[]; notDrawn: string[]; images: string[]; points: Record<string, Array<[number, number, number]>> }
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
    // No source given for the image: its box says so.
    expect(drawn).toContain('LABEL:image:unavailable')
    // The verse in Amiri Quran, the rest in the board font.
    const verseCall = calls.find((c) => c.op === 'fillText' && String(c.args[0]).startsWith('SYNTHETIC'))!
    expect(String(verseCall.state.font)).toContain('Amiri Quran')
    const textCall = calls.find((c) => c.op === 'fillText' && c.args[0] === 'ممتاز')!
    expect(String(textCall.state.font)).toContain('IBM Plex Sans Arabic')
    // The highlighter is translucent; the pen is not.
    const strokes = calls.filter((c) => c.op === 'stroke' && (c.state.strokeStyle === '#e53935' || c.state.strokeStyle === '#1b1b1b'))
    expect(strokes.find((c) => c.state.strokeStyle === '#e53935')?.state.globalAlpha).toBe(0.35)
  })

  it('draws an image from its source into its box (PR-4), and a labelled box while it loads', () => {
    const source = { width: 40, height: 30 } as unknown as CanvasImageSource
    const raw = fixture.page.document.elements.find((e) => e.id === fixture.expect.images[0])!
    const loading = recorder()
    drawPage(loading.ctx, page, { verse: () => ({ status: 'loading' }), image: (id) => (id === raw.assetId ? { status: 'loading' } : { status: 'unavailable' }), label })
    expect(loading.texts()).toContain('LABEL:image:loading')
    const drawn = recorder()
    drawPage(drawn.ctx, page, { verse: () => ({ status: 'loading' }), image: () => ({ status: 'ready', source }), label })
    const img = drawn.calls.find((c) => c.op === 'drawImage')!
    expect(img.args).toEqual([source, raw.x, raw.y, raw.w, raw.h])
    expect(drawn.texts().some((t) => t.startsWith('LABEL:image'))).toBe(false)
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

describe('pause marks (review of #304)', () => {
  // Tanzil writes a pause mark (U+06D6-06DC) as its own space-separated word.
  const MARK = '\u06DB'
  const text = (words: string): AyahsAnswer => ({ ...fixture.ayahs, ayahs: [{ ayah: 2, text: words }] })

  it('a mark-only token goes with the word before it, so it is never drawn alone', () => {
    expect(verseTokens(`SYNTHETIC-A ${MARK} SYNTHETIC-B ${MARK} SYNTHETIC-C`)).toEqual([`SYNTHETIC-A ${MARK}`, `SYNTHETIC-B ${MARK}`, 'SYNTHETIC-C'])
    expect(verseTokens(`${MARK} SYNTHETIC-A`)).toEqual([MARK, 'SYNTHETIC-A'])
  })

  it('no line starts with a mark, and every justified word carries its marks', () => {
    const words = Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? MARK : `SYNTHETIC-${i}`)).join(' ')
    const { ctx, texts } = recorder()
    const lines = wrapTokens(ctx, verseTokens(words), 200)
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) expect(line[0]!.startsWith(MARK)).toBe(false)
    drawVerse(ctx, { x: 0, y: 0, w: 200, h: 2000 }, 40, '#000000', text(words))
    const drawn = texts()
    expect(drawn.length).toBeGreaterThan(0)
    for (const t of drawn) {
      expect(t.trim().startsWith(MARK)).toBe(false)
      expect(t.trim()).not.toBe(MARK)
    }
    expect(drawn.join(' ')).toContain(`SYNTHETIC-1 ${MARK}`)
  })
  it('the clip reaches as high as the first line draws: a mark over the line box is not cut off', () => {
    const { ctx, calls } = recorder()
    const tall = new Proxy(ctx, {
      get: (t, prop: string) => (prop === 'measureText' ? (x: string) => ({ width: x.length * 10, actualBoundingBoxAscent: x.includes(MARK) ? 40 * 1.28 : 40 * 0.8 }) : (t as unknown as Record<string, unknown>)[prop]),
      set: (t, prop: string, v) => (((t as unknown as Record<string, unknown>)[prop] = v), true),
    }) as unknown as Ctx
    drawVerse(tall, { x: 0, y: 100, w: 2000, h: 200 }, 40, '#000000', text(`SYNTHETIC-A ${MARK} SYNTHETIC-B`))
    const clip = calls.find((c) => c.op === 'rect')!
    const clipTop = clip.args[1] as number
    const markTop = 100 + (40 * 1.9) / 2 - 40 * 1.28
    expect(clipTop).toBeLessThan(markTop)
  })
})

describe('the Quran font gate', () => {
  const face = (family: string, status: FontFaceLoadStatus) => ({ family, status }) as FontFace
  it('is open only when an Amiri Quran face has LOADED (a failed face does not count)', () => {
    expect(familyLoaded([face('"Amiri Quran"', 'loaded')], 'Amiri Quran')).toBe(true)
    expect(familyLoaded([face('Amiri Quran', 'error')], 'Amiri Quran')).toBe(false)
    expect(familyLoaded([face('Amiri Quran', 'loading'), face('IBM Plex Sans Arabic', 'loaded')], 'Amiri Quran')).toBe(false)
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
