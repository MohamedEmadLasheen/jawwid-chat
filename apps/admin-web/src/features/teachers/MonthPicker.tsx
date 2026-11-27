import { useId } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import './teachers.css'

const STEP = {
  prev: { en: 'Previous month', ar: 'الشهر السابق' },
  next: { en: 'Next month', ar: 'الشهر التالي' },
}

function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * A month, as `YYYY-MM`: one step back, the month itself (typed or picked),
 * one step forward. Monthly pages are read month after month, so the step is
 * one click.
 */
export function MonthPicker({
  value,
  onChange,
  label,
  showLabel = true,
}: {
  value: string
  onChange: (month: string) => void
  label: string
  showLabel?: boolean
}) {
  const { locale } = useI18n()
  const id = useId()
  return (
    <div className="monthpick">
      <label className={showLabel ? 'field__label monthpick__label' : 'sr-only'} htmlFor={id}>
        {label}
      </label>
      <div className="monthpick__ctl">
        <button
          type="button"
          className="monthpick__step monthpick__step--prev"
          aria-label={STEP.prev[locale]}
          title={STEP.prev[locale]}
          onClick={() => onChange(shift(value, -1))}
        >
          <Icon name="chevronForward" size={16} />
        </button>
        <input id={id} className="monthpick__input" type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
        <button
          type="button"
          className="monthpick__step"
          aria-label={STEP.next[locale]}
          title={STEP.next[locale]}
          onClick={() => onChange(shift(value, 1))}
        >
          <Icon name="chevronForward" size={16} />
        </button>
      </div>
    </div>
  )
}
