import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { BrandLogo } from '@/shared/components/BrandLogo'
import { Icon } from '@/shared/components/Icon'

const A = {
  show: { en: 'Show password', ar: 'إظهار كلمة المرور' },
  hide: { en: 'Hide password', ar: 'إخفاء كلمة المرور' },
  line: { en: 'The academy’s daily work, in one place.', ar: 'عمل الأكاديمية اليومي في مكان واحد.' },
}

/**
 * The geometry on the brand side: an eight-point star lattice (two squares,
 * one turned 45 degrees, linked by a grid), in teal hairlines with a gold dot
 * where the lines meet. Decorative; hidden from assistive technology.
 */
function Lattice() {
  const id = useId()
  return (
    <svg className="auth__lattice" aria-hidden="true" focusable="false" width="100%" height="100%">
      <defs>
        <pattern id={id} width="112" height="112" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="var(--teal)" strokeWidth="0.8" strokeOpacity="0.34">
            {/* The star: an upright square and the same square turned. */}
            <rect x="32" y="32" width="48" height="48" />
            <path d="M56 22 90 56 56 90 22 56Z" />
            {/* The inner octagon the two squares enclose. */}
            <path d="M46 32h20l14 14v20L66 80H46L32 66V46Z" strokeOpacity="0.2" />
            {/* Links to the neighbouring stars. */}
            <path d="M56 0v22M56 90v22M0 56h22M90 56h22" />
            <path d="M0 0l32 32M112 0 80 32M0 112l32-32M112 112 80 80" strokeOpacity="0.2" />
          </g>
          <g fill="var(--gold)">
            <circle cx="56" cy="56" r="1.7" />
            <circle cx="0" cy="0" r="1.7" />
            <circle cx="112" cy="0" r="1.7" />
            <circle cx="0" cy="112" r="1.7" />
            <circle cx="112" cy="112" r="1.7" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/** Sign-in and reset share one frame: the brand on one side, the form on the other. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n()
  return (
    <div className="login auth">
      <div className="auth__brand">
        <Lattice />
        <div className="auth__mark">
          <BrandLogo />
          <p className="auth__line">{locale === 'ar' ? A.line.ar : A.line.en}</p>
        </div>
      </div>
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
