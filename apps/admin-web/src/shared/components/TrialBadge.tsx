import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from './Icon'
import './trial-badge.css'

/** PD-32: the one "Trial" label for a trial group, the same in Admin Web and the app. */
export const TRIAL_LABEL = { en: 'Trial', ar: 'تجريبية' } as const

/** True for a conversation the academy uses for trial lessons. */
export const isTrialGroup = (c: { type?: string | null } | null | undefined) => c?.type === 'trial_group'

export function TrialBadge() {
  const { locale } = useI18n()
  return (
    <span className="badge badge--trial" data-testid="trial-badge">
      <Icon name="calendar" size={11} />
      {locale === 'ar' ? TRIAL_LABEL.ar : TRIAL_LABEL.en}
    </span>
  )
}
