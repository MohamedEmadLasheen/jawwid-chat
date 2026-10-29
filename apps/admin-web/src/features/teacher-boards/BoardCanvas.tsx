import { useEffect, useMemo, useRef, useState } from 'react'
import { PAGE_HEIGHT, PAGE_WIDTH, type BoardPage } from './board'
import { BOARD_FONT, QURAN_FONT, drawPage, type DrawOptions } from './render'

type QuranFont = 'loading' | 'ready' | 'failed'

/** Whether a face of the family is LOADED (FontFaceSet.check also says true for one that failed). */
export function familyLoaded(set: Iterable<FontFace>, family: string): boolean {
  for (const face of set) if (face.family.replace(/["']/g, '') === family && face.status === 'loaded') return true
  return false
}

/**
 * One board page, drawn read-only at the width it is given (16:9, sharp on a
 * high-density screen). A canvas does not load a font by itself, so the
 * board's two fonts are asked for first and the page is drawn again once they
 * arrive. A verse is drawn ONLY in Amiri Quran: until it has loaded, the verse
 * is a "loading" box, and if it fails to load the box says the text is
 * unavailable -- never a fallback face (review of #304).
 */
export function BoardCanvas({ page, verse, label, ariaLabel }: { page: BoardPage; ariaLabel: string } & DrawOptions) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [fonts, setFonts] = useState(0)
  const [width, setWidth] = useState(0)
  const [quran, setQuran] = useState<QuranFont>(() =>
    typeof document === 'undefined' || !document.fonts?.load ? 'ready' : familyLoaded(document.fonts, 'Amiri Quran') ? 'ready' : 'loading',
  )

  useEffect(() => {
    const set = typeof document !== 'undefined' ? document.fonts : undefined
    // No FontFaceSet (a test DOM): nothing can be loaded or checked; draw as asked.
    if (!set?.load) return
    let live = true
    void Promise.allSettled([set.load(`64px ${QURAN_FONT}`), set.load(`48px ${BOARD_FONT}`)]).then(() => {
      if (!live) return
      setQuran(familyLoaded(set, 'Amiri Quran') ? 'ready' : 'failed')
      setFonts((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [])

  const verseInFont = useMemo<DrawOptions['verse']>(
    () => (quran === 'ready' ? verse : () => ({ status: quran === 'failed' ? 'unavailable' : 'loading' })),
    [quran, verse],
  )

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const scale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const cssWidth = width || canvas.clientWidth || PAGE_WIDTH / 2
    canvas.width = Math.round(cssWidth * scale)
    canvas.height = Math.round((cssWidth * scale * PAGE_HEIGHT) / PAGE_WIDTH)
    ctx.setTransform(canvas.width / PAGE_WIDTH, 0, 0, canvas.height / PAGE_HEIGHT, 0, 0)
    drawPage(ctx, page, { verse: verseInFont, label })
  }, [page, verseInFont, label, fonts, width])

  return <canvas ref={ref} className="tb-canvas" role="img" aria-label={ariaLabel} />
}
