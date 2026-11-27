import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { Icon, type IconName } from '@/shared/components/Icon'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { BankAccount, BillingSettings, InvoiceIssuer } from './api'
import { PAY, describeError, type Pair, reminderLabel, useCopy } from './copy'
import { useBillingSettings, useSaveBillingSettings } from './hooks'
import { Field, Footer, ServerError } from './PaymentParts'

/**
 * Payments > Settings: the four groups as a list at the start, one group's
 * sheet beside it, and one Save that stays in reach. Editable only when the
 * server says `canEdit`; the card switch is its own confirmed act.
 */
export function SettingsTab() {
  const { locale } = useI18n()
  const settings = useBillingSettings()
  if (settings.error) return <EmptyState icon="alert" title={describeError(settings.error, locale)} />
  return (
    <QueryBoundary isLoading={settings.isLoading} error={null} onRetry={() => void settings.refetch()}>
      {/* The form starts from what the server held when it was opened; a save keeps what was typed. */}
      {settings.data && <SettingsForm settings={settings.data} />}
    </QueryBoundary>
  )
}

type GroupKey = 'card' | 'bank' | 'issuer' | 'reminders'
const GROUPS: ReadonlyArray<{ key: GroupKey; label: Pair; icon: IconName }> = [
  { key: 'card', label: PAY.card, icon: 'card' },
  { key: 'bank', label: PAY.bankAccount, icon: 'bankTransfer' },
  { key: 'issuer', label: PAY.issuer, icon: 'invoice' },
  { key: 'reminders', label: PAY.reminders, icon: 'notifications' },
]
const GROUP_HINT: Partial<Record<GroupKey, Pair>> = { bank: PAY.bankHint, issuer: PAY.issuerHint, reminders: PAY.remindersHint }

type BankDraft = Record<keyof BankAccount, string>
type IssuerDraft = Record<keyof InvoiceIssuer, string>

const BANK_FIELDS: ReadonlyArray<{ key: keyof BankAccount; label: keyof typeof PAY; dir: 'ltr' | 'auto'; wide?: boolean }> = [
  { key: 'accountName', label: 'accountName', dir: 'auto' },
  { key: 'bankName', label: 'bankName', dir: 'auto' },
  { key: 'iban', label: 'iban', dir: 'ltr', wide: true },
  { key: 'accountNumber', label: 'accountNumber', dir: 'ltr' },
  { key: 'swift', label: 'swift', dir: 'ltr' },
]

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

const bankDraft = (b: BankAccount | null): BankDraft => ({
  bankName: b?.bankName ?? '',
  accountName: b?.accountName ?? '',
  iban: b?.iban ?? '',
  accountNumber: b?.accountNumber ?? '',
  swift: b?.swift ?? '',
  note: b?.note ?? '',
})
const issuerDraft = (i: InvoiceIssuer | null): IssuerDraft => ({ name: i?.name ?? '', address: i?.address ?? '', taxId: i?.taxId ?? '' })

/** What a draft sends: null when every field is empty. */
const bankOf = (d: BankDraft): BankAccount | null =>
  Object.values(d).some((v) => v.trim() !== '')
    ? {
        accountName: d.accountName.trim(),
        bankName: orNull(d.bankName),
        iban: orNull(d.iban),
        accountNumber: orNull(d.accountNumber),
        swift: orNull(d.swift),
        note: orNull(d.note),
      }
    : null
