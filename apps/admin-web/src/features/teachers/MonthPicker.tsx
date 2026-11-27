import { useId } from 'react'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
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
 * A month, as `YYYY-MM`: one step back, the month itself, one step forward.
 * Monthly pages are read month after month, so the step is one click.
 *
 * The month is written in the app's language ("نوفمبر 2026"), never in the
 * browser's: the native month field lies over that text, unseen, and still
 * takes the click, the keyboard and the picker.
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
  const shown = /^\d{4}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`))
    : value
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
        <span className="monthpick__field">
          <span className="monthpick__text" aria-hidden="true">
            {shown}
          </span>
          <input
            id={id}
            className="monthpick__input"
            type="month"
            value={value}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            onClick={(e) => {
              // Open the browser's own month list where it has one; typing still works where it does not.
              try {
                e.currentTarget.showPicker?.()
              } catch {
                /* not allowed here: the field keeps the focus */
              }
            }}
          />
        </span>
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
