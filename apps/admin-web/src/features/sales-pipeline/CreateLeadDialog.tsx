import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { ContactFields, contactInput, contactTouched, contactValid, emptyContact } from './ContactFields'
import { P, describePipelineError } from './copy'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { useCreateLead, useOwners, usePipelineAccess } from './hooks'

/** New lead: the prospect's name, optionally the parent's contact and the first follow-up. */
export function CreateLeadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const uid = useId()
  const create = useCreateLead()
  const access = usePipelineAccess()
  const mayAssign = access.data?.standing === 'sales_manager' || access.data?.standing === 'super_admin'
  const owners = useOwners(mayAssign)
  const [ownerId, setOwnerId] = useState('')
  const [name, setName] = useState('')
  const [level, setLevel] = useState('')
  const [note, setNote] = useState('')
  const [contact, setContact] = useState(emptyContact())
  const [followUp, setFollowUp] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  const [tried, setTried] = useState(false)

  const touched = contactTouched(contact)
  const problem = !name.trim() ? tx(P.needName) : touched && !contactValid(contact) ? tx(P.needParent) : null

  const save = () => {
    setTried(true)
    if (problem) return
    create.mutate(
      {
        displayName: name.trim(),
        level: level.trim() || null,
        note: note.trim() || null,
        ...(touched ? { contact: contactInput(contact) } : {}),
        nextFollowUpOn: followUp || null,
        followUpNote: followUpNote.trim() || null,
        ...(mayAssign && ownerId ? { ownerId } : {}),
      },
      { onSuccess: (lead) => onCreated(lead.id) },
    )
  }

  return (
    <Dialog
      title={tx(P.createTitle)}
      onClose={onClose}
      variant="sheet"
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" onClick={save} disabled={create.isPending}>
            {create.isPending ? tx(P.saving) : tx(P.create)}
          </button>
        </>
      }
    >
      {create.error && <div className="banner banner--danger" role="alert">{describePipelineError(create.error, locale)}</div>}
      {tried && problem && <div className="banner banner--danger" role="alert">{problem}</div>}
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-name`}>{tx(P.childName)} <span className="field__required" aria-label={tx(P.required)}>*</span></label>
        <input id={`${uid}-name`} className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-level`}>{tx(P.level)}</label>
        <input id={`${uid}-level`} className="input" dir="auto" value={level} onChange={(e) => setLevel(e.target.value)} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-note`}>{tx(P.note)}</label>
        <textarea id={`${uid}-note`} className="input" dir="auto" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {mayAssign && (
        <div className="field">
          <label className="field__label" htmlFor={`${uid}-owner`}>{tx(P.ownerOptional)}</label>
          <SearchableSelect id={`${uid}-owner`} className="input" value={ownerId} onValueChange={(v) => setOwnerId(v)}>
            <option value="">{tx(P.chooseOwner)}</option>
            {(owners.data?.owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </SearchableSelect>
        </div>
      )}
      <ContactFields value={contact} onChange={setContact} invalid={tried && touched} />
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
    </Dialog>
  )
}