const issuerOf = (d: IssuerDraft): InvoiceIssuer | null =>
  Object.values(d).some((v) => v.trim() !== '') ? { name: d.name.trim(), address: orNull(d.address), taxId: orNull(d.taxId) } : null
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function SettingsForm({ settings }: { settings: BillingSettings }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const save = useSaveBillingSettings()
  const b = settings.bankAccount
  // Every group's draft lives here, so moving between groups loses nothing typed.
  const [bank, setBank] = useState<BankDraft>(() => bankDraft(b))
  const [issuer, setIssuer] = useState<IssuerDraft>(() => issuerDraft(settings.issuer))
  const [reminders, setReminders] = useState(() => settings.reminders.map((r) => ({ ...r })))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [confirmPause, setConfirmPause] = useState(false)
  const [group, setGroup] = useState<GroupKey>('card')
  const editable = settings.canEdit

  // A group is edited while what it would send differs from what the server holds.
  const edited: Record<GroupKey, boolean> = {
    card: false,
    bank: !same(bankOf(bank), bankOf(bankDraft(b))),
    issuer: !same(issuerOf(issuer), issuerOf(issuerDraft(settings.issuer))),
    reminders: reminders.some((r) => settings.reminders.find((x) => x.key === r.key)?.enabled !== r.enabled),
  }
  const editedNames = GROUPS.filter((g) => edited[g.key]).map((g) => tx(g.label))

  const submit = () => {
    const next: Record<string, string> = {}
    const anyBank = bankOf(bank) !== null
    const anyIssuer = issuerOf(issuer) !== null
    if (anyBank && bank.accountName.trim() === '') next.accountName = tx(PAY.accountNameRequired)
    if (anyIssuer && issuer.name.trim() === '') next.issuerName = tx(PAY.issuerNameRequired)
    setErrors(next)
    setSaved(false)
    if (Object.keys(next).length > 0) {
      // What stops the save is shown: the group that holds it opens.
      setGroup(next.accountName ? 'bank' : 'issuer')
      return
    }
    // The same request as ever: all three groups, whichever of them was edited.
    save.mutate(
      { bankAccount: bankOf(bank), issuer: issuerOf(issuer), reminders: reminders.map((r) => ({ key: r.key, enabled: r.enabled })) },
      { onSuccess: () => setSaved(true) },
    )
  }

  const cardLive = settings.cardAvailable || (settings.cardPaused && settings.cardConfigured)
  const inOrder = [...reminders].sort((x, y) => x.offsetDays - y.offsetDays)
  const hint = GROUP_HINT[group]
  const title = tx(GROUPS.find((g) => g.key === group)!.label)

  return (
    <div className="set">
      <nav className="set__list" aria-label={tx(PAY.settingsTab)}>
        {GROUPS.map((g) => (
          <button key={g.key} type="button" className="set__item" aria-current={g.key === group ? 'true' : undefined} onClick={() => setGroup(g.key)}>
            <Icon name={g.icon} size={18} />
            <span className="set__item-name">{tx(g.label)}</span>
            {edited[g.key] && (
              <span className="set__edited">
                <span className="set__edited-dot" aria-hidden="true" />
                <span className="sr-only">{tx(PAY.edited)}</span>
              </span>
            )}
          </button>
        ))}
      </nav>

      <section className="sheet set__sheet" aria-labelledby="pay-set-title">
        {!editable && (
          <p className="pay-lock set__lock">
            <Icon name="lock" size={16} />
            <span>{tx(PAY.readOnlySettings)}</span>
          </p>
        )}
        <div className="sheet__head set__head">
          <div>
            <h2 id="pay-set-title" className="sheet__title set__title">
              {title}
            </h2>
            {hint && <p className="set__hint">{tx(hint)}</p>}
          </div>
          {edited[group] && (
            <Badge tone="waiting" dot>
              {tx(PAY.edited)}
            </Badge>
          )}
        </div>

        <div className="sheet__body set__body">
          <ServerError error={save.error} />

          {group === 'card' && (
            <div className="set-card">
              <div className="set-card__state">
                {settings.cardPaused ? (
                  <CardPausedNote />
                ) : (
                  <Badge tone={settings.cardAvailable ? 'ok' : 'neutral'} dot>
                    {tx(settings.cardAvailable ? PAY.cardOn : PAY.cardOff)}
                  </Badge>
                )}
                {cardLive && (
                  <Badge tone={settings.webhookConfigured ? 'ok' : 'danger'} dot>
                    {tx(settings.webhookConfigured ? PAY.webhookOn : PAY.webhookOff)}
                  </Badge>
                )}
              </div>
              {/* W63: the kill switch. Shown when there is something to pause (Stripe configured) or to undo. */}
              {editable && (settings.cardConfigured || settings.cardPaused) && (
                <button type="button" className={settings.cardPaused ? 'btn btn--primary' : 'btn'} onClick={() => setConfirmPause(true)}>
                  {tx(settings.cardPaused ? PAY.resumeCard : PAY.pauseCard)}
                </button>
              )}
            </div>
          )}

          {group === 'bank' && (
            <>
              {!b && !editable && <p className="set-none">{tx(PAY.noBankAccount)}</p>}
              <fieldset className="set-grid" disabled={!editable}>
                <legend className="sr-only">{tx(PAY.bankAccount)}</legend>
                {BANK_FIELDS.map((f) => (
                  <Field key={f.key} label={tx(PAY[f.label])} error={f.key === 'accountName' ? errors.accountName : null} wide={f.wide}>
                    {(id, d) => (
                      <input
                        id={id}
                        className="input"
                        dir={f.dir}
                        value={bank[f.key]}
                        maxLength={f.key === 'iban' ? 34 : 120}
                        aria-describedby={d}
                        onChange={(e) => setBank((v) => ({ ...v, [f.key]: e.target.value }))}
                      />
                    )}
                  </Field>
                ))}
                <Field label={tx(PAY.bankNote)} hint={tx(PAY.bankNoteHint)} wide>
                  {(id, d) => (
                    <textarea
                      id={id}
                      className="input tf-textarea"
                      dir="auto"
                      rows={2}
                      maxLength={500}
                      value={bank.note}
                      aria-describedby={d}
                      onChange={(e) => setBank((v) => ({ ...v, note: e.target.value }))}
                    />
                  )}
                </Field>
              </fieldset>
            </>
          )}

          {group === 'issuer' && (
            <fieldset className="set-grid" disabled={!editable}>
              <legend className="sr-only">{tx(PAY.issuer)}</legend>
              <Field label={tx(PAY.issuerName)} error={errors.issuerName}>
                {(id, d) => (
                  <input id={id} className="input" dir="auto" value={issuer.name} maxLength={160} aria-describedby={d} onChange={(e) => setIssuer((v) => ({ ...v, name: e.target.value }))} />
                )}
              </Field>
              <Field label={tx(PAY.taxId)}>
                {(id) => <input id={id} className="input" dir="ltr" value={issuer.taxId} maxLength={64} onChange={(e) => setIssuer((v) => ({ ...v, taxId: e.target.value }))} />}
              </Field>
              <Field label={tx(PAY.address)} wide>
                {(id) => (
                  <textarea id={id} className="input tf-textarea" dir="auto" rows={2} maxLength={500} value={issuer.address} onChange={(e) => setIssuer((v) => ({ ...v, address: e.target.value }))} />
                )}
              </Field>
            </fieldset>
          )}

          {group === 'reminders' && (
            <fieldset disabled={!editable}>
              <legend className="sr-only">{tx(PAY.reminders)}</legend>
              {/* Before the due date, on it, after it: the reminders in the order they fire. */}
              <ul className="set-reminders">
                {inOrder.map((r) => (
                  <li key={r.key} className={r.offsetDays === 0 ? 'set-reminder set-reminder--due' : 'set-reminder'}>
                    <label>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => setReminders((rs) => rs.map((x) => (x.key === r.key ? { ...x, enabled: e.target.checked } : x)))}
                      />
                      {reminderLabel(r.offsetDays, locale)}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </div>

        {/* The card switch is its own confirmed act: its group carries no Save unless another group waits to be saved. */}
        {/* One Save for every group, shown once there is something to save (or it just saved). */}
        {editable && (editedNames.length > 0 || saved) && (
          <div className="set-save">
            <button type="button" className="btn btn--primary" disabled={save.isPending || editedNames.length === 0} onClick={submit}>
              {save.isPending ? tx(PAY.saving) : tx(PAY.save)}
            </button>
            {editedNames.length > 0 ? (
              <span className="set-save__state">{tx(PAY.unsaved, { groups: editedNames.join(locale === 'ar' ? '، ' : ', ') })}</span>
            ) : saved ? (
              <span className="set-save__state set-save__state--ok" role="status">
                <Icon name="check" size={16} />
                <span>{tx(PAY.saved)}</span>
              </span>
            ) : (
              <span className="set-save__state">{tx(PAY.saveScope)}</span>
            )}
          </div>
        )}
      </section>
      {confirmPause && <CardPauseDialog paused={settings.cardPaused} onClose={() => setConfirmPause(false)} />}
    </div>
  )
}

/**
 * W63: that card payments are paused and what it means, in the group that
 * holds the switch. The same sentence the masthead's tag stands for.
 */
function CardPausedNote() {
  const tx = useCopy()
  const state = tx(PAY.cardPausedBadge)
  const whole = tx(PAY.cardPausedBanner)
  // The sentence opens with the state's own words: those stand as the status, the rest beneath.
  const rest = whole.startsWith(state) ? whole.slice(state.length).replace(/^[.،:;\s]+/, '') : whole
  return (
    <div className="set-paused">
      <Badge tone="warn" dot>
        {state}
      </Badge>
      <span className="set-paused__why">{rest}</span>
    </div>
  )
}

/**
 * W63: confirm before pausing or resuming card payments. Sends only
 * `{ cardPaused }`; the server checks the role again and writes the audit row.
 */
function CardPauseDialog({ paused, onClose }: { paused: boolean; onClose: () => void }) {
  const tx = useCopy()
  const save = useSaveBillingSettings()
  const submit = () => save.mutate({ cardPaused: !paused }, { onSuccess: onClose })
  return (
    <Dialog
      title={tx(paused ? PAY.resumeCardTitle : PAY.pauseCardTitle)}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={save.isPending} saveLabel={tx(paused ? PAY.resumeCard : PAY.pauseCard)} />}
    >
      <ServerError error={save.error} />
      <p className="field__hint">{tx(paused ? PAY.resumeCardHint : PAY.pauseCardHint)}</p>
    </Dialog>
  )
}
