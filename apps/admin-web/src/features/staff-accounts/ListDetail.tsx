import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '@/shared/components/Icon'
import { useWidePane } from '@/shared/components/RequestQueue'

/**
 * A list and the open item's sheet on one screen (staff accounts, roles).
 *
 * From 1100px the list keeps the start side and the open item's sheet stands
 * beside it; with nothing chosen the first item is shown, so the screen is
 * never half empty. Below that it is one pane at a time: the list, then the
 * item as its own screen with a way back.
 *
 * The open item lives in the URL (`?account=`, `?role=`), so a reload and the
 * browser's Back land where the reader was. Opening the first item adds a
 * step to the history (Back returns to the list on a phone); moving from one
 * item to another replaces it.
 */
export function useOpenItem(param: string): readonly [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const id = params.get(param)
  const open = useCallback(
    (next: string | null) => {
      setParams(
        (current) => {
          const p = new URLSearchParams(current)
          if (next) p.set(param, next)
          else p.delete(param)
          return p
        },
        { replace: next !== null && id !== null },
      )
    },
    [param, id, setParams],
  )
  return [id, open] as const
}

/** The item to show: the one the URL names, or on a wide screen the first of the list. */
export function useShown<T>(items: readonly T[], idOf: (item: T) => string, openId: string | null): T | null {
  const wide = useWidePane()
  const named = openId ? items.find((i) => idOf(i) === openId) : undefined
  return named ?? (openId === null && wide ? (items[0] ?? null) : null)
}

export function ListDetail({
  openId,
  list,
  detail,
  backLabel,
  onBack,
  missing,
}: {
  /** The id in the URL; null while the list alone is asked for. */
  openId: string | null
  list: ReactNode
  /** The open item's sheet; null when there is none to show. */
  detail: ReactNode | null
  backLabel: string
  onBack: () => void
  /** Said in the detail's place when the URL names an item the list does not hold. */
  missing: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const wide = useWidePane()
  const before = useRef(openId)
  // On one pane, opening an item is a change of screen: start at its top, with the way back in hand.
  useEffect(() => {
    if (before.current === openId) return
    before.current = openId
    if (wide || openId === null) return
    root.current?.scrollIntoView?.({ block: 'start' })
    back.current?.focus({ preventScroll: true })
  }, [openId, wide])

  return (
    <div ref={root} className={openId ? 'md md--open' : 'md'}>
      <div className="md__list">{list}</div>
      <div className="md__detail">
        {openId !== null && (
          <button ref={back} type="button" className="md__back" onClick={onBack}>
            <Icon name="arrowBack" size={15} />
            {backLabel}
          </button>
        )}
        {detail ?? (openId !== null && <p className="md__none">{missing}</p>)}
      </div>
    </div>
  )
}

/** A list row opens its item from anywhere on it with a pointer; the name is the button the keyboard uses. */
export function rowOpens(open: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    open()
  }
}

/** A headed part of the open item's sheet: its title, a count beside it, one quiet line of what it is. */
export function Part({
  id,
  title,
  count,
  hint,
  action,
  children,
}: {
  id: string
  title: string
  count?: ReactNode
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="md-part" aria-labelledby={id}>
      <div className="md-part__head">
        <h3 id={id} className="md-part__title">
          {title}
        </h3>
        {count !== undefined && count !== null && <span className="md-part__count">{count}</span>}
        {action && <span className="md-part__action">{action}</span>}
      </div>
      {hint && <p className="md-part__hint">{hint}</p>}
      {children}
    </section>
  )
}
