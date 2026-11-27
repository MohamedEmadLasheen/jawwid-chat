import { useEffect, useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { DialogCancelButton } from '@/shared/components/Dialog'
import { DetailActions, DetailEnd, DetailSection, FlowSteps, type FlowStep, type StepState } from '@/shared/components/RequestQueue'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { QueryBoundary } from '@/shared/components/States'
import { formatWhen } from '@/features/trials/copy'
import { IntakeDialog, type IntakePrefill } from '@/features/intake/IntakeDialog'
import { useIntakeOptions } from '@/features/intake/hooks'
import { LOST_REASONS, STAGES, type LeadContact, type LeadDetail as Lead, type LostReason, type Stage } from './api'
import { ContactFields, contactInput, contactValid, emptyContact, type ContactDraft } from './ContactFields'
import { LOST, P, STAGE, describePipelineError, lostText } from './copy'
import { useConvertLead, useLead, useMarkContacted, useOwners, usePipelineAccess, useReassign, useUpdateLead } from './hooks'

const draftOf = (c: LeadContact | null): ContactDraft =>
  c ? { parentName: c.parentName, phone: c.phone ?? '', whatsapp: c.whatsapp ?? '', email: c.email ?? '', country: c.country ?? '' } : emptyContact()

/** The stages a lead walks through; Lost is an ending, not a step on the way. */
const WALK = STAGES.filter((s) => s !== 'lost')

/** A lead's stage and what stands beside it: a due follow-up, the hand-over. */
export function LeadStatus({ lead }: { lead: Pick<Lead, 'stage' | 'lostReason' | 'followUpDue'> & { convertedAt?: string | null } }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const stage = STAGE[lead.stage]
  return (
    <>
      <Badge tone={stage.tone} dot>{tx(stage.label)}</Badge>
      {lead.lostReason && lead.stage === 'lost' && <span className="ts-muted">{lostText(lead.lostReason, locale)}</span>}
      {lead.followUpDue && <Badge tone="danger" dot>{tx(P.followUpDue)}</Badge>}
      {lead.convertedAt && <Badge tone="ok">{tx(P.handedOver)}</Badge>}
    </>
  )
}

/** The lead's walk from the first call to the hand-over, with what the record says of each stage. */
function leadSteps(lead: Lead, tx: (p: { en: string; ar: string }) => string, locale: 'ar' | 'en'): FlowStep[] {
  const lost = lead.stage === 'lost'
  const at = WALK.indexOf(lead.stage as Exclude<Stage, 'lost'>)
  // A lost lead got as far as its record shows.
  const seen: Record<string, boolean> = {
    new_lead: true,
    contacted: !!lead.lastContactedAt,
    trial_booked: !!lead.trial,
    trial_completed: !!lead.trial?.result,
    converted: false,
  }
  const when = (iso: string | null | undefined) => (iso ? <time dateTime={iso}>{formatWhen(iso, locale)}</time> : undefined)
  const meta: Partial<Record<Stage, FlowStep['meta']>> = {
    new_lead: when(lead.createdAt),
    contacted: when(lead.lastContactedAt),
    trial_booked: when(lead.trial?.startsAt),
    converted: lead.convertedAt ? <>{tx(P.handedOver)} · {when(lead.convertedAt)}</> : undefined,
  }
  const steps: FlowStep[] = WALK.map((s, i) => {
    const state: StepState = lost ? (seen[s] ? 'done' : 'skipped') : i < at || s === 'converted' && at === i ? 'done' : i === at ? 'current' : 'todo'
    return { key: s, label: tx(STAGE[s].label), state, meta: state === 'todo' || state === 'skipped' ? undefined : meta[s] }
  })
  if (lost) steps.push({ key: 'lost', label: tx(STAGE.lost.label), state: 'problem', meta: lead.lostReason ? lostText(lead.lostReason, locale) : undefined })
  return steps
}

/**
 * The open lead. Mounting this is what reads the contact, and the server
 * records that read in the audit log: it happens once, when a lead is opened.
 * `onLead` tells the page what was read, for the panel's title and status.
 */
export function LeadPanel({ id, onLead }: { id: string; onLead: (lead: Lead) => void }) {
  const q = useLead(id)
  const lead = q.data
  useEffect(() => {
    if (lead) onLead(lead)
  }, [lead, onLead])
  return (
    <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {lead && <LeadBody lead={lead} />}
    </QueryBoundary>
  )
}

/**
 * One lead: its steps, its follow-up, the parent's contact and the actions.
 * The stage buttons are offered only where the server would accept them; every
 * one is decided there again.
 */
function LeadBody({ lead }: { lead: Lead }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const uid = useId()
  const update = useUpdateLead(lead.id)
  const contacted = useMarkContacted(lead.id)
  const convert = useConvertLead(lead.id)
  const reassign = useReassign(lead.id)
  const access = usePipelineAccess()
  // Only the Sales manager and the super admin assign; the server refuses everyone else again.
  const mayAssign = access.data?.standing === 'sales_manager' || access.data?.standing === 'super_admin'
  const owners = useOwners(mayAssign)
  const [newOwner, setNewOwner] = useState('')
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

  const error = update.error ?? contacted.error ?? convert.error ?? reassign.error

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

  const manual = lead.manualStage
  return (
    <>
      {error && <div className="banner banner--danger" role="alert">{describePipelineError(error, locale)}</div>}
      {message && <div className="banner banner--ok" role="status">{message}</div>}

      <DetailSection title={tx(P.steps)}>
        <FlowSteps steps={leadSteps(lead, tx, locale)} label={tx(P.steps)} />
        {!manual && lead.stage !== 'converted' && <p className="field__hint lead-derived">{tx(P.stageDerived)}</p>}
      </DetailSection>

      <DetailSection title={tx(P.about)}>
        <dl className="rq-fields">
          <div className="rq-field">
            <dt>{tx(P.owner)}</dt>
            <dd><bdi>{lead.owner?.name || tx(P.unassigned)}</bdi></dd>
          </div>
          {lead.level && (
            <div className="rq-field">
              <dt>{tx(P.level)}</dt>
              <dd dir="auto">{lead.level}</dd>
            </div>
          )}
          {lead.trial && (
            <div className="rq-field">
              <dt>{tx(P.trial)}</dt>
              <dd><time dateTime={lead.trial.startsAt}>{formatWhen(lead.trial.startsAt, locale)}</time></dd>
            </div>
          )}
          {lead.lastContactedAt && (
            <div className="rq-field">
              <dt>{tx(P.lastContacted)}</dt>
              <dd><time dateTime={lead.lastContactedAt}>{formatWhen(lead.lastContactedAt, locale)}</time></dd>
            </div>
          )}
        </dl>
        {lead.note && <p className="rq-quote lead-note" dir="auto">{lead.note}</p>}
        {mayAssign && (
          <div className="field lead-reassign">
            <label className="field__label" htmlFor={`${uid}-owner`}>{tx(P.reassign)}</label>
            <div className="lead-actions lead-actions--wrap">
              <SearchableSelect id={`${uid}-owner`} className="input" value={newOwner} clearable={false} onValueChange={(v) => setNewOwner(v)}>
                <option value="">{tx(P.chooseOwner)}</option>
                {(owners.data?.owners ?? []).filter((o) => o.id !== lead.owner?.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </SearchableSelect>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!newOwner || reassign.isPending}
                onClick={() => reassign.mutate(newOwner, { onSuccess: () => { setNewOwner(''); setMessage(tx(P.reassignDone)) } })}
              >
                {tx(P.reassign)}
              </button>
            </div>
          </div>
        )}
      </DetailSection>

      <DetailSection title={tx(P.contactSection)}>
        {editingContact ? (
          <>
            <ContactFields value={contactDraft} onChange={setContactDraft} invalid />
            <div className="lead-actions">
              <DialogCancelButton onClick={() => { setEditingContact(false); setContactDraft(draftOf(lead.contact)) }} />
              <button type="button" className="btn btn--primary" onClick={saveContact} disabled={update.isPending || !contactValid(contactDraft)}>
                {update.isPending ? tx(P.saving) : tx(P.save)}
              </button>
            </div>
          </>
        ) : lead.contact ? (
          <>
            <dl className="rq-fields">
              <div className="rq-field"><dt>{tx(P.parentName)}</dt><dd dir="auto">{lead.contact.parentName}</dd></div>
              <div className="rq-field"><dt>{tx(P.phone)}</dt><dd>{lead.contact.phone ? <bdi dir="ltr" className="ns-ltr">{lead.contact.phone}</bdi> : <span className="ts-muted">—</span>}</dd></div>
              <div className="rq-field"><dt>{tx(P.whatsapp)}</dt><dd>{lead.contact.whatsapp ? <bdi dir="ltr" className="ns-ltr">{lead.contact.whatsapp}</bdi> : <span className="ts-muted">—</span>}</dd></div>
              <div className="rq-field"><dt>{tx(P.email)}</dt><dd>{lead.contact.email ? <bdi dir="ltr" className="ns-ltr">{lead.contact.email}</bdi> : <span className="ts-muted">—</span>}</dd></div>
            </dl>
            <p className="field__hint lead-logged">{tx(P.contactLogged)}</p>
            <button type="button" className="btn btn--sm" onClick={() => setEditingContact(true)}>{tx(P.edit)}</button>
          </>
        ) : (
          <>
            <p className="rq-note">{lead.convertedAt ? tx(P.contactMoved) : tx(P.noContact)}</p>
            {!lead.convertedAt && <button type="button" className="btn btn--sm lead-add" onClick={() => setEditingContact(true)}>{tx(P.addContact)}</button>}
          </>
        )}
      </DetailSection>

      <DetailSection title={tx(P.followUp)}>
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
      </DetailSection>

      {losing && (
        <section className="rq-section lead-losing">
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-reason`}>{tx(P.lostReasonLabel)}</label>
            <SearchableSelect id={`${uid}-reason`} className="input" value={reason} clearable={false} onValueChange={(v) => setReason(v as LostReason | '')}>
              <option value="">{tx(P.chooseReason)}</option>
              {LOST_REASONS.map((r) => <option key={r} value={r}>{tx(LOST[r])}</option>)}
            </SearchableSelect>
          </div>
          <div className="lead-actions">
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

      {manual && lead.stage !== 'lost' && !losing && (
        <DetailEnd>
          <button type="button" className="btn btn--sm rq-danger" onClick={() => setLosing(true)}>{tx(P.markLost)}</button>
        </DetailEnd>
      )}
      {lead.canConvert && <p className="field__hint lead-convert-hint">{tx(P.convertHint)}</p>}
      <DetailActions>
        {lead.canConvert && (
          <button type="button" className="btn btn--primary" disabled={convert.isPending} onClick={doConvert} title={tx(P.convertHint)}>
            {tx(P.convert)}
          </button>
        )}
        {manual && lead.stage !== 'lost' && (
          <button
            type="button"
            className="btn"
            disabled={contacted.isPending}
            onClick={() => contacted.mutate({ nextFollowUpOn: followUp || null, followUpNote: followUpNote.trim() || null }, { onSuccess: () => setMessage(tx(P.contactedDone)) })}
          >
            {tx(P.markContacted)}
          </button>
        )}
        {manual && lead.stage === 'lost' && (
          <button type="button" className="btn" disabled={update.isPending} onClick={() => update.mutate({ stage: 'contacted' })}>{tx(P.reopen)}</button>
        )}
      </DetailActions>

      {handing && intake.data && (
        <IntakeDialog
          options={intake.data}
          initial={{ kind: 'new', prefill: handing }}
          onClose={() => setHanding(null)}
          // The family now exists, so converting again finds it by its contact key and links it.
          onEntered={() => convert.mutate(undefined, { onSuccess: (r) => r.outcome === 'linked' && setMessage(tx(P.linked)) })}
        />
      )}
    </>
  )
}
