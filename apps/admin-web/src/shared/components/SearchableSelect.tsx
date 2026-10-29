import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { matchesQuery } from '@/shared/text/matchText'
import { Icon } from './Icon'
import './searchable-select.css'

export interface SelectOption {
  value: string
  label: string
  /** Secondary text shown under the label and searched with it (an e-mail, a role). */
  hint?: string
  disabled?: boolean
  /** A divider between groups of options (a `<option disabled>────</option>`); never chosen. */
  separator?: boolean
}

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'children' | 'type' | 'role' | 'list' | 'size'
>

export interface SearchableSelectProps extends InputProps {
  /** A number is compared as its text, as a <select> does. */
  value: string | number
  onValueChange: (value: string) => void
  /** The choices; `<option>` children work too, so a `<select>` converts in place. */
  options?: SelectOption[]
  children?: ReactNode
  /**
   * Whether the clear (x) button may empty the choice. Set false on a picker
   * that saves as soon as it changes: one stray click must not unassign.
   */
  clearable?: boolean
  'data-testid'?: string
}

const PAGE = 10
const POPUP = 'ss__popup'

/**
 * True when an event belongs to an open picker: its list (portalled to the
 * body, so outside the DOM of whatever hosts the picker) or its text box while
 * the list is open. A popover or menu that closes on an outside pointerdown, or
 * takes Escape at the document, asks this first.
 */
export function belongsToOpenPicker(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(`.${POPUP}`)) return true
  return target.matches('.ss__input[aria-expanded="true"]')
}

/**
 * The one picker of the Admin Web: an ARIA 1.2 combobox (a text box with a
 * listbox popup), so every list can be typed into as well as chosen from.
 *
 * Typing filters by every word, ignoring harakat, tatweel and the alef / yeh /
 * teh marbuta spellings (see matchText). Arrows and PageUp/PageDown move
 * through the list, Home/End too until something is typed (then they move the
 * caret), Enter picks, Escape closes the list (and only a second Escape reaches
 * the dialog around it). Leaving the box without picking keeps the old value.
 *
 * The popup is portalled to the body with fixed positioning, so a dialog's
 * scroll box cannot clip it and a wrapping <label> cannot swallow its clicks;
 * its clicks do not bubble on to the host's React handlers either.
 *
 * Drop-in for `<select>`: same `className`, `id`, `aria-*`, `data-testid`,
 * `disabled`, `required` and `name`, and the chosen value is exposed as
 * `data-value` on the text box.
 */
