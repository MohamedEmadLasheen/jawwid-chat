import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'

export function LoginPage() {
  const { t, locale } = useI18n()
  const { signIn } = useSession()
  const [subject, setSubject] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => signIn(subject, password),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (login.isPending) return
    login.mutate()
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <form className="card" style={{ inlineSize: 'min(380px, 100%)' }} onSubmit={onSubmit}>
        <h1 className="dialog__title">{t('app.title')}</h1>

        {/*
          The login identifier is an opaque SUBJECT, not an e-mail address:
          chat.account carries no contact channel by design (BR-2). Typed as
          plain text so a browser does not validate it as an address.
        */}
        <label className="field">
          <span className="field__label">Username</span>
          <input
            className="input"
            type="text"
            value={subject}
            autoComplete="username"
            required
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Password</span>
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

        <button type="submit" className="btn btn--primary" disabled={login.isPending}>
          {login.isPending ? t('common.loading') : t('app.title')}
        </button>
      </form>
    </div>
  )
}
