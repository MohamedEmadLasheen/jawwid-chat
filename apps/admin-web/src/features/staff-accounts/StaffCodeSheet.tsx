import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { Dialog } from '@/shared/components/Dialog'
import type { StaffFirstLogin } from './api'
import { SA, useCopy } from './copy'

/**
 * The first sign-in code, PD-43's code sheet for a staff account. Shown once:
 * closing it drops the code, nothing keeps it. A manager's reissue carries no
 * code -- it went by e-mail only (plan §15, P1) -- so the sheet says where it
 * went, or that it could not go, and shows no code box.
 *
 * Defence in depth (review of #239): a code is shown only for an account being
 * created, or to the super admin. Should the server ever return one with a
 * manager's reissue, it is not displayed.
 */
export function StaffCodeSheet({
  signIn,
  firstLogin,
  forCreation = false,
  onClose,
}: {
  /** The sign-in e-mail, when the answer names it (creation). */
  signIn: string | null
  firstLogin: StaffFirstLogin
  /** The sheet that follows creating the account: its creator sees the code (owner, Q5). */
  forCreation?: boolean
  onClose: () => void
}) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const { staff } = useSession()
  const [copied, setCopied] = useState(false)
  const code = firstLogin.code && (forCreation || (staff !== null && isSuperAdmin(staff.role))) ? firstLogin.code : null
  return (
    <Dialog
      title={tx(SA.firstLoginTitle)}
      onClose={onClose}
      footer={
        <>
          {code && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)
              }}
            >
              {copied ? tx(SA.copied) : tx(SA.copy)}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tx(SA.done)}
          </button>
        </>
      }
    >
      {code ? (
        <>
          <p className="field__hint">{tx(SA.firstLoginHint)}</p>
          <dl className="sa-code">
            {signIn && (
              <>
                <dt>{tx(SA.signInLabel)}</dt>
                <dd dir="ltr">{signIn}</dd>
              </>
            )}
            <dt>{tx(SA.codeLabel)}</dt>
            <dd dir="ltr" className="sa-code__value" aria-label={code.split('').join(' ')}>
              {code}
            </dd>
          </dl>
          <p className="field__hint">{tx(SA.validUntil, { when: dateTime(firstLogin.expiresAt) })}</p>
          <p className="field__hint">
            {firstLogin.emailed ? (signIn ? tx(SA.emailedTo, { email: signIn }) : tx(SA.emailedToSignIn)) : tx(SA.notEmailed)}
          </p>
        </>
      ) : (
        <p role="status">{tx(firstLogin.emailed ? SA.codeEmailed : SA.codeNotEmailed)}</p>
      )}
    </Dialog>
  )
}
