import { useState, type ReactNode } from 'react'
import { DayRuler } from './DayRuler'
import { useI18n } from '@/core/i18n/I18nProvider'
import { BrandLogo } from '@/shared/components/BrandLogo'
import { Icon } from '@/shared/components/Icon'

const A = {
  show: { en: 'Show password', ar: 'إظهار كلمة المرور' },
  hide: { en: 'Hide password', ar: 'إخفاء كلمة المرور' },
  head: { en: 'Every lesson, every family and every payment of the academy’s day, in one place.', ar: 'كل حصة وكل أسرة وكل دفعة في يوم الأكاديمية، في مكان واحد.' },
}

/** Sign-in and reset share one frame: the form, and beside it the academy's day as the Schedule draws it. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n()
  return (
    <div className="login auth">
      <div className="auth__side">
        <div className="auth__top">
          <span className="auth__mark-small">
            <BrandLogo />
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            aria-label={t('shell.switchLanguageLabel')}
            lang={locale === 'ar' ? 'en' : 'ar'}
          >
            <Icon name="language" size={17} />
            {t('shell.switchLanguage')}
          </button>
        </div>
        <div className="auth__form">{children}</div>
      </div>
      <div className="auth__brand">
        <p className="auth__brand-head">{locale === 'ar' ? A.head.ar : A.head.en}</p>
        <DayRuler rtl={locale === 'ar'} ar={locale === 'ar'} />
      </div>
    </div>
  )
}

/** A password field with its label and a show/hide control beside it. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  invalid,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  invalid?: boolean
}) {
  const { locale } = useI18n()
  const [shown, setShown] = useState(false)
  const toggle = shown ? A.hide : A.show
  return (
    <div className="field auth__password">
      <label>
        <span className="field__label">{label}</span>
        <input
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          required
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="auth__reveal"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={locale === 'ar' ? toggle.ar : toggle.en}
        title={locale === 'ar' ? toggle.ar : toggle.en}
      >
        <Icon name="eye" size={18} />
      </button>
    </div>
  )
}
