import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { WorkloadLevel } from '@/shared/types/domain'

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

export function WorkloadBadge({ level, score }: { level: WorkloadLevel; score?: number }) {
  const { t, number } = useI18n()
  const tone: Tone = level === 'high' ? 'danger' : level === 'medium' ? 'today' : 'ok'
  return (
    <Badge tone={tone}>
      {t(`workload.${level}` as const)}
      {score !== undefined && ` · ${number(score)}`}
    </Badge>
  )
}
