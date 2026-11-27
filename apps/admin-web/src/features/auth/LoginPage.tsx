import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionApi } from '@/core/api/endpoints'
import { persistenceSupported } from '@/core/auth/tokens'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { AuthFrame, PasswordField } from './AuthFrame'
import { useCopy } from '@/features/organization/copy'
import { PasswordResetForm, R } from './PasswordResetForm'

export function LoginPage() {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // PD-23: unticked by default, and offered only where cross-tab refresh can
  // be serialized (Web Locks) -- otherwise a shared token could be replayed.
  const [canRemember] = useState(persistenceSupported)
  const [remember, setRemember] = useState(false)
  // PD-21: finishing a reset an administrator issued, on the same page.
  const [mode, setMode] = useState<'signIn' | 'reset'>('signIn')
  const [resetDone, setResetDone] = useState(false)
  const tx = useCopy()

  const login = useMutation({
    // The login identifier is the account subject; for staff, their email.
    mutationFn: () => sessionApi.login(email.trim(), password, canRemember && remember),
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
    <AuthFrame>
        {mode === 'reset' ? (
          <PasswordResetForm
            initialEmail={email}
            onBack={() => setMode('signIn')}
            onDone={(done) => {
              setEmail(done)
              setPassword('')
              setResetDone(true)
              setMode('signIn')
            }}
          />
        ) : (
          <form className="login__card" onSubmit={onSubmit} aria-labelledby="login-title">
            <h1 className="login__title" id="login-title">
              {t('app.title')}
            </h1>
            <p className="login__subtitle">{t('auth.subtitle')}</p>
            {resetDone && (
              <p className="field__hint" role="status">
                {tx(R.done)}
              </p>
            )}

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

            <PasswordField label={t('auth.password')} value={password} onChange={setPassword} autoComplete="current-password" />

            {canRemember && (
              <label className="login__remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>{t('auth.keepSignedIn')}</span>
              </label>
            )}

            {login.error && (
              <div className="field__error" role="alert">
                {login.error instanceof ApiError ? login.error.localized(locale) : t('common.offline')}
              </div>
            )}

            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={login.isPending}
            >
              {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
            </button>
            <button type="button" className="auth__link" onClick={() => setMode('reset')}>
              {tx(R.open)}
            </button>
          </form>
        )}
    </AuthFrame>
  )
}
