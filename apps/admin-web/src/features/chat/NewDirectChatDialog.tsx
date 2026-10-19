import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { adminApi, type AdminUser } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { SearchField } from '@/shared/components/SearchField'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys } from './chatApi'
import { chatCopyFor } from './copy'
import './family-group.css'

/**
 * PD-8: the super admin opens a 1:1 with any teacher or parent of its
 * organization.
 *
 * The people come from GET /admin/users (super_admin only). Staff are not
 * offered: staff-to-staff direct messaging is refused server-side
 * (COMM.STAFF_STAFF_DISABLED). The list is guidance, not the control --
 * POST /conversations/direct re-checks the pair, and an existing channel is
 * returned rather than duplicated.
 */
export function NewDirectChatDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const users = useQuery({ queryKey: qk.adminUsers, queryFn: adminApi.users })
  const open = useMutation({
    mutationFn: (actorId: string) => chatApi.openDirect(actorId),
    onSuccess: (conv) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      onOpened(conv.id)
    },
  })

  const people = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return (users.data?.users ?? [])
      .filter((u): u is AdminUser & { principalKind: 'teacher' | 'contact' } =>
        (u.principalKind === 'teacher' || u.principalKind === 'contact') && u.isActive,
      )
      .filter((u) => !needle || u.displayName.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, locale))
  }, [users.data, search, locale])

  const error = open.error instanceof ApiError ? open.error.localized(locale) : open.error ? copy.directFailed : null

  return (
    <Dialog title={copy.newDirect} onClose={onClose} footer={<DialogCancelButton onClick={onClose} />}>
      <p className="field__hint">{copy.newDirectHint}</p>
      <SearchField value={search} onChange={setSearch} label={copy.directSearch} clearLabel={copy.directClear} />
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <QueryBoundary
        isLoading={users.isLoading}
        error={users.error}
        onRetry={() => void users.refetch()}
        isEmpty={people.length === 0}
        emptyTitle={copy.directNone}
      >
        <ul className="dc-list">
          {people.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="dc-person"
                disabled={open.isPending}
                onClick={() => open.mutate(u.id)}
              >
                <span dir="auto" className="dc-person__name">{u.displayName}</span>
                <span className="dc-person__kind">{copy.role[u.principalKind]}</span>
              </button>
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </Dialog>
  )
}
