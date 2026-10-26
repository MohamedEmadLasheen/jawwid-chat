import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { S, describeScheduleError, useScheduleText } from './copy'
import { useCalendarOptions, useSetCalendarColor } from './hooks'
import { PALETTE, PALETTE_KEYS, PaletteStyle, isPaletteKey, swatchClass } from './palette'
import './schedule.css'

/**
 * PD-38 on the Organization page (Operations): each supervisor's schedule
 * color. A key from the curated palette, never a free color, so every label on
 * it stays readable. The Operations Manager and the super admin change it;
 * other readers see it. Shown only to those who have the schedule at all.
 */
export function SupervisorColors() {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const options = useCalendarOptions()
  const set = useSetCalendarColor()
  const [problem, setProblem] = useState<string | null>(null)
  if (!options.data || options.data.supervisors.length === 0) return null
  const canEdit = options.data.viewer.canEditColors

  return (
    <div className="sc-colors">
      <PaletteStyle />
      <h3>{tx(S.colorsTitle)}</h3>
      <p className="field__hint">{tx(S.colorsHint)}</p>
      {options.data.supervisors.map((s) => (
        <div key={s.id} className="sc-colors__row">
          <span className="sc-colors__name" dir="auto">{s.name}</span>
          {canEdit ? (
            <div className="sc-swatches" role="group" aria-label={tx(S.colorFor, { name: s.name })}>
              {PALETTE_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`sc-swatch ${swatchClass(k)}`}
                  aria-pressed={s.colorKey === k}
                  aria-label={tx(PALETTE[k].name)}
                  title={tx(PALETTE[k].name)}
                  disabled={set.isPending}
                  onClick={() => {
                    setProblem(null)
                    set.mutate({ staffId: s.id, colorKey: k }, { onError: (e) => setProblem(describeScheduleError(e, locale)) })
                  }}
                />
              ))}
              <button
                type="button"
                className="sc-swatch sc-swatch--clear"
                aria-pressed={s.colorKey === null}
                aria-label={tx(S.noColor)}
                title={tx(S.noColor)}
                disabled={set.isPending}
                onClick={() => set.mutate({ staffId: s.id, colorKey: null }, { onError: (e) => setProblem(describeScheduleError(e, locale)) })}
              />
            </div>
          ) : (
            <span className="sc-legend__sup">
              <span className={`sc-dot ${swatchClass(s.colorKey)}`} aria-hidden="true" />
              {isPaletteKey(s.colorKey) ? tx(PALETTE[s.colorKey].name) : tx(S.noColor)}
            </span>
          )}
        </div>
      ))}
      {problem && <p className="field__error" role="alert">{problem}</p>}
    </div>
  )
}
