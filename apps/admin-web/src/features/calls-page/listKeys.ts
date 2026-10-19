import type { KeyboardEvent } from 'react'

/**
 * Arrow-key movement between the focusable items of a list (each marked
 * `data-cp-item`), in addition to Tab. Home and End jump to the ends.
 */
export function onListKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-cp-item]:not(:disabled)')]
  if (items.length === 0) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  let next = at
  if (event.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(items.length - 1, at + 1)
  if (event.key === 'ArrowUp') next = at < 0 ? 0 : Math.max(0, at - 1)
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = items.length - 1
  if (next === at) return
  event.preventDefault()
  items[next]!.focus()
}
