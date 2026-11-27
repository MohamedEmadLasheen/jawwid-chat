/**
 * Text tabs for a list's one main filter. A tab may show how many rows it
 * holds; the number is for the eye only, so the tab keeps its plain name for
 * the keyboard, for a screen reader and for whoever looks it up by name.
 */
export interface CountTab<T extends string> {
  value: T
  label: string
  /** Shown only when known; a list that cannot count a tab leaves it out. */
  count?: string
}

export function CountTabs<T extends string>({
  label,
  value,
  onChange,
  tabs,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  tabs: ReadonlyArray<CountTab<T>>
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.value} type="button" className="seg__item" aria-pressed={tab.value === value} onClick={() => onChange(tab.value)}>
          {tab.label}
          {tab.count !== undefined && (
            <span className="seg__count" aria-hidden="true">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
