import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './menu.css'

export interface MenuItem {
  key: string
  label: string
  icon?: IconName
  danger?: boolean
  onSelect: () => void
}

/**
 * A button that opens a short list of actions. Escape and a click outside
 * close it, focus returns to the button, and the arrow keys move between
 * items (wrapping), as in the rail's menus.
 *
 * `header` renders above the items (the message menu's reaction row).
 *
 * A menu that would run past the bottom of the pane it scrolls in (a chat row
 * near the end of the list, a message near the composer) opens upwards
 * instead, when there is more room above; one taller than either side scrolls
 * within the room it has, so no item is ever cut off.
 */
export function Menu({
  label,
  items,
  icon = 'more',
  header,
  align = 'end',
  className,
}: {
  label: string
  items: MenuItem[]
  icon?: IconName
  header?: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)
  const popover = useRef<HTMLDivElement>(null)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) {
      setUp(false)
      setMaxHeight(undefined)
      return
    }
    const pop = popover.current
    const anchor = button.current
    if (!pop || !anchor) return
    const bounds = clipBounds(anchor)
    const a = anchor.getBoundingClientRect()
    const height = pop.getBoundingClientRect().height
    const below = bounds.bottom - a.bottom - 8
    const above = a.top - bounds.top - 8
    const flip = height > below && above > below
    setUp(flip)
    const room = flip ? above : below
    // Only cap a menu that does not fit; a layout with no room measured (tests) is left alone.
    setMaxHeight(height > room && room > 120 ? room : undefined)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    // The first item takes focus, so the keyboard lands inside the menu.
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length
    all[next]?.focus()
  }

  return (
    <div className={className ? `menu ${className}` : 'menu'} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="btn btn--ghost btn--icon btn--sm menu__button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <Icon name={icon} size={18} />
      </button>
      {open && (
        <div
          ref={popover}
          className={`menu__popover menu__popover--${align}${up ? ' menu__popover--up' : ''}`}
          style={maxHeight ? { maxBlockSize: maxHeight, overflowY: 'auto' } : undefined}
          id={id}
          role="menu"
          aria-label={label}
        >
          {header?.(() => close())}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={item.danger ? 'menu__item menu__item--danger' : 'menu__item'}
              onClick={(e) => {
                e.stopPropagation()
                close()
                item.onSelect()
              }}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The visible box a popover can show in: the nearest scrolling ancestor, within the viewport. */
function clipBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') {
      const r = p.getBoundingClientRect()
      top = Math.max(top, r.top)
      bottom = Math.min(bottom, r.bottom)
      break
    }
  }
  return { top, bottom }
}
