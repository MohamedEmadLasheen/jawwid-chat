import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { BrandLogo } from '@/shared/components/BrandLogo'
import { Icon } from '@/shared/components/Icon'

export function LoginPage() {
  const { t, locale, setLocale } = useI18n()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    // The login identifier is the account subject; for staff, their email.
    mutationFn: () => sessionApi.login(email.trim(), password),
    onSuccess: (staff) => {
      queryClient.setQueryData(qk.me, staff)
      void queryClient.invalidateQueries()
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (login.isPending) return
    login.mutate()
  }

  return (
    <div className="login">
      <div>
        <form className="login__card" onSubmit={onSubmit} aria-labelledby="login-title">
          <div className="login__brand">
            <BrandLogo />
          </div>
          <h1 className="login__title" id="login-title">
            {t('app.title')}
          </h1>
          <p className="login__subtitle">{t('auth.subtitle')}</p>

          <label className="field">
            <span className="field__label">{t('auth.email')}</span>
            <input
              className="input"
              type="email"
              value={email}
              autoComplete="username"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">{t('auth.password')}</span>
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {login.error && (
            <div className="field__error" role="alert">
              {login.error instanceof ApiError ? login.error.localized(locale) : t('common.offline')}
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={login.isPending}
            style={{ marginBlockStart: 'var(--space-2)' }}
          >
            {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
        <div className="login__footer">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            aria-label={t('shell.switchLanguageLabel')}
            lang={locale === 'ar' ? 'en' : 'ar'}
          >
            <Icon name="globe" size={16} />
            {t('shell.switchLanguage')}
          </button>
        </div>
      </div>
    </div>
  )
}
