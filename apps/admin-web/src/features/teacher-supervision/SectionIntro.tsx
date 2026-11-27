import type { ReactNode } from 'react'
import '@/features/teachers/rows.css'

/**
 * The head of a section's sheet: its name, the one-line rule that governs it
 * as a quiet hint, and the one thing to record at its end.
 */
export function SectionIntro({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
  return (
    <header className="sheet__head th-intro">
      <div className="sheet__heading">
        <h2 className="sheet__title">{title}</h2>
        {hint && <p className="sheet__hint">{hint}</p>}
      </div>
      {actions && <div className="th-actions">{actions}</div>}
    </header>
  )
}
