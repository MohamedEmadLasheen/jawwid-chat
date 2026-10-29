import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PALETTE,
  drawOrder,
  isDarkBackground,
  verseBody,
  type AyahsAnswer,
  type BoardElement,
  type BoardPage,
  type Rect,
  type StrokePoint,
  type VerseLookup,
  type VerseRef,
} from './board'

/**
 * PD-39: a board page drawn for staff, read-only, the way the teacher's portal
 * paints it (lib/features/whiteboards/presentation/board_painter.dart):
 * background and rulings, every highlighter stroke, then the rest in order.
 * Pure drawing on a 2D context in page units (1920 x 1080); the caller scales.
 */

export const BOARD_FONT = "'IBM Plex Sans Arabic', sans-serif"
export const QURAN_FONT = "'Amiri Quran', serif"

/** What the canvas API this file uses; a test passes a recorder. */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'bezierCurveTo'
  | 'arc'
  | 'arcTo'
  | 'ellipse'
  | 'rect'
  | 'fill'
  | 'stroke'
  | 'clip'
  | 'fillText'
  | 'measureText'
  | 'setLineDash'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'globalAlpha'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'direction'
>

export interface DrawOptions {
  /** The verse's text, as checked against its reference (board.ts lookupVerse). */
  verse: (ref: VerseRef) => VerseLookup
  /** The words on a box this viewer does not draw: a verse not ready, an image, a newer kind. */
  label: (element: BoardElement, lookup?: VerseLookup) => string
}

export function drawPage(ctx: Ctx, page: BoardPage, opts: DrawOptions): void {
  const dark = isDarkBackground(page.background)
  drawBackground(ctx, page)
  for (const e of drawOrder(page.elements)) drawElement(ctx, e, dark, PALETTE[page.background], opts)
}

function drawBackground(ctx: Ctx, page: BoardPage) {
  ctx.fillStyle = PALETTE[page.background]
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  const rule = isDarkBackground(page.background) ? PALETTE.ruleOnDark : PALETTE.ruleOnLight
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  ctx.save()
  ctx.strokeStyle = rule
  ctx.lineWidth = 1.5
  switch (page.layout) {
    case 'plain':
      break
    case 'ruled':
    case 'narrow_ruled': {
      const gap = page.layout === 'ruled' ? 72 : 48
      for (let y = gap; y < PAGE_HEIGHT; y += gap) line(0, y, PAGE_WIDTH, y)
      break
    }
    case 'grid':
      for (let x = 60; x < PAGE_WIDTH; x += 60) line(x, 0, x, PAGE_HEIGHT)
      for (let y = 60; y < PAGE_HEIGHT; y += 60) line(0, y, PAGE_WIDTH, y)
      break
    case 'arabic_lines': {
      // A baseline and a lighter, dashed upper guide per band (the letter's body).
      const band = 135
      const body = 45
      for (let y = band; y < PAGE_HEIGHT; y += band) {
        ctx.strokeStyle = scaleAlpha(rule, 0.6)
        ctx.lineWidth = 1
        ctx.setLineDash([14, 10])
        line(0, y - body, PAGE_WIDTH, y - body)
        ctx.setLineDash([])
        ctx.strokeStyle = scaleAlpha(rule, 1.6)
        ctx.lineWidth = 2
        line(0, y, PAGE_WIDTH, y)
      }
      break
    }
  }
  ctx.restore()
}

/** #rrggbbaa with its alpha times [k] (at most opaque). */
export function scaleAlpha(hex8: string, k: number): string {
  const a = Math.min(255, Math.round(parseInt(hex8.slice(7, 9), 16) * k))
  return `${hex8.slice(0, 7)}${a.toString(16).padStart(2, '0')}`
}

function drawElement(ctx: Ctx, e: BoardElement, dark: boolean, background: string, opts: DrawOptions) {
  switch (e.kind) {
    case 'ink':
      return drawInk(ctx, e.points, e.color, e.width, e.highlight)
    case 'shape':
      return drawShape(ctx, e)
    case 'line':
      return drawLine(ctx, e)
    case 'text':
      return drawText(ctx, e.text, e.rect, e.size, e.color)
    case 'stamp':
      return drawStamp(ctx, e, background)
    case 'verse': {
      const found = opts.verse(e.ref)
      if (found.status === 'ready') return drawVerse(ctx, e.rect, e.size, e.color, found.text)
      return drawPlaceholder(ctx, e.rect, dark, opts.label(e, found))
    }
    case 'opaque':
      return drawPlaceholder(ctx, e.rect, dark, opts.label(e))
  }
}

