import { useId, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { useGroupCandidates, useStructure } from '@/features/organization/hooks'
import { ChangeSupervisorDialog, transferNotice } from '@/features/organization/ChangeSupervisorDialog'
import { T as OrgT, useCopy as useOrgCopy } from '@/features/organization/copy'
import { orgApi, orgKeys } from '@/features/organization/api'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys, type ChatConversation } from './chatApi'
import { chatCopyFor } from './copy'
import { ConversationAvatar, conversationName, isGroup, isMuted } from './chatView'
import { useConversationPreferences } from './useChatActions'
import { GroupChildren } from '@/features/journey/GroupChildren'
import { journeyKeys } from '@/features/journey/api'
import { ChangeTeacherDialog } from '@/features/teachers/ChangeTeacherDialog'
import { O } from '@/features/teachers/opsCopy'
import { useMayChangeTeacher } from '@/features/teachers/hooks'
import { Link } from 'react-router-dom'
import { parentPath } from '@/features/profiles/api'
import { useMayOpenParentProfiles } from '@/features/profiles/hooks'
import { TrialBadge, isTrialGroup } from '@/shared/components/TrialBadge'

/**
 * Contact info / group info: who is in the conversation, and this viewer's
 * own settings for it. Membership changes are staff-only and server-checked;
 * a 1:1 never changes members, so it offers none.
 */
export function ConversationInfo({ c }: { c: ChatConversation }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const mayOpenParents = useMayOpenParentProfiles()
  const prefs = useConversationPreferences()
  const [adding, setAdding] = useState(false)
  const name = conversationName(c, staff?.id, copy)
  const group = isGroup(c)
  const muted = isMuted(c)
  const members = c.members ?? []

  return (
    <div className="cw-info">
      <div className="dp-hero">
        <ConversationAvatar c={c} name={name} size="lg" selfId={staff?.id} />
        <div className="dp-hero__text">
          <span className="dp-hero__name" dir="auto">{name}</span>
          {isTrialGroup(c) && <TrialBadge />}
          <span className="thread-head__sub">
            {copy.kind[c.type] ?? c.type} · {copy.membersCount(members.length)}
          </span>
        </div>
      </div>

      <section className="dp-section">
        <h3 className="dp-section__title">{copy.notifications}</h3>
        <div className="cw-info__actions">
          <label className="cw-switch">
            <input type="checkbox" role="switch" checked={muted} onChange={() => prefs.mute(c.id, !muted)} />
            <Icon name="bellOff" size={16} />
            <span>{copy.mute}</span>
          </label>
          <button type="button" className="btn btn--sm" onClick={() => prefs.pin(c.id, !c.viewerState?.pinned)}>
            <Icon name="pin" size={14} />
            {c.viewerState?.pinned ? copy.unpin : copy.pin}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => prefs.archive(c.id, !c.viewerState?.archived)}>
            <Icon name="archive" size={14} />
            {c.viewerState?.archived ? copy.unarchive : copy.archive}
          </button>
        </div>
      </section>

      {(c.type === 'student_group' || c.type === 'family_group') && <GroupChildren conversationId={c.id} />}
      {(c.type === 'student_group' || c.type === 'family_group') && <GroupSupervisor c={c} name={name} />}
      {(c.type === 'student_group' || c.type === 'family_group') && <GroupTeacher c={c} name={name} />}

      <section className="dp-section">
        <div className="cw-info__members-head">
          <h3 className="dp-section__title">{copy.members}</h3>
          {group && c.familyId && (
            <button type="button" className="btn btn--sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              {copy.addMember}
            </button>
          )}
        </div>
        <ul className="cw-members">
          {members.map((m) => (
            <li key={m.actorId} className="cw-member">
              <Avatar name={m.displayName || '?'} seed={m.actorId} size="sm" src={m.avatarUrl} />
              <span className="cw-member__name" dir="auto">
                {m.actorKind === 'contact' && mayOpenParents ? (
                  // PD-17: a parent opens their Parent Profile -- offered only to the administration.
                  <Link to={parentPath(m.actorId)}>{m.displayName}</Link>
                ) : m.actorId === staff?.id ? (
                  `${m.displayName} (${copy.you})`
                ) : (
                  m.displayName
                )}
              </span>
              <span className={`kind-chip kind-chip--${m.actorKind}`}>{copy.role[m.actorKind] ?? m.actorKind}</span>
            </li>
          ))}
        </ul>
      </section>

      {adding && c.familyId && <AddMemberDialog c={c} familyId={c.familyId} onClose={() => setAdding(false)} />}
    </div>
  )
}

/**
 * PD-24: the group's supervisor, and -- for the super admin and the Operations
 * manager -- a way to hand the group to another one. The same conversation
 * stays, with every member, message and file; the server moves every child of
 * the group and decides who may.
 */
