import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { QueryBoundary } from '@/shared/components/States'
import { formatWhen } from '@/features/trials/copy'
import { IntakeDialog, type IntakePrefill } from '@/features/intake/IntakeDialog'
import { useIntakeOptions } from '@/features/intake/hooks'
import { LOST_REASONS, type LeadContact, type LeadDetail, type LostReason } from './api'
import { ContactFields, contactInput, contactValid, emptyContact, type ContactDraft } from './ContactFields'
import { LOST, P, STAGE, describePipelineError, lostText } from './copy'
import { useConvertLead, useLead, useMarkContacted, useUpdateLead } from './hooks'

const draftOf = (c: LeadContact | null): ContactDraft =>
  c ? { parentName: c.parentName, phone: c.phone ?? '', whatsapp: c.whatsapp ?? '', email: c.email ?? '', country: c.country ?? '' } : emptyContact()

/**
 * One lead: its stage, follow-up, the parent's contact and the actions. Opening
 * it reads the contact, which the server records in the audit log. The stage
 * buttons are offered only where the server would accept them; every one is
 * decided there again.
 */
export function LeadDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const q = useLead(id)
  return (
    <Dialog title={q.data?.displayName ?? tx(P.lead)} onClose={onClose} variant="sheet" footer={<button type="button" className="btn" onClick={onClose}>{tx(P.close)}</button>}>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && <LeadBody lead={q.data} />}
      </QueryBoundary>
    </Dialog>
  )
}