/** A pen stroke widens with pressure; a mouse stroke (even pressure) and every highlighter stroke is one smooth path. */
function drawInk(ctx: Ctx, pts: StrokePoint[], color: string, width: number, highlight: boolean) {
  const [first] = pts
  const last = pts[pts.length - 1]
  if (!first || !last) return
  ctx.save()
  ctx.globalAlpha = highlight ? 0.35 : 1
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(first.x, first.y, width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else if (highlight || pts.every((p) => Math.abs(p.pressure - first.pressure) < 0.02)) {
    // Quadratic curves through the midpoints: a hand-drawn line without corners.
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    pts.forEach((p, i) => {
      const next = pts[i + 1]
      if (i === 0 || !next) return
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2)
    })
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  } else {
    pts.forEach((p, i) => {
      const prev = pts[i - 1]
      if (!prev) return
      ctx.lineWidth = width * (0.45 + (1.1 * (prev.pressure + p.pressure)) / 2)
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    })
  }
  ctx.restore()
}

function drawShape(ctx: Ctx, s: Extract<BoardElement, { kind: 'shape' }>) {
  const { x, y, w, h } = s.rect
  ctx.save()
  ctx.beginPath()
  if (s.shape === 'rect') ctx.rect(x, y, w, h)
  else if (s.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
  else {
    ctx.moveTo(x + w / 2, y)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x, y + h)
    ctx.closePath()
  }
  if (s.fill) {
    ctx.fillStyle = s.fill
    ctx.fill()
  }
  ctx.strokeStyle = s.stroke
  ctx.lineWidth = s.width
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.restore()
}

function drawLine(ctx: Ctx, l: Extract<BoardElement, { kind: 'line' }>) {
  ctx.save()
  ctx.strokeStyle = l.color
  ctx.fillStyle = l.color
  ctx.lineWidth = l.width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(l.x1, l.y1)
  ctx.lineTo(l.x2, l.y2)
  ctx.stroke()
  const head = (tx: number, ty: number, fx: number, fy: number) => {
    const a = Math.atan2(ty - fy, tx - fx)
    const len = 14 + l.width * 3
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(tx - len * Math.cos(a - 0.45), ty - len * Math.sin(a - 0.45))
    ctx.lineTo(tx - len * Math.cos(a + 0.45), ty - len * Math.sin(a + 0.45))
    ctx.closePath()
    ctx.fill()
  }
  if (l.arrow) {
    head(l.x2, l.y2, l.x1, l.y1)
    if (l.bothEnds) head(l.x1, l.y1, l.x2, l.y2)
  }
  ctx.restore()
}

/** Right to left when the first strong character is Arabic (or Hebrew), as the portal decides. */
export function isRtl(text: string): boolean {
  for (const ch of text) {
    const r = ch.codePointAt(0) ?? 0
    if ((r >= 0x0590 && r <= 0x08ff) || (r >= 0xfb1d && r <= 0xfefc)) return true
    if ((r >= 0x41 && r <= 0x5a) || (r >= 0x61 && r <= 0x7a) || (r >= 0xc0 && r <= 0x24f)) return false
  }
  return false
}

/** Words onto lines no wider than [maxWidth]; a word is never split, a line break is kept. */
export function wrapLines(ctx: Pick<Ctx, 'measureText'>, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line)
        line = word
      } else {
        line = next
      }
    }
    out.push(line)
  }
  return out
}

function drawText(ctx: Ctx, text: string, rect: Rect, size: number, color: string) {
  const rtl = isRtl(text)
  ctx.save()
  ctx.font = `${size}px ${BOARD_FONT}`
  ctx.fillStyle = color
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.textAlign = rtl ? 'right' : 'left'
  ctx.textBaseline = 'middle'
  const lh = size * 1.4
  wrapLines(ctx, text, rect.w).forEach((line, i) => ctx.fillText(line, rtl ? rect.x + rect.w : rect.x, rect.y + lh * (i + 0.5)))
  ctx.restore()
}

/**
 * A verse in its box (§4.3): the Basmala on its own centred line (ayah 1 of
 * the surahs that carry it), then the ayat right to left, justified, each
 * closed by U+06DD with its number, never splitting a word, and never drawn
 * past its box.
 */
