import { useId } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { P } from './copy'

/** The countries the intake offers for reading a local number (kept identical, so a lead converts with the same reading). */
const COUNTRIES = ['EG', 'AE', 'SA', 'KW', 'QA', 'BH', 'OM', 'JO', 'GB', 'US', 'CA', 'AU', 'DE', 'FR']

export interface ContactDraft {
  parentName: string
  phone: string
  whatsapp: string
  email: string
  country: string
}

export const emptyContact = (): ContactDraft => ({ parentName: '', phone: '', whatsapp: '', email: '', country: '' })

export const hasChannel = (c: ContactDraft) => !!(c.phone.trim() || c.whatsapp.trim() || c.email.trim())

/** True when anything was typed -- a lead may be recorded with no parent contact at all. */
export const contactTouched = (c: ContactDraft) => !!(c.parentName.trim() || hasChannel(c))

export function contactValid(c: ContactDraft): boolean {
  return !!c.parentName.trim() && hasChannel(c)
}

/** The request body for a contact: empty fields are sent as null (cleared). */
export function contactInput(c: ContactDraft) {
  const v = (s: string) => s.trim() || null
  return { parentName: v(c.parentName), phone: v(c.phone), whatsapp: v(c.whatsapp), email: v(c.email), country: v(c.country) }
}

/** The parent's name and the ways to reach them. Pickers are SearchableSelect, never a native select. */
export function ContactFields({ value, onChange, invalid }: { value: ContactDraft; onChange: (next: ContactDraft) => void; invalid?: boolean }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const uid = useId()
  const set = (patch: Partial<ContactDraft>) => onChange({ ...value, ...patch })
  return (
    <fieldset className="tj-fieldset">
      <legend className="tj-legend">{tx(P.parentSection)}</legend>
      <p className="field__hint">{tx(P.parentHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-name`}>{tx(P.parentName)}</label>
        <input id={`${uid}-name`} className="input" dir="auto" value={value.parentName} aria-invalid={invalid && !value.parentName.trim()} onChange={(e) => set({ parentName: e.target.value })} />
      </div>
      <div className="tj-row">
        <div className="field">
          <label className="field__label" htmlFor={`${uid}-phone`}>{tx(P.phoneNumber)}</label>
          <input id={`${uid}-phone`} className="input" type="tel" inputMode="tel" dir="ltr" value={value.phone} onChange={(e) => set({ phone: e.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${uid}-whatsapp`}>{tx(P.whatsappNumber)}</label>
          <input id={`${uid}-whatsapp`} className="input" type="tel" inputMode="tel" dir="ltr" value={value.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-email`}>{tx(P.emailAddress)}</label>
        <input id={`${uid}-email`} className="input" type="email" inputMode="email" dir="ltr" value={value.email} onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-country`}>{tx(P.country)}</label>
        <SearchableSelect id={`${uid}-country`} className="input" value={value.country} onValueChange={(v) => set({ country: v })}>
          <option value="">{tx(P.noCountry)}</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </SearchableSelect>
        <span className="field__hint">{tx(P.countryHint)}</span>
      </div>
    </fieldset>
  )
}
