import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'

/**
 * A pane width the user can change, remembered per browser. Clamped on read,
 * so a width saved on a wide screen cannot break a narrower one.
 */
export function useResizableWidth(key: string, initial: number, min: number, max: number) {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, Math.round(n))), [min, max])
  const [width, setWidthState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      return saved ? clamp(saved) : initial
    } catch {
      return initial
    }
  })
  const setWidth = useCallback(
    (n: number) => {
      const next = clamp(n)
      setWidthState(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // Not remembered; still works.
      }
    },
    [key, clamp],
  )
  return { width, setWidth, min, max, initial }
}

const STEP = 16

/**
 * The divider between two panes. Drag it, or focus it and use the arrow keys
 * (Home/End jump to the limits, Enter restores the default). It sits at the
 * pane's inline end, so in RTL the same physical drag widens the opposite way.
 */
export function Splitter({
  width,
  setWidth,
  min,
  max,
  initial,
  label,
  controls,
}: ReturnType<typeof useResizableWidth> & { label: string; controls: string }) {
  const { dir } = useI18n()
  const drag = useRef<{ x: number; w: number } | null>(null)
  const sign = dir === 'rtl' ? -1 : 1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setWidth(drag.current.w + sign * (e.clientX - drag.current.x))
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.shiftKey ? STEP * 4 : STEP
    if (e.key === 'ArrowRight') setWidth(width + sign * by)
    else if (e.key === 'ArrowLeft') setWidth(width - sign * by)
    else if (e.key === 'Home') setWidth(min)
    else if (e.key === 'End') setWidth(max)
    else if (e.key === 'Enter') setWidth(initial)
    else return
    e.preventDefault()
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setWidth(initial)}
      onKeyDown={onKeyDown}
    >
      <span className="splitter__grip" aria-hidden="true" />
    </div>
  )
}
