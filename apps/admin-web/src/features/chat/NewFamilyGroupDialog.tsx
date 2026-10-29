import { useId, useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { describeError } from '@/features/organization/copy'
import { useCreateFamilyGroup, useGroupCandidates } from '@/features/organization/hooks'
import { chatCopyFor } from './copy'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import './family-group.css'

/**
 * PD-8: a supervisor creates a group about their own children of ONE family,
 * with the parents and those children's teachers they choose.
 *
 * The picker offers only what `GET /org/group-candidates` says this person
 * acts for, and steers away from what the server would refuse (two supervisors'
 * children in one group). It is guidance, not the control: the creation
 * request re-checks every person and every child, and the database refuses an
 * incorrect association whatever is sent.
 */
export function NewFamilyGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const ids = { family: useId(), title: useId() }
  const candidates = useGroupCandidates()
  const create = useCreateFamilyGroup()
  const families = candidates.data?.families ?? []

  const [familyId, setFamilyId] = useState('')
  const [children, setChildren] = useState<string[]>([])
  const [parents, setParents] = useState<string[] | null>(null)
  const [teachers, setTeachers] = useState<string[] | null>(null)
  const [title, setTitle] = useState('')
  const [touched, setTouched] = useState(false)

  const family = families.find((f) => f.familyId === familyId) ?? null
  const chosen = family?.children.filter((c) => children.includes(c.id)) ?? []
  // One supervisor per group: the first child chosen fixes it.
  const supervisorId = chosen[0]?.supervisor.id ?? null
  const teacherOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of chosen) if (c.teacher) seen.set(c.teacher.id, c.teacher.name)
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [chosen])
  // Defaults until the user changes them: every messaging parent, every teacher of the chosen children.
  const parentIds = parents ?? (family?.parents.map((p) => p.id) ?? [])
  const teacherIds = (teachers ?? teacherOptions.map((t) => t.id)).filter((id) => teacherOptions.some((t) => t.id === id))

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  return (
    <Dialog
      title={copy.newGroup}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={create.isPending || !family}
            onClick={() => {
              setTouched(true)
              if (chosen.length === 0) return
              create.mutate(
                {
                  learnerIds: chosen.map((c) => c.id),
                  contactIds: parentIds,
                  teacherIds,
                  ...(title.trim() ? { title: title.trim() } : {}),
                },
                { onSuccess: (conv) => onCreated(conv.id) },
              )
            }}
          >
            {create.isPending ? copy.groupCreating : copy.groupCreate}
          </button>
        </>
      }
    >
      <p className="field__hint">{copy.newGroupHint}</p>
      <QueryBoundary
        isLoading={candidates.isLoading}
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
        isEmpty={families.length === 0}
        emptyTitle={copy.groupNoCandidates}
      >
        <div className="field">
          <label className="field__label" htmlFor={ids.family}>{copy.groupFamily}</label>
          <SearchableSelect
            id={ids.family}
            className="select"
            value={familyId}
            onValueChange={(v) => {
              setFamilyId(v)
              setChildren([])
              setParents(null)
              setTeachers(null)
            }}
          >
            <option value="">—</option>
            {families.map((f) => (
              <option key={f.familyId} value={f.familyId}>{f.displayName}</option>
            ))}
          </SearchableSelect>
        </div>

        {family && (
          <>
            <fieldset className="field fg-set">
              <legend className="field__label">{copy.groupChildren}</legend>
              {family.children.map((c) => {
                const other = supervisorId !== null && c.supervisor.id !== supervisorId
                return (
                  <label key={c.id} className="fg-check">
                    <input
                      type="checkbox"
                      checked={children.includes(c.id)}
                      disabled={other}
                      onChange={() => setChildren((list) => toggle(list, c.id))}
                    />
                    <span dir="auto">
                      {c.name} — {c.supervisor.name}
                      {other && <span className="field__hint"> ({copy.groupOtherSupervisor})</span>}
                    </span>
                  </label>
                )
              })}
              {touched && chosen.length === 0 && <span className="field__error">{copy.groupPickChild}</span>}
            </fieldset>

            <fieldset className="field fg-set">
              <legend className="field__label">{copy.groupParents}</legend>
              {family.parents.length === 0 && <span className="field__hint">{copy.groupNoParents}</span>}
              {family.parents.map((p) => (
                <label key={p.id} className="fg-check">
                  <input type="checkbox" checked={parentIds.includes(p.id)} onChange={() => setParents(toggle(parentIds, p.id))} />
                  <span dir="auto">{p.name}</span>
                </label>
              ))}
            </fieldset>

            {chosen.length > 0 && (
              <fieldset className="field fg-set">
                <legend className="field__label">{copy.groupTeachers}</legend>
                {teacherOptions.length === 0 && <span className="field__hint">{copy.groupNoTeachers}</span>}
                {teacherOptions.map((t) => (
                  <label key={t.id} className="fg-check">
                    <input type="checkbox" checked={teacherIds.includes(t.id)} onChange={() => setTeachers(toggle(teacherIds, t.id))} />
                    <span dir="auto">{t.name}</span>
                  </label>
                ))}
              </fieldset>
            )}

            <div className="field">
              <label className="field__label" htmlFor={ids.title}>{copy.groupTitle}</label>
              <input id={ids.title} className="input" value={title} dir="auto" maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </>
        )}
      </QueryBoundary>
      {create.error && (
        <div className="banner banner--danger" role="alert">
          {describeError(create.error, locale)}
        </div>
      )}
    </Dialog>
  )
}
