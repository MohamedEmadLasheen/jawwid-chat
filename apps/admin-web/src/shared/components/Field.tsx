import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'

/**
 * A LABELLED FORM CONTROL.
 *
 * The control is passed in rather than rendered here, because the product uses
 * inputs, selects and textareas in the same slot and a component that switched
 * between them on a `type` prop would be the abstraction §9 warns against.
 *
 * What this DOES own is the part every caller was getting subtly differently:
 *
 *   - The wrapper is a real `<label>`, so the control is associated with its
 *     text implicitly — no id plumbing, and no chance of an orphaned `for`.
 *   - `required` is marked with a word for assistive tech as well as the
 *     asterisk, because §20 forbids meaning carried by a glyph or a colour
 *     alone. The word is translated; the asterisk is not.
 *   - The error is `role="alert"`, so it is announced when it appears rather
 *     than only being visible.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
}) {
  const { t } = useI18n()

  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required && (
          <>
            <span className="field__required" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> ({t('common.required')})</span>
          </>
        )}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}
