import { useCallback, useId, useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { LoadingState } from '@/shared/components/States'
import { Field } from '@/shared/components/Field'
import { useStructure } from '@/features/organization/hooks'
import { roleFitsTier, type AccessRole, type CreatableTier, type CreatedStaffAccount, type PermissionEntry } from './api'
import { RISK, SA, TIER, describeError, pageLabel, useCopy } from './copy'
import { useAccessRoles, useCreateStaffAccount, usePermissionCatalogue } from './hooks'
import { StaffCodeSheet } from './StaffCodeSheet'

const CREATABLE: CreatableTier[] = ['specialist', 'admin', 'coverage', 'manager']

/**
 * PD-40 (plan §8): a new staff account in three steps -- identity, placement,
 * roles -- then a reason and the code sheet, shown once.
 *
 * A department manager creates a specialist in the department they run: the
 * tier and the department are fixed (S1). The super admin picks the tier, and
 * a department only for a specialist (a supervisor's or manager's comes from
 * the organization structure). The roles offered are the ones the server says
 * this caller may grant (`grantable`) at that tier; the server decides again.
 * While the server is answering the dialog cannot be closed: closing then
 * would lose the code.
 */
export function NewStaffAccountDialog({ onClose }: { onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const superAdmin = staff ? isSuperAdmin(staff.role) : false
  const create = useCreateStaffAccount()
  const structure = useStructure()
  const roles = useAccessRoles()
  const catalogue = usePermissionCatalogue()
  const tierId = useId()
  const departmentId = useId()
  const reasonId = useId()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [form, setForm] = useState({ name: '', email: '' })
  const [tier, setTier] = useState<CreatableTier>('specialist')
  const [department, setDepartment] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [created, setCreated] = useState<CreatedStaffAccount | null>(null)

  const { isPending, reset } = create
  const close = useCallback(() => {
    if (isPending) return
    reset()
    onClose()
  }, [isPending, reset, onClose])

  const departments = structure.data?.departments ?? []
  const managed = superAdmin ? null : (departments.find((d) => d.manager?.id === staff?.id) ?? null)
  const effectiveTier: CreatableTier = superAdmin ? tier : 'specialist'
  const effectiveDepartment = superAdmin ? (tier === 'specialist' && department ? department : null) : (managed?.id ?? null)
  const offered = (roles.data?.roles ?? []).filter((r) => r.grantable && !r.archived && roleFitsTier(r.maxTier, effectiveTier))
  // A role no longer offered (the tier changed) is never sent.
  const chosen = roleIds.filter((id) => offered.some((r) => r.id === id))

  if (created) return <StaffCodeSheet signIn={created.signIn} firstLogin={created.firstLogin} forCreation onClose={close} />

  const identityMissing = !form.name.trim() || !form.email.trim()
  const placementBlocked = !superAdmin && (structure.isLoading || structure.error != null || managed === null)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const next = () => {
    if (step === 1) {
      setTouched(true)
      if (identityMissing) return
      setStep(2)
    } else if (step === 2 && !placementBlocked) {
      setStep(3)
    }
  }

  const submit = () => {
    if (!reason.trim() || (!superAdmin && effectiveDepartment === null)) return
    create.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        tier: effectiveTier,
        ...(effectiveDepartment ? { departmentId: effectiveDepartment } : {}),
        roleIds: chosen,
        reason: reason.trim(),
      },
      { onSuccess: setCreated },
    )
  }

  return (
    <Dialog
      title={tx(SA.newTitle)}
      onClose={close}
      footer={
        <>
          {step === 1 ? (
            <DialogCancelButton onClick={close} disabled={isPending} />
          ) : (
            <button type="button" className="btn" disabled={isPending} onClick={() => setStep(step === 3 ? 2 : 1)}>
              {tx(SA.back)}
            </button>
          )}
          {step < 3 ? (
            <button type="button" className="btn btn--primary" disabled={step === 2 && placementBlocked} onClick={next}>
              {tx(SA.next)}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={isPending || !reason.trim()} onClick={submit}>
              {isPending ? tx(SA.creating) : tx(SA.create)}
            </button>
          )}
        </>
      }
    >
      {step === 1 && (
        <>
          <p className="sa-step">{tx(SA.stepIdentity)}</p>
          <Field label={tx(SA.fullName)} value={form.name} onChange={set('name')} error={touched && !form.name.trim() ? tx(SA.required) : null} />
          <Field
            label={tx(SA.signInEmail)}
            type="email"
            value={form.email}
            onChange={set('email')}
            error={touched && !form.email.trim() ? tx(SA.required) : null}
          />
          <p className="field__hint">{tx(SA.signInHint)}</p>
        </>
      )}

      {step === 2 && (
        <>
          <p className="sa-step">{tx(SA.stepPlacement)}</p>
          {superAdmin ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor={tierId}>
                  {tx(SA.tier)}
                </label>
                <select id={tierId} className="input" value={tier} onChange={(e) => setTier(e.target.value as CreatableTier)}>
                  {CREATABLE.map((t) => (
                    <option key={t} value={t}>
                      {tx(TIER[t]!)}
                    </option>
                  ))}
                </select>
              </div>
              {tier !== 'specialist' ? (
                <p className="field__hint">{tx(SA.departmentOnlySpecialist)}</p>
              ) : structure.data ? (
                <div className="field">
                  <label className="field__label" htmlFor={departmentId}>
                    {tx(SA.department)}
                  </label>
                  <select id={departmentId} className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">{tx(SA.noDepartment)}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : structure.error ? (
                <StructureRefusal error={structure.error} />
              ) : (
                structure.isLoading && <LoadingState compact />
              )}
            </>
          ) : structure.isLoading ? (
            <LoadingState compact />
          ) : structure.error ? (
            <StructureRefusal error={structure.error} />
          ) : managed ? (
            <>
              <dl className="sa-fixed">
                <dt>{tx(SA.tier)}</dt>
                <dd>{tx(TIER.specialist!)}</dd>
                <dt>{tx(SA.department)}</dt>
                <dd dir="auto">{managed.displayName}</dd>
              </dl>
              <p className="field__hint">{tx(SA.fixedPlacement)}</p>
            </>
          ) : (
            <div className="banner banner--warn" role="alert">
              {tx(SA.noManagedDepartment)}
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <p className="sa-step">{tx(SA.stepRoles)}</p>
          {roles.isLoading ? (
            <LoadingState compact />
          ) : offered.length === 0 ? (
            <p className="field__hint">{tx(SA.noGrantableRoles)}</p>
          ) : (
            <fieldset className="field">
              <legend className="field__label">{tx(SA.roles)}</legend>
              <ul className="sa-picker">
                {offered.map((r) => (
                  <li key={r.id}>
                    <label className="sa-check">
                      <input
                        type="checkbox"
                        checked={chosen.includes(r.id)}
                        onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id)))}
                      />
                      <span dir="auto">{locale === 'ar' ? r.nameAr : r.nameEn}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <span className="field__hint">{tx(SA.rolesHint)}</span>
            </fieldset>
          )}
          <PermissionPreview roles={offered.filter((r) => chosen.includes(r.id))} catalogue={catalogue.data?.permissions ?? []} />
          <div className="field">
            <label className="field__label" htmlFor={reasonId}>
              {tx(SA.reason)}
            </label>
            <textarea id={reasonId} className="textarea" rows={2} dir="auto" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {create.error != null && (
            <div className="banner banner--danger" role="alert">
              {describeError(create.error, locale)}
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

/** GET /org/structure refused or failed: its own words, not "you do not run a department" (review of #239). */
function StructureRefusal({ error }: { error: unknown }) {
  const { locale } = useI18n()
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

/**
 * "This account will open: Certificates (view, design)" -- the chosen roles'
 * keys, grouped by page, each risky one flagged in red. What the account
 * finally holds is the server's (its tier's bundle and these roles).
 */
export function PermissionPreview({ roles, catalogue }: { roles: AccessRole[]; catalogue: PermissionEntry[] }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const pages = useMemo(() => groupByPage(roles.flatMap((r) => r.permissions), catalogue), [roles, catalogue])
  return (
    <section className="sa-preview" aria-label={tx(SA.previewTitle)}>
      <h3 className="sa-preview__title">{tx(SA.previewTitle)}</h3>
      {pages.length === 0 ? (
        <p className="field__hint">{tx(SA.previewNothing)}</p>
      ) : (
        <ul>
          {pages.map(({ page, entries }) => (
            <li key={page}>
              <strong>{tx(pageLabel(page))}</strong>
              <div className="sa-preview__keys">
                {entries.map((p) => (
                  <span key={p.key}>
                    <span>{locale === 'ar' ? p.label.ar : p.label.en}</span> <RiskBadge risk={p.risk} />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A red badge for the risks plan §8 names (personal data, money, family contact); nothing otherwise. */
export function RiskBadge({ risk }: { risk: string }) {
  const tx = useCopy()
  const label = RISK[risk]
  return label ? <Badge tone="danger">{tx(label)}</Badge> : null
}

/** Keys grouped by page in catalogue order; a key the catalogue does not know is shown by its key. */
export function groupByPage(keys: readonly string[], catalogue: readonly PermissionEntry[]): Array<{ page: string; entries: PermissionEntry[] }> {
  const wanted = new Set(keys)
  const known = new Map(catalogue.map((p) => [p.key, p]))
  const entries: PermissionEntry[] = [
    ...catalogue.filter((p) => wanted.has(p.key)),
    ...[...wanted]
      .filter((k) => !known.has(k))
      .sort()
      .map((k) => {
        const dot = k.indexOf('.')
        return { key: k, page: dot > 0 ? k.slice(0, dot) : k, action: dot > 0 ? k.slice(dot + 1) : '', label: { en: k, ar: k }, risk: 'none', delegable: false, inRoles: true }
      }),
  ]
  const out: Array<{ page: string; entries: PermissionEntry[] }> = []
  for (const p of entries) {
    let group = out.find((g) => g.page === p.page)
    if (!group) {
      group = { page: p.page, entries: [] }
      out.push(group)
    }
    group.entries.push(p)
  }
  return out
}