export function drawVerse(ctx: Ctx, rect: Rect, size: number, color: string, text: AyahsAnswer) {
  const lh = size * 1.9
  const pad = size * 0.25
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2)
  ctx.clip()
  ctx.font = `${size}px ${QURAN_FONT}`
  ctx.fillStyle = color
  ctx.direction = 'rtl'
  ctx.textBaseline = 'middle'
  let y = rect.y
  const basmala = text.ayahs[0]?.basmala
  if (basmala) {
    ctx.textAlign = 'center'
    for (const line of wrapLines(ctx, basmala, rect.w)) {
      ctx.fillText(line, rect.x + rect.w / 2, y + lh / 2)
      y += lh
    }
  }
  ctx.textAlign = 'right'
  const lines = wrapLines(ctx, verseBody(text), rect.w)
  lines.forEach((line, i) => {
    const words = line.split(' ')
    const last = i === lines.length - 1
    if (last || words.length < 2) {
      ctx.fillText(line, rect.x + rect.w, y + lh / 2)
    } else {
      // Justified: the words placed right to left with the spare width shared between them.
      const widths = words.map((w) => ctx.measureText(w).width)
      const gap = (rect.w - widths.reduce((a, b) => a + b, 0)) / (words.length - 1)
      let x = rect.x + rect.w
      words.forEach((w, k) => {
        ctx.fillText(w, x, y + lh / 2)
        x -= (widths[k] ?? 0) + gap
      })
    }
    y += lh
  })
  ctx.restore()
}

function roundRect(ctx: Ctx, { x, y, w, h }: Rect, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The reward stamps (§4.1): the icons as simple shapes, the words in our font. */
function drawStamp(ctx: Ctx, s: Extract<BoardElement, { kind: 'stamp' }>, background: string) {
  const { x, y, w, h } = s.rect
  ctx.save()
  ctx.fillStyle = s.color
  ctx.strokeStyle = s.color
  const side = Math.min(w, h) * (20 / 24) // a Material glyph's live area in its em
  const cx = x + w / 2
  const cy = y + h / 2
  const r = side / 2
  switch (s.stamp) {
    case 'star': {
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 === 0 ? r : r * 0.45
        if (i === 0) ctx.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
        else ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'check':
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = background
      ctx.lineWidth = side * 0.1
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.45, cy + r * 0.02)
      ctx.lineTo(cx - r * 0.1, cy + r * 0.36)
      ctx.lineTo(cx + r * 0.5, cy - r * 0.3)
      ctx.stroke()
      break
    case 'heart':
      ctx.beginPath()
      ctx.moveTo(cx, cy + r * 0.85)
      ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.05, cx - r * 0.6, cy - r * 1.05, cx, cy - r * 0.45)
      ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.05, cx + r * 1.3, cy - r * 0.05, cx, cy + r * 0.85)
      ctx.closePath()
      ctx.fill()
      break
    case 'thumbsUp':
      // The cuff, then the hand with its raised thumb.
      ctx.fillRect(cx - r, cy - r * 0.1, r * 0.35, r * 0.95)
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.55, cy - r * 0.1)
      ctx.lineTo(cx - r * 0.1, cy - r * 0.95)
      ctx.lineTo(cx + r * 0.08, cy - r * 0.85)
      ctx.lineTo(cx - r * 0.02, cy - r * 0.25)
      ctx.lineTo(cx + r * 0.85, cy - r * 0.25)
      ctx.lineTo(cx + r * 0.95, cy - r * 0.1)
      ctx.lineTo(cx + r * 0.6, cy + r * 0.85)
      ctx.lineTo(cx - r * 0.55, cy + r * 0.85)
      ctx.closePath()
      ctx.fill()
      break
    default: {
      // A praise stamp: its words in a tinted, rounded frame.
      roundRect(ctx, s.rect, h * 0.25)
      ctx.globalAlpha = 0.12
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = Math.max(3, h * 0.06)
      ctx.stroke()
      const text = s.text ?? ''
      const rtl = isRtl(text)
      ctx.font = `${h * 0.5}px ${BOARD_FONT}`
      ctx.direction = rtl ? 'rtl' : 'ltr'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cx, cy)
    }
  }
  ctx.restore()
}

/** A box with dashed edges and the reason it is not drawn. */
function drawPlaceholder(ctx: Ctx, rect: Rect, dark: boolean, label: string) {
  const ink = dark ? PALETTE.placeholderOnDark : PALETTE.placeholderOnLight
  ctx.save()
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.08
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.globalAlpha = 1
  ctx.strokeStyle = ink
  ctx.lineWidth = 2
  ctx.setLineDash([14, 10])
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  ctx.setLineDash([])
  const rtl = isRtl(label)
  ctx.font = `32px ${BOARD_FONT}`
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = wrapLines(ctx, label, Math.max(40, rect.w - 24))
  const lh = 32 * 1.4
  const top = rect.y + rect.h / 2 - (lines.length * lh) / 2
  lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.w / 2, top + lh * (i + 0.5)))
  ctx.restore()
}
