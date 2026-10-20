import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * A single-choice filter as a row of toggle buttons. Each option shows how many
 * rows it would leave, so an empty filter is visible before it is clicked.
 *
 * `chips` wraps onto several lines; `tabs` is one scrollable line with an
 * underline on the active option, for narrow panes where wrapping would push
 * the list down. A tab row that does not fit fades the edge that hides more,
 * and keeps the active tab in view.
 */
export interface FilterOption<T extends string> {
  value: T
  label: string
  count?: number
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  formatCount,
  variant = 'chips',
}: {
  options: readonly FilterOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The group's accessible name. */
  label: string
  formatCount?: (n: number) => string
  variant?: 'chips' | 'tabs'
}) {
  const tabs = variant === 'tabs'
  const ref = useRef<HTMLDivElement>(null)
  // Chips report hidden edges too: a pane may lay them out on one scrolling line.
  const edges = useOverflowEdges(ref, true)

  useEffect(() => {
    if (!tabs) return
    const active = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [tabs, value])

  return (
    <div
      ref={ref}
      className={tabs ? 'seg' : 'chips'}
      role="group"
      aria-label={label}
      data-more-start={edges.start || undefined}
      data-more-end={edges.end || undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={tabs ? 'seg__item' : 'chip'}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={tabs ? 'seg__count' : 'chip__count'}>
              {formatCount ? formatCount(o.count) : o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Whether a horizontally scrolling row hides content at its inline start or
 * end. Direction-agnostic: in RTL, scrollLeft runs from 0 to negative.
 */
function useOverflowEdges(ref: RefObject<HTMLElement>, enabled: boolean) {
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      const pos = Math.abs(el.scrollLeft)
      setEdges((prev) => {
        const next = { start: pos > 1, end: max - pos > 1 }
        return prev.start === next.start && prev.end === next.end ? prev : next
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [ref, enabled])
  return edges
}
