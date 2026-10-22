import type { ReactNode } from 'react'

/** A section's one-line explanation, and its record buttons. */
export function SectionIntro({ hint, actions }: { hint: string; actions?: ReactNode }) {
  return (
    <div className="th-intro">
      <p className="field__hint">{hint}</p>
      {actions && <div className="th-actions">{actions}</div>}
    </div>
  )
}