export function SearchableSelect({
  value: rawValue,
  onValueChange,
  options: optionsProp,
  children,
  clearable = true,
  className = 'select',
  disabled,
  required,
  name,
  placeholder,
  onBlur,
  onFocus,
  onKeyDown,
  ...rest
}: SearchableSelectProps) {
  const { t } = useI18n()
  const value = String(rawValue)
  const listId = useId()
  const optionId = (i: number) => `${listId}-o${i}`
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const options = useMemo(() => optionsProp ?? optionsFromChildren(children), [optionsProp, children])
  const selected = options.find((o) => o.value === value && !o.separator)
  // An empty value shows as a placeholder (the "—" or "All …" option), so typing starts clean.
  const selectedLabel = value === '' ? '' : (selected?.label ?? '')
  const empty = options.find((o) => o.value === '' && !o.separator)

  const [open, setOpen] = useState(false)
  /** What was typed since the list opened; null = nothing yet, show everything. */
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  const filter = (q: string | null) =>
    q ? options.filter((o) => !o.separator && matchesQuery(q, o.label, o.hint)) : options
  const shown = useMemo(() => filter(query), [options, query]) // eslint-disable-line react-hooks/exhaustive-deps
  const choosable = (o: SelectOption | undefined) => !!o && !o.disabled && !o.separator
  const enabled = (i: number) => i >= 0 && i < shown.length && choosable(shown[i])

  // Required: the text box always holds a label, so validity follows the value.
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && value === '' ? t('common.select.required') : '')
  }, [required, value, t])

  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < shown.length; i += step) if (enabled(i)) return i
    return -1
  }

  const openList = (at?: 'selected' | 'first' | 'last') => {
    if (disabled) return
    setOpen(true)
    const sel = shown.findIndex((o) => o.value === value && choosable(o))
    if (at === 'last') setActive(firstEnabled(shown.length - 1, -1))
    else if (at === 'first' || sel < 0) setActive(firstEnabled(0, 1))
    else setActive(sel)
  }

  const close = () => {
    setOpen(false)
    setQuery(null)
    setActive(-1)
  }

  const choose = (option: SelectOption | undefined) => {
    if (!option || !choosable(option)) return
    close()
    if (option.value !== value) onValueChange(option.value)
  }

  // Keep the active option in view.
  useEffect(() => {
    if (!open || active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  const typed = query !== null && query !== ''

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    const move = (to: number) => {
      e.preventDefault()
      if (to >= 0) setActive(to)
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (open) move(firstEnabled(active + 1, 1))
        else openList(e.altKey ? 'selected' : undefined)
        return
      case 'ArrowUp':
        e.preventDefault()
        if (!open) openList(e.altKey ? 'selected' : 'last')
        else if (e.altKey) choose(shown[active])
        else move(firstEnabled(Math.max(active - 1, 0), -1))
        return
      case 'PageDown':
        if (open) move(firstEnabled(Math.min(active + PAGE, shown.length - 1), -1))
        return
      case 'PageUp':
        if (open) move(firstEnabled(Math.max(active - PAGE, 0), 1))
        return
      // Once something is typed, Home and End edit it, as in any text box.
      case 'Home':
        if (open && !typed) move(firstEnabled(0, 1))
        return
      case 'End':
        if (open && !typed) move(firstEnabled(shown.length - 1, -1))
        return
      case 'Enter':
        if (open) {
          e.preventDefault()
          choose(shown[active])
        }
        return
      case 'Escape':
        if (open) {
          // The dialog listens on the document; this Escape is the list's.
          e.preventDefault()
          e.stopPropagation()
          close()
        }
        return
      case 'Tab':
        if (open) close()
        return
    }
  }

  const position = usePopupPosition(open, boxRef)
  // Only an enabled "" option is a choice the x may make; a disabled one is a prompt.
  const canClear = !disabled && (typed || (clearable && value !== '' && !!empty && !empty.disabled))
  const longest = options.reduce((n, o) => Math.max(n, o.separator ? 0 : o.label.length), (placeholder ?? '').length)

  return (
    <div ref={boxRef} className={`ss${className.includes('select--inline') ? ' ss--inline' : ''}`}>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        role="combobox"
        className={`${className} ss__input${canClear ? ' ss__input--clearable' : ''}`}
        value={query ?? selectedLabel}
        placeholder={placeholder ?? (value === '' ? empty?.label : undefined)}
        size={Math.max(6, Math.min(longest + 2, 40))}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-required={required || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        data-value={value}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(filter(e.target.value).findIndex(choosable))
        }}
        onClick={() => {
          // A click toggles, as on a <select>, until something is typed.
          if (open && query === null) return close()
          if (open) return
          openList()
          // Typing then replaces the shown name instead of appending to it.
          inputRef.current?.select()
        }}
        onFocus={(e) => {
          onFocus?.(e)
          e.target.select()
        }}
        onBlur={(e) => {
          onBlur?.(e)
          close()
        }}
        onKeyDown={handleKeyDown}
      />
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      {canClear && (
        <button
          type="button"
          className="ss__clear"
          tabIndex={-1}
          aria-label={t('common.select.clear')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (typed) {
              setQuery('')
              setOpen(true)
              setActive(firstEnabled(0, 1))
              inputRef.current?.focus()
            } else {
              close()
              onValueChange('')
            }
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            className={POPUP}
            style={position.style}
            dir={position.dir}
            // Keep focus in the text box while the pointer is on the list, and
            // keep the list's clicks from bubbling on to the host's handlers.
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <ul id={listId} role="listbox" className="ss__list" {...listName(inputRef.current, rest)}>
              {shown.map((o, i) =>
                o.separator ? (
                  <li key={`${i}:sep`} role="separator" className="ss__separator" />
                ) : (
                  <li
                    key={`${i}:${o.value}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    data-value={o.value}
                    className={`ss__option${i === active ? ' ss__option--active' : ''}`}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onClick={() => choose(o)}
                  >
                    <span className="ss__label">
                      <bdi>{o.label}</bdi>
                    </span>
                    {o.hint && (
                      <span className="ss__hint">
                        <bdi>{o.hint}</bdi>
                      </span>
                    )}
                    {o.value === value && <Icon name="check" size={16} />}
                  </li>
                ),
              )}
            </ul>
            {shown.length === 0 && (
              <div className="ss__empty" role="status">
                {t('common.select.noMatches')}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * The list's name: the caller's aria-labelledby or aria-label, else the text
 * box's <label> (by id when it has one, else by its text).
 */
function listName(
  input: HTMLInputElement | null,
  rest: { 'aria-label'?: string; 'aria-labelledby'?: string },
): { 'aria-labelledby'?: string; 'aria-label'?: string } {
  if (rest['aria-labelledby']) return { 'aria-labelledby': rest['aria-labelledby'] }
  if (rest['aria-label']) return { 'aria-label': rest['aria-label'] }
  const label = input?.labels?.[0]
  if (!label) return {}
  if (label.id) return { 'aria-labelledby': label.id }
  return { 'aria-label': label.textContent?.trim() || undefined }
}

// A disabled option drawn as a rule (box-drawing lines, dashes) is a divider, not a choice.
const RULE = new RegExp(`^[\\s${[0x2500, 0x2501, 0x2014, 0x2013].map((c) => String.fromCharCode(c)).join('')}-]+$`)

/** Reads `<option>` children (through arrays, fragments and conditionals) as options. */
export function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as {
      value?: string | number
      disabled?: boolean
      children?: ReactNode
      'data-hint'?: string
    }
    if (child.type === Fragment) {
      out.push(...optionsFromChildren(props.children))
    } else if (child.type === 'optgroup') {
      // A group heading has no place in a filtered list; no picker uses one.
      if (import.meta.env.DEV) throw new Error('SearchableSelect does not support <optgroup>; use separator options')
      out.push(...optionsFromChildren(props.children))
    } else if (child.type === 'option') {
      const label = textOf(props.children)
      const option: SelectOption = {
        value: props.value === undefined ? label : String(props.value),
        label,
        hint: props['data-hint'],
        disabled: props.disabled,
      }
      if (props.disabled && RULE.test(label)) option.separator = true
      out.push(option)
    }
  })
  return out
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

const GUTTER = 8

/**
 * Fixed coordinates under (or, without room, above) the text box, followed
 * through scrolling, resizing and the on-screen keyboard (the visual viewport
 * shrinks under it on iOS). The popup stays inside the viewport sideways, and
 * takes the box's direction, since it is portalled out of the page's tree.
 */
function usePopupPosition(open: boolean, boxRef: RefObject<HTMLDivElement>) {
  const [state, setState] = useState<{ style: CSSProperties; dir?: 'ltr' | 'rtl' }>({ style: {} })
  useLayoutEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    const place = () => {
      const box = boxRef.current
      if (!box) return
      const r = box.getBoundingClientRect()
      const top = vv ? vv.offsetTop : 0
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
      const left = vv ? vv.offsetLeft : 0
      const right = vv ? vv.offsetLeft + vv.width : window.innerWidth
      const below = bottom - r.bottom - GUTTER
      const above = r.top - top - GUTTER
      const up = below < 200 && above > below
      const room = Math.max(120, Math.min(320, up ? above : below))
      const dir = box.closest('[dir]')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
      // A narrow box gets a wider list, growing from its inline start, never past the viewport.
      const width = Math.min(Math.max(r.width, 200), right - left - 2 * GUTTER)
      const start = dir === 'rtl' ? r.right - width : r.left
      setState({
        dir,
        style: {
          position: 'fixed',
          left: Math.min(Math.max(start, left + GUTTER), right - GUTTER - width),
          width,
          maxHeight: room,
          ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        },
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    vv?.addEventListener('resize', place)
    vv?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      vv?.removeEventListener('resize', place)
      vv?.removeEventListener('scroll', place)
    }
  }, [open, boxRef])
  return state
}
