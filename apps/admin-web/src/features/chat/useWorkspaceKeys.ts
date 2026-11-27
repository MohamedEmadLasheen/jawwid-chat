import { useEffect, useRef } from 'react'

/** Where a key belongs to what is being typed, not to the workspace. */
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]'
/** Anything floating over the workspace owns its own keys while it is open. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * The conversation workspace's keys, for people who answer all day:
 * J and K walk the list, Enter opens the row in focus (the row is a button or
 * a link, so the browser does that part), Escape goes back to the list.
 *
 * Matched by the physical key as well as the letter, so they work on an Arabic
 * layout. Never while typing in a field, with a modifier held, or while a
 * dialog, a menu or a picker is open. Ctrl/Cmd+K belongs to the global search.
 */
export function useWorkspaceKeys({ listId, onBack }: { listId: string; onBack: (() => void) | null }) {
  const back = useRef(onBack)
  back.current = onBack

  useEffect(() => {
    const rows = () => [...document.querySelectorAll<HTMLElement>(`#${listId} .conv-row`)]
    const focusRow = (el: HTMLElement | undefined) => {
      if (!el) return
      el.focus()
      el.scrollIntoView?.({ block: 'nearest' })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest(TYPING) || document.querySelector(OVERLAY)) return

      const key = e.key.toLowerCase()
      const down = key === 'j' || e.code === 'KeyJ'
      const up = key === 'k' || e.code === 'KeyK'
      if (down || up) {
        const all = rows()
        if (all.length === 0) return
        const focused = all.indexOf(document.activeElement as HTMLElement)
        const at = focused >= 0 ? focused : all.findIndex((r) => r.getAttribute('aria-current') === 'true')
        const next = at < 0 ? 0 : Math.min(all.length - 1, Math.max(0, at + (down ? 1 : -1)))
        e.preventDefault()
        focusRow(all[next])
        return
      }

      if (e.key === 'Escape' && back.current) {
        const at = rows().findIndex((r) => r.getAttribute('aria-current') === 'true')
        e.preventDefault()
        back.current()
        // The row that was open keeps the keyboard, so J and K carry on from it.
        setTimeout(() => focusRow(rows()[at]), 0)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [listId])
}
