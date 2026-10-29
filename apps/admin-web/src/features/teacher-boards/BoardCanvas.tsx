import { useEffect, useRef, useState } from 'react'
import { PAGE_HEIGHT, PAGE_WIDTH, type BoardPage } from './board'
import { BOARD_FONT, QURAN_FONT, drawPage, type DrawOptions } from './render'

/**
 * One board page, drawn read-only at the width it is given (16:9, sharp on a
 * high-density screen). A canvas does not load a font by itself, so the
 * board's two fonts are asked for first and the page is drawn again once they
 * arrive: a verse is never left in a fallback face.
 */
export function BoardCanvas({ page, verse, label, ariaLabel }: { page: BoardPage; ariaLabel: string } & DrawOptions) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [fonts, setFonts] = useState(0)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const set = typeof document !== 'undefined' ? document.fonts : undefined
    if (!set?.load) return
    let live = true
    void Promise.allSettled([set.load(`64px ${QURAN_FONT}`), set.load(`48px ${BOARD_FONT}`)]).then(() => {
      if (live) setFonts((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [])

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
    drawPage(ctx, page, { verse, label })
  }, [page, verse, label, fonts, width])

  return <canvas ref={ref} className="tb-canvas" role="img" aria-label={ariaLabel} />
}
