import { Icon } from './Icon'

/** A labelled search input with a clear button once it holds text. */
export function SearchField({
  value,
  onChange,
  label,
  clearLabel,
}: {
  value: string
  onChange: (value: string) => void
  /** Visible as the placeholder and announced as the field's name. */
  label: string
  clearLabel: string
}) {
  return (
    <div className="search" role="search">
      <Icon name="search" size={16} />
      <input
        className="input"
        type="search"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm search__clear"
          onClick={() => onChange('')}
          aria-label={clearLabel}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}
