import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import type { CertificateCategory } from './api'
import { C, describeError, useCopy } from './copy'
import { useCertificateTypes, useSaveType } from './hooks'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/**
 * PD-41 owner safeguard 6: the super admin keeps the types. A type is enabled
 * or disabled, never deleted -- there is no delete button because the server
 * has no delete.
 */
export function TypesPanel() {
  const tx = useCopy()
  const { locale } = useI18n()
  const types = useCertificateTypes(undefined, true)
  const save = useSaveType()
  const [category, setCategory] = useState<CertificateCategory>('student')
  const [key, setKey] = useState('')
  const [labelEn, setLabelEn] = useState('')
  const [labelAr, setLabelAr] = useState('')
  const [needsJuz, setNeedsJuz] = useState(false)
  const [needsMonth, setNeedsMonth] = useState(false)

  const add = () =>
    save.mutate(
      { body: { category, key: key.trim(), labelEn: labelEn.trim(), labelAr: labelAr.trim(), needsJuz, needsPeriod: needsMonth ? 'month' : null } },
      {
        onSuccess: () => {
          setKey('')
          setLabelEn('')
          setLabelAr('')
        },
      },
    )

  return (
    <section aria-label={tx(C.typesTitle)}>
      <p className="field__hint">{tx(C.typesHint)}</p>
      <QueryBoundary isLoading={types.isLoading} error={types.error} onRetry={() => void types.refetch()}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(C.students)} / {tx(C.teachers)}</th>
                <th scope="col">{tx(C.labelAr)}</th>
                <th scope="col">{tx(C.labelEn)}</th>
                <th scope="col">{tx(C.enabled)}</th>
              </tr>
            </thead>
            <tbody>
              {(types.data?.types ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{tx(t.category === 'student' ? C.students : C.teachers)}</td>
                  <td dir="rtl">{t.labelAr}</td>
                  <td>{t.labelEn}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${tx(C.enabled)}: ${t.labelEn}`}
                      checked={t.isActive}
                      disabled={save.isPending}
                      onChange={(e) => save.mutate({ typeId: t.id, body: { isActive: e.target.checked } })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
      <div className="cert-row">
        <SearchableSelect className="select" aria-label={tx(C.type)} value={category} onValueChange={(v) => setCategory(v as CertificateCategory)}>
          <option value="student">{tx(C.students)}</option>
          <option value="teacher">{tx(C.teachers)}</option>
        </SearchableSelect>
        <input className="input" aria-label={tx(C.key)} placeholder={tx(C.key)} value={key} onChange={(e) => setKey(e.target.value)} />
        <input className="input" dir="rtl" aria-label={tx(C.labelAr)} placeholder={tx(C.labelAr)} value={labelAr} onChange={(e) => setLabelAr(e.target.value)} />
        <input className="input" aria-label={tx(C.labelEn)} placeholder={tx(C.labelEn)} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
        <label className="checkbox">
          <input type="checkbox" checked={needsJuz} onChange={(e) => setNeedsJuz(e.target.checked)} /> {tx(C.needsJuz)}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={needsMonth} onChange={(e) => setNeedsMonth(e.target.checked)} /> {tx(C.needsMonth)}
        </label>
        <button type="button" className="btn btn--primary" disabled={!key.trim() || !labelEn.trim() || !labelAr.trim() || save.isPending} onClick={add}>
          {tx(C.addType)}
        </button>
      </div>
      {save.error != null && <div className="field__error" role="alert">{describeError(save.error, locale)}</div>}
    </section>
  )
}
