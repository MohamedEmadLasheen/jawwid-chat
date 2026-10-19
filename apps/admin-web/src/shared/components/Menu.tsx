import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

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
        <div className={`menu__popover menu__popover--${align}`} id={id} role="menu" aria-label={label}>
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
