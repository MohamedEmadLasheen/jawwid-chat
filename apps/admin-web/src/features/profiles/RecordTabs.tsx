import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'

/**
 * A record's tabs (a parent's file, a student's file). The open tab lives in
 * the URL's hash, so a reload, the browser's Back and a link from elsewhere
 * all land on it: `#money` opens the Money tab, and `#instalments` opens the
 * tab that section sits in and brings the section into view.
 *
 * Every panel stays mounted and only the open one is shown: a dialog, a
 * notice or a half-read list on one tab is still there when the reader comes
 * back to it, and each tab's data is asked for once.
 */
export interface RecordTab<T extends string> {
  key: T
  label: string
  /** Shown beside the label; for the eye only, so the tab keeps its plain name. */
  count?: ReactNode
  /** What the count means, said to whoever cannot see it. */
  countLabel?: string
}

export function useRecordTab<T extends string>(tabs: readonly T[], sections: Readonly<Record<string, T>>, ready = true) {
  const location = useLocation()
  const navigate = useNavigate()
  let id = ''
  try {
    id = decodeURIComponent(location.hash.replace(/^#/, ''))
  } catch {
    id = ''
  }
  const first = tabs[0] as T
  const named = (tabs as readonly string[]).includes(id) ? (id as T) : sections[id]
  const tab: T = named && tabs.includes(named) ? named : first
  // A hash that names a section (not a tab) asks for that section to be brought into view.
  const section = id !== '' && !(tabs as readonly string[]).includes(id) && sections[id] === tab ? id : null

  const open = useCallback(
    (next: T) => {
      navigate({ pathname: location.pathname, search: location.search, hash: next === first ? '' : `#${next}` }, { replace: true })
    },
    [navigate, location.pathname, location.search, first],
  )

  useEffect(() => {
    if (!section || !ready) return
    const el = document.querySelector<HTMLElement>(`[data-section="${section.replace(/"/g, '')}"]`)
    if (!el) return
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [section, ready, location.key])

  return { tab, section, open }
}

export function RecordTabs<T extends string>({
  name,
  label,
  tabs,
  value,
  onChange,
}: {
  /** A short id prefix, unique on the page ("pf", "st"). */
  name: string
  label: string
  tabs: ReadonlyArray<RecordTab<T>>
  value: T
  onChange: (tab: T) => void
}) {
  const { dir } = useI18n()
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const at = tabs.findIndex((t) => t.key === value)
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    const to = e.key === forward ? at + 1 : e.key === back ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = tabs[(to + tabs.length) % tabs.length]
    if (!next) return
    onChange(next.key)
    list.current?.querySelector<HTMLElement>(`#${name}-tab-${next.key}`)?.focus()
  }
  return (
    <div ref={list} className="seg rec-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${name}-tab-${t.key}`}
          className="seg__item"
          aria-selected={t.key === value}
          aria-controls={`${name}-panel-${t.key}`}
          tabIndex={t.key === value ? 0 : -1}
          title={t.countLabel}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count !== undefined && t.count !== null && (
            <span className="rec-tabs__count" aria-hidden="true">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** One tab's page. Kept in the document while another tab is open, and not shown. */
export function RecordPanel<T extends string>({ name, tab, value, children }: { name: string; tab: T; value: T; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${name}-panel-${tab}`} aria-labelledby={`${name}-tab-${tab}`} className="rec-panel" data-active={tab === value}>
      {children}
    </div>
  )
}
