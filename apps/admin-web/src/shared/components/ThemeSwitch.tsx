import type { KeyboardEvent } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { THEME_CHOICES, useTheme, type ThemeChoice } from '@/core/theme/theme'
import { Icon, type IconName } from './Icon'

const WORDS: Record<ThemeChoice | 'title', { en: string; ar: string }> = {
  title: { en: 'Appearance', ar: 'المظهر' },
  light: { en: 'Light', ar: 'فاتح' },
  dark: { en: 'Dark', ar: 'داكن' },
  auto: { en: 'Auto', ar: 'تلقائي' },
}
const ICON: Record<ThemeChoice, IconName> = { light: 'sun', dark: 'moon', auto: 'screen' }
const HINT = { en: 'Auto follows your device', ar: 'التلقائي يتبع إعداد جهازك' }

/**
 * Light, Dark or Auto: three choices in one radio group (arrow keys move between them, as in any
 * radio group). It lives in the account menu, beside the language.
 */
export function ThemeSwitch() {
  const { locale } = useI18n()
  const [choice, setChoice] = useTheme()
  const w = (k: keyof typeof WORDS) => WORDS[k][locale]
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    // Arrows follow the reading direction: in Arabic the next choice is to the left.
    const dir = document.documentElement.dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') ? -step : step
    const at = THEME_CHOICES.indexOf(choice)
    const next = THEME_CHOICES[(at + dir + THEME_CHOICES.length) % THEME_CHOICES.length]!
    setChoice(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-choice="${next}"]`)?.focus()
  }
  return (
    <div className="theme-switch">
      <span className="theme-switch__title" id="theme-switch-title">
        {w('title')}
      </span>
      <div className="theme-switch__group" role="radiogroup" aria-labelledby="theme-switch-title" onKeyDown={onKeyDown}>
        {THEME_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={choice === c}
            tabIndex={choice === c ? 0 : -1}
            data-choice={c}
            className="theme-switch__option"
            onClick={() => setChoice(c)}
            title={c === 'auto' ? HINT[locale] : undefined}
          >
            <Icon name={ICON[c]} size={16} />
            <span>{w(c)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
