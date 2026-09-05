import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'

export function LoginPage() {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => sessionApi.login(email, password),
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
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <form className="card" style={{ inlineSize: 'min(380px, 100%)' }} onSubmit={onSubmit}>
        <h1 className="dialog__title">{t('app.title')}</h1>

        <label className="field">
          <span className="field__label">Email</span>
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
