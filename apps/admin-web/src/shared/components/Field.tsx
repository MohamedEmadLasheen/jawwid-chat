import { useId } from 'react'

/**
 * A labelled text field with its error below it (moved from PD-10's Teacher
 * File dialogs so other features need not import a feature's internals).
 * `multiline` is a textarea; the label is tied to the control, so tests and
 * screen readers find it by its label.
 */
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'tel' | 'email' | 'date' | 'month' | 'number'
  multiline?: boolean
  error?: string | null
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="input tf-textarea"
          value={value}
          dir="auto"
          rows={4}
          maxLength={4000}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={type}
          value={value}
          dir={type === 'text' ? 'auto' : 'ltr'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      )}
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}