function GroupSupervisor({ c, name }: { c: ChatConversation; name: string }) {
  const otx = useOrgCopy()
  const { staff } = useSession()
  const queryClient = useQueryClient()
  const mayAsk = staff?.role === 'super_admin' || staff?.role === 'manager'
  const structure = useStructure(mayAsk)
  const ops = structure.data?.departments.find((d) => d.kind === 'operations')
  const mayChange = !!ops && (staff?.role === 'super_admin' || ops.manager?.id === staff?.id)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  if (!mayChange || !ops) return null
  const supervisorIds = new Set(ops.members.filter((m) => m.position === 'supervisor').map((m) => m.id))
  const seated = (c.members ?? []).find((m) => m.actorKind === 'staff' && supervisorIds.has(m.actorId))
  const current = seated ? { id: seated.actorId, name: seated.displayName } : null

  return (
    <section className="dp-section">
      <div className="cw-info__members-head">
        <h3 className="dp-section__title">{otx(OrgT.currentSupervisor)}</h3>
        <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
          <Icon name="users" size={14} />
          {otx(OrgT.changeSupervisor)}
        </button>
      </div>
      <p dir="auto">{current?.name ?? '—'}</p>
      {done && <p className="banner banner--info" role="status">{done}</p>}
      {open && (
        <ChangeSupervisorDialog
          name={name}
          current={current}
          submit={(body) => orgApi.transferGroup(c.id, body)}
          onClose={() => setOpen(false)}
          onDone={(result, supervisorName) => {
            setOpen(false)
            setDone(transferNotice(otx, result, supervisorName))
            void queryClient.invalidateQueries({ queryKey: chatKeys.all })
            void queryClient.invalidateQueries({ queryKey: orgKeys.structure })
          }}
        />
      )}
    </section>
  )
}

/**
 * PD-31: change the teacher of the group's children -- every child taught by
 * the outgoing teacher moves together, in one transaction, and the group (its
 * members, messages and files) stays. Offered to the super admin, the Teachers
 * department and Operations; the server decides, within PD-8 scope.
 */
function GroupTeacher({ c, name }: { c: ChatConversation; name: string }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const queryClient = useQueryClient()
  const may = useMayChangeTeacher()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  if (!may) return null
  return (
    <section className="dp-section">
      <div className="cw-info__members-head">
        <h3 className="dp-section__title">{tx(O.teacher)}</h3>
        <button type="button" className="btn btn--sm" onClick={() => { setDone(null); setOpen(true) }}>
          <Icon name="academy" size={14} />
          {tx(O.changeTeacher)}
        </button>
      </div>
      {done && <p className="banner banner--info" role="status">{done}</p>}
      {open && (
        <ChangeTeacherDialog
          target={{ kind: 'group', id: c.id, name }}
          onClose={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false)
            setDone(text)
            void queryClient.invalidateQueries({ queryKey: chatKeys.all })
            void queryClient.invalidateQueries({ queryKey: journeyKeys.learners(c.id) })
          }}
        />
      )}
    </section>
  )
}

/**
 * The people this staff member may put in a group of this family -- the same
 * source the New family group dialog reads (GET /org/group-candidates) -- minus
 * whoever is already in it. Guidance only: POST /:id/members re-checks the
 * person, their family and their role, and records the reason.
 */
function AddMemberDialog({ c, familyId, onClose }: { c: ChatConversation; familyId: string; onClose: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const candidates = useGroupCandidates()

  const people = useMemo(() => {
    const family = candidates.data?.families.find((f) => f.familyId === familyId)
    if (!family) return []
    const present = new Set((c.members ?? []).map((m) => m.actorId))
    const teachers = new Map<string, string>()
    for (const child of family.children) if (child.teacher) teachers.set(child.teacher.id, child.teacher.name)
    return [
      ...family.parents.map((p) => ({ id: p.id, name: p.name, kind: 'contact' as const })),
      ...[...teachers].map(([id, name]) => ({ id, name, kind: 'teacher' as const })),
    ].filter((p) => !present.has(p.id))
  }, [candidates.data, familyId, c.members])

  const add = useMutation({
    mutationFn: (p: { id: string; kind: 'contact' | 'teacher' }) =>
      chatApi.addMember(
        c.id,
        { actorId: p.id, actorKind: p.kind, memberRole: p.kind === 'contact' ? 'parent' : 'teacher' },
        reason.trim(),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(c.id) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      onClose()
    },
  })

  return (
    <Dialog title={copy.addMember} onClose={onClose} footer={<DialogCancelButton onClick={onClose} />}>
      <p className="field__hint">{copy.addMemberHint}</p>
      <div className="field">
        <label className="field__label" htmlFor={reasonId}>{copy.addMemberReason}</label>
        <input id={reasonId} className="input" value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
      </div>
      {add.error !== null && (
        <p className="field__error" role="alert">
          {add.error instanceof ApiError ? add.error.localized(locale) : copy.actionFailed}
        </p>
      )}
      <QueryBoundary
        isLoading={candidates.isLoading}
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
        isEmpty={people.length === 0}
        emptyTitle={copy.addMemberNone}
      >
        <ul className="dc-list">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="dc-person"
                disabled={add.isPending || !reason.trim()}
                onClick={() => add.mutate(p)}
              >
                <span className="cw-member">
                  <Avatar name={p.name} seed={p.id} size="sm" />
                  <span dir="auto" className="dc-person__name">{p.name}</span>
                </span>
                <span className="dc-person__kind">{add.isPending ? copy.adding : copy.role[p.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </Dialog>
  )
}
