import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { Pair } from './copy'
import { O, describeOpsError } from './opsCopy'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

export type FieldValue = (key: string) => string

export type FieldSpec =
  | { key: string; label: Pair; type: 'text' | 'textarea' | 'date' | 'datetime' | 'number'; required?: boolean; initial?: string }
  | { key: string; label: Pair; type: 'select'; options: Array<{ value: string; label: Pair }>; required?: boolean; initial?: string }

/**
 * One dialog for every supervisor action: a few declared fields, required ones
 * refused locally before anything is sent, and the server's refusal shown as
 * it is (a lesson already closed elsewhere, a teacher busy at that time). The
 * dialog closes only when the server says yes.
 */
export function ActionDialog({
  title,
  intro,
  fields,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string
  intro?: string
  fields: FieldSpec[]
  submitLabel?: string
  /** `v('key')` is the field's value, '' when left empty -- never undefined. */
  onSubmit: (v: FieldValue) => Promise<unknown>
  onClose: () => void
}) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const base = useId()
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? (f.type === 'select' ? f.options[0]?.value ?? '' : '')])),
  )
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim())

  const submit = async () => {
    setTouched(true)
    if (missing.length > 0 || pending) return
    setPending(true)
    setError(null)
    try {
      await onSubmit((key) => values[key] ?? '')
      onClose()
    } catch (e) {
      setError(e)
      setPending(false)
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => void submit()}>
            {pending ? tx(O.saving) : (submitLabel ?? tx(O.save))}
          </button>
        </>
      }
    >
      {intro && <p className="ts-muted">{intro}</p>}
      {fields.map((f) => {
        const id = `${base}-${f.key}`
        const invalid = touched && f.required && !values[f.key]?.trim()
        const set = (v: string) => setValues((s) => ({ ...s, [f.key]: v }))
        return (
          <div className="field" key={f.key}>
            <label className="field__label" htmlFor={id}>{tx(f.label)}</label>
            {f.type === 'select' ? (
              <SearchableSelect id={id} className="select" value={values[f.key] ?? ''} onValueChange={(v) => set(v)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{tx(o.label)}</option>
                ))}
              </SearchableSelect>
            ) : f.type === 'textarea' ? (
              <textarea id={id} className="input" rows={3} dir="auto" value={values[f.key] ?? ''} onChange={(e) => set(e.target.value)} aria-invalid={invalid} />
            ) : (
              <input
                id={id}
                className="input"
                dir="auto"
                type={f.type === 'datetime' ? 'datetime-local' : f.type}
                value={values[f.key] ?? ''}
                onChange={(e) => set(e.target.value)}
                aria-invalid={invalid}
              />
            )}
            {invalid && <span className="field__error">{tx(O.required)}</span>}
          </div>
        )
      })}
      {error !== null && (
        <div className="banner banner--danger" role="alert">
          {describeOpsError(error, locale)}
        </div>
      )}
    </Dialog>
  )
}
