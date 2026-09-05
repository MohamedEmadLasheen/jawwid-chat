import { useI18n } from '@/core/i18n/I18nProvider'
import { useShiftBanner, useSnoozeToNextShift } from './hooks'

/**
 * Brief §4 shift-end flow, step 1: N minutes before shift end the owner is
 * warned, with a one-click "snooze to my next shift". N comes from config and
 * is applied server-side — the client only renders what it is told.
 */
export function ShiftEndBanner() {
  const { t, number } = useI18n()
  const { data } = useShiftBanner()
  const snooze = useSnoozeToNextShift()

  if (!data) return null

  return (
    <div className="banner banner--warn" role="status">
      <span>
        {t('shift.endingBanner', { minutes: number(data.minutes_remaining) })}{' '}
        {t('shift.endingDetail', {
          waiting: number(data.waiting_count),
          followUps: number(data.follow_up_count),
        })}
      </span>
      {data.can_snooze && (
        <button
          type="button"
          className="btn btn--sm"
          disabled={snooze.isPending}
          onClick={() => snooze.mutate([])}
        >
          {t('shift.snooze')}
        </button>
      )}
    </div>
  )
}
