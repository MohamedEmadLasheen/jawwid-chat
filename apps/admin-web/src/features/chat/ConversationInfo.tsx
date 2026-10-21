import { useId, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { useGroupCandidates } from '@/features/organization/hooks'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys, type ChatConversation } from './chatApi'
import { chatCopyFor } from './copy'
import { ConversationAvatar, conversationName, isGroup, isMuted } from './chatView'
import { useConversationPreferences } from './useChatActions'
import { GroupChildren } from '@/features/journey/GroupChildren'

/**
 * Contact info / group info: who is in the conversation, and this viewer's
 * own settings for it. Membership changes are staff-only and server-checked;
 * a 1:1 never changes members, so it offers none.
 */
export function ConversationInfo({ c }: { c: ChatConversation }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
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
                {m.actorId === staff?.id ? `${m.displayName} (${copy.you})` : m.displayName}
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
