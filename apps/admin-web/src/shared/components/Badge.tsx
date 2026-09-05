import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { AttentionBucket, HandlingMode, WorkloadLevel } from '@/shared/types/domain'

type Tone = 'now' | 'today' | 'waiting' | 'ok' | 'danger' | 'internal' | 'coverage' | 'neutral'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>{children}</span>
}

/**
 * The bucket dot carries colour AND shape, and is paired with visually hidden
 * text so the state is never conveyed by colour alone (role brief §81).
 */
export function BucketDot({ bucket }: { bucket: AttentionBucket }) {
  const { t } = useI18n()
  return (
    <>
      <span className={`dot dot--${bucket}`} aria-hidden="true" />
      <span className="sr-only">{t(`bucket.${bucket}` as const)}</span>
    </>
  )
}

/**
 * Says *why* the operator is holding this family — owning it and covering it
 * are different jobs with different rules, and the brief requires the
 * difference to be obvious.
 */
export function HandlingBadge({ mode }: { mode: HandlingMode }) {
  const { t } = useI18n()
  if (mode === 'owner') return null
  const tone: Tone =
    mode === 'coverage' ? 'coverage'
    : mode === 'assist' ? 'internal'
    : mode === 'escalation' ? 'danger'
    : mode === 'none' ? 'danger'
    : 'neutral'
  return <Badge tone={tone}>{t(`handling.${mode}` as const)}</Badge>
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

/**
 * Response target, not "SLA". The brief speaks in response targets, and every
 * threshold behind this comes from `config`.
 */
export function ResponseTargetBadge({
  elapsedPct,
  breached,
}: {
  elapsedPct: number
  breached: boolean
}) {
  const { t } = useI18n()
  if (breached) return <Badge tone="danger">{t('bucket.now')}</Badge>
  if (elapsedPct >= 0.7) return <Badge tone="today">{Math.round(elapsedPct * 100)}%</Badge>
  return null
}
