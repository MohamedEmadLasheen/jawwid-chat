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
   * Server-backed lists: called (debounced) with what was typed, and the
   * caller replaces `options` with the server's answer. The list is then shown
   * as given, not filtered again here.
   */
  onSearch?: (query: string) => void
  /** The server search is in flight. */
  searching?: boolean
  'data-testid'?: string
}

const SEARCH_DEBOUNCE_MS = 250
const PAGE = 10

/**
 * The one picker of the Admin Web: an ARIA 1.2 combobox (a text box with a
 * listbox popup), so every list can be typed into as well as chosen from.
 *
 * Typing filters by every word, ignoring harakat, tatweel and the alef / yeh /
 * teh marbuta spellings (see matchText). Arrows, Home/End and PageUp/PageDown
 * move through the list, Enter picks, Escape closes (and only then lets the
 * dialog around it close). The popup is portalled to the body with fixed
 * positioning, so a dialog's scroll box cannot clip it and a wrapping
 * <label> cannot swallow its clicks.
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
  onSearch,
  searching = false,
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
  const selected = options.find((o) => o.value === value)
  // A server-backed list may no longer hold the chosen row; keep showing its name.
  const lastLabel = useRef<string>('')
  if (selected) lastLabel.current = selected.label
  else if (!onSearch) lastLabel.current = ''
  // An empty value shows as a placeholder (the "—" or "All …" option), so typing starts clean.
  const selectedLabel = value === '' ? '' : (selected?.label ?? lastLabel.current)
  const emptyLabel = options.find((o) => o.value === '')?.label

  const [open, setOpen] = useState(false)
  /** What was typed since the list opened; null = nothing yet, show everything. */
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  const shown = useMemo(
    () => (onSearch || !query ? options : options.filter((o) => matchesQuery(query, o.label, o.hint))),
    [options, query, onSearch],
  )
  const enabled = (i: number) => i >= 0 && i < shown.length && !shown[i]!.disabled

  // Server search: debounce what was typed.
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch
  useEffect(() => {
    if (query === null || !onSearchRef.current) return
    const timer = setTimeout(() => onSearchRef.current?.(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

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
    const sel = shown.findIndex((o) => o.value === value)
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
    if (!option || option.disabled) return
    close()
    if (option.value !== value) onValueChange(option.value)
  }

  // Keep the active option in view.
  useEffect(() => {
    if (!open || active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

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
      case 'Home':
        if (open) move(firstEnabled(0, 1))
        return
      case 'End':
        if (open) move(firstEnabled(shown.length - 1, -1))
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
  const hasEmpty = emptyLabel !== undefined
  const typed = query !== null && query !== ''
  const canClear = !disabled && (typed || (value !== '' && hasEmpty))
  const longest = options.reduce((n, o) => Math.max(n, o.label.length), (placeholder ?? '').length)

  return (
    <div ref={boxRef} className={`ss${className.includes('select--inline') ? ' ss--inline' : ''}`}>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        role="combobox"
        className={`${className} ss__input${canClear ? ' ss__input--clearable' : ''}`}
        value={query ?? selectedLabel}
        placeholder={placeholder ?? (value === '' ? emptyLabel : undefined)}
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
          if (!onSearch) {
            const next = options.filter((o) => matchesQuery(e.target.value, o.label, o.hint))
            setActive(next.findIndex((o) => !o.disabled))
          } else setActive(-1)
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
            className="ss__popup"
            style={position.style}
            dir={position.dir}
            // Keep focus in the text box while the pointer is on the list.
            onMouseDown={(e) => e.preventDefault()}
          >
            <ul id={listId} role="listbox" aria-label={rest['aria-label']} className="ss__list">
              {shown.map((o, i) => (
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
              ))}
            </ul>
            {shown.length === 0 && (
              <div className="ss__empty" role="status">
                {searching ? t('common.select.searching') : t('common.select.noMatches')}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

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
    } else if (child.type === 'option') {
      const label = textOf(props.children)
      out.push({
        value: props.value === undefined ? label : String(props.value),
        label,
        hint: props['data-hint'],
        disabled: props.disabled,
      })
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

/**
 * Fixed coordinates under (or, without room, above) the text box, followed
 * through scrolling and resizing. The popup takes the box's direction, since
 * it is portalled out of the page's tree.
 */
function usePopupPosition(open: boolean, boxRef: RefObject<HTMLDivElement>) {
  const [state, setState] = useState<{ style: CSSProperties; dir?: 'ltr' | 'rtl' }>({ style: {} })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const box = boxRef.current
      if (!box) return
      const r = box.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 8
      const above = r.top - 8
      const up = below < 200 && above > below
      const room = Math.max(120, Math.min(320, up ? above : below))
      const dir = box.closest('[dir]')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
      // A narrow box gets a wider list, growing from its inline start.
      const width = Math.max(r.width, 200)
      setState({
        dir,
        style: {
          position: 'fixed',
          left: dir === 'rtl' ? r.right - width : r.left,
          width,
          maxHeight: room,
          ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        },
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, boxRef])
  return state
}
