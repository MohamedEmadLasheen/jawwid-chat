import type { ReactNode } from 'react'

export type Tone =
  | 'now'
  | 'today'
  | 'waiting'
  | 'ok'
  | 'warn'
  | 'danger'
  | 'info'
  | 'internal'
  | 'coverage'
  | 'gold'
  | 'outline'
  | 'neutral'

/** `dot` adds a leading shape, so a status never relies on its colour alone. */
export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: Tone
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