function LeadBody({ lead }: { lead: LeadDetail }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const uid = useId()
  const update = useUpdateLead(lead.id)
  const contacted = useMarkContacted(lead.id)
  const convert = useConvertLead(lead.id)
  const intake = useIntakeOptions()
  const [followUp, setFollowUp] = useState(lead.nextFollowUpOn ?? '')
  const [followUpNote, setFollowUpNote] = useState(lead.followUpNote ?? '')
  const [editingContact, setEditingContact] = useState(false)
  const [contactDraft, setContactDraft] = useState<ContactDraft>(draftOf(lead.contact))
  const [losing, setLosing] = useState(false)
  const [reason, setReason] = useState<LostReason | ''>('')
  const [message, setMessage] = useState<string | null>(null)
  // What the family intake starts with, kept while it is open: converting links the lead and removes its own copy of the contact.
  const [handing, setHanding] = useState<IntakePrefill | null>(null)

  const error = update.error ?? contacted.error ?? convert.error
  const stage = STAGE[lead.stage]

  const doConvert = () => {
    setMessage(null)
    convert.mutate(undefined, {
      onSuccess: (r) => {
        if (r.outcome === 'linked') setMessage(tx(P.linked))
        else if (r.outcome === 'awaiting_enrolment') setMessage(tx(P.awaitingEnrolment))
        else if (lead.contact) {
          setHanding({
            name: lead.contact.parentName,
            phone: lead.contact.phone ?? lead.contact.whatsapp ?? '',
            email: lead.contact.email ?? '',
            country: lead.contact.country ?? '',
          })
        }
      },
    })
  }

  const saveContact = () => {
    if (!contactValid(contactDraft)) return
    update.mutate({ contact: contactInput(contactDraft) }, { onSuccess: () => setEditingContact(false) })
  }

  return (
    <div className="sp-drawer">
      <div className="sp-drawer__head">
        <Badge tone={stage.tone} dot>{tx(stage.label)}</Badge>
        {lead.lostReason && lead.stage === 'lost' && <span className="ts-muted">{lostText(lead.lostReason, locale)}</span>}
        {lead.followUpDue && <Badge tone="warn" dot>{tx(P.followUpDue)}</Badge>}
        {lead.convertedAt && <Badge tone="ok">{tx(P.handedOver)}</Badge>}
      </div>
      {!lead.manualStage && lead.stage !== 'converted' && <p className="field__hint">{tx(P.stageDerived)}</p>}
      {lead.level && <p className="ts-muted" dir="auto">{lead.level}</p>}
      {lead.note && <p dir="auto">{lead.note}</p>}
      {lead.trial && (
        <p className="sp-line">
          <span className="sp-line__label">{tx(P.trial)}</span>
          <time dateTime={lead.trial.startsAt}>{formatWhen(lead.trial.startsAt, locale)}</time>
        </p>
      )}
      {lead.lastContactedAt && (
        <p className="sp-line">
          <span className="sp-line__label">{tx(P.lastContacted)}</span>
          <time dateTime={lead.lastContactedAt}>{formatWhen(lead.lastContactedAt, locale)}</time>
        </p>
      )}

      {error && <div className="banner banner--danger" role="alert">{describePipelineError(error, locale)}</div>}
      {message && <div className="banner banner--ok" role="status">{message}</div>}

      <section className="sp-section" aria-labelledby={`${uid}-contact`}>
        <h3 id={`${uid}-contact`} className="ns-block__title">{tx(P.contactSection)}</h3>
        {editingContact ? (
          <>
            <ContactFields value={contactDraft} onChange={setContactDraft} invalid />
            <div className="sp-actions">
              <DialogCancelButton onClick={() => { setEditingContact(false); setContactDraft(draftOf(lead.contact)) }} />
              <button type="button" className="btn btn--primary" onClick={saveContact} disabled={update.isPending || !contactValid(contactDraft)}>
                {update.isPending ? tx(P.saving) : tx(P.save)}
              </button>
            </div>
          </>
        ) : lead.contact ? (
          <>
            <dl className="ns-pairs">
              <div><dt>{tx(P.parentName)}</dt><dd dir="auto">{lead.contact.parentName}</dd></div>
              <div><dt>{tx(P.phone)}</dt><dd>{lead.contact.phone ? <bdi dir="ltr" className="ns-ltr">{lead.contact.phone}</bdi> : <span className="ts-muted">—</span>}</dd></div>
              <div><dt>{tx(P.whatsapp)}</dt><dd>{lead.contact.whatsapp ? <bdi dir="ltr" className="ns-ltr">{lead.contact.whatsapp}</bdi> : <span className="ts-muted">—</span>}</dd></div>
              <div><dt>{tx(P.email)}</dt><dd>{lead.contact.email ? <bdi dir="ltr" className="ns-ltr">{lead.contact.email}</bdi> : <span className="ts-muted">—</span>}</dd></div>
            </dl>
            <p className="field__hint">{tx(P.contactLogged)}</p>
            <button type="button" className="btn btn--sm" onClick={() => setEditingContact(true)}>{tx(P.edit)}</button>
          </>
        ) : (
          <>
            <p className="ts-muted">{lead.convertedAt ? tx(P.contactMoved) : tx(P.noContact)}</p>
            {!lead.convertedAt && <button type="button" className="btn btn--sm" onClick={() => setEditingContact(true)}>{tx(P.addContact)}</button>}
          </>
        )}
      </section>

      <section className="sp-section">
        <div className="tj-row">
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-fu`}>{tx(P.followUpDate)}</label>
            <input id={`${uid}-fu`} className="input" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-fun`}>{tx(P.followUpNote)}</label>
            <input id={`${uid}-fun`} className="input" dir="auto" value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn--sm"
          disabled={update.isPending}
          onClick={() => update.mutate({ nextFollowUpOn: followUp || null, followUpNote: followUpNote.trim() || null })}
        >
          {tx(P.save)}
        </button>
      </section>

      {losing && (
        <section className="sp-section">
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-reason`}>{tx(P.lostReasonLabel)}</label>
            <SearchableSelect id={`${uid}-reason`} className="input" value={reason} clearable={false} onValueChange={(v) => setReason(v as LostReason | '')}>
              <option value="">{tx(P.chooseReason)}</option>
              {LOST_REASONS.map((r) => <option key={r} value={r}>{tx(LOST[r])}</option>)}
            </SearchableSelect>
          </div>
          <div className="sp-actions">
            <DialogCancelButton onClick={() => setLosing(false)} />
            <button
              type="button"
              className="btn btn--danger"
              disabled={!reason || update.isPending}
              onClick={() => update.mutate({ stage: 'lost', lostReason: reason as LostReason }, { onSuccess: () => setLosing(false) })}
            >
              {tx(P.markLost)}
            </button>
          </div>
        </section>
      )}

      <div className="sp-actions sp-actions--wrap">
        {lead.manualStage && lead.stage !== 'lost' && (
          <button
            type="button"
            className="btn"
            disabled={contacted.isPending}
            onClick={() => contacted.mutate({ nextFollowUpOn: followUp || null, followUpNote: followUpNote.trim() || null }, { onSuccess: () => setMessage(tx(P.contactedDone)) })}
          >
            {tx(P.markContacted)}
          </button>
        )}
        {lead.manualStage && lead.stage !== 'lost' && !losing && (
          <button type="button" className="btn" onClick={() => setLosing(true)}>{tx(P.markLost)}</button>
        )}
        {lead.manualStage && lead.stage === 'lost' && (
          <button type="button" className="btn" disabled={update.isPending} onClick={() => update.mutate({ stage: 'contacted' })}>{tx(P.reopen)}</button>
        )}
        {lead.canConvert && (
          <button type="button" className="btn btn--primary" disabled={convert.isPending} onClick={doConvert} title={tx(P.convertHint)}>
            {tx(P.convert)}
          </button>
        )}
      </div>
      {lead.canConvert && <p className="field__hint">{tx(P.convertHint)}</p>}

      {handing && intake.data && (
        <IntakeDialog
          options={intake.data}
          initial={{ kind: 'new', prefill: handing }}
          onClose={() => setHanding(null)}
          // The family now exists, so converting again finds it by its contact key and links it.
          onEntered={() => convert.mutate(undefined, { onSuccess: (r) => r.outcome === 'linked' && setMessage(tx(P.linked)) })}
        />
      )}
    </div>
  )
}
