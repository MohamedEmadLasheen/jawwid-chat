import type { ReactNode } from 'react'

/** A section's rule, in one line, and its record button. */
export function SectionIntro({ hint, actions }: { hint: string; actions?: ReactNode }) {
  return (
    <div className="th-intro">
      <p className="th-rule">{hint}</p>
      {actions && <div className="th-actions">{actions}</div>}
    </div>
  )
}
