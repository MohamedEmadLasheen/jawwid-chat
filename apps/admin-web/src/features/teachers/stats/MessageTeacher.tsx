import { useNavigate } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isSuperAdmin } from '@/core/permissions/capabilities'
import { useI18n } from '@/core/i18n/I18nProvider'
import { describeError } from '@/features/supervision/copy'
import { adminSectionPath } from '@/features/admin/sections'
import { useOpenSupervision } from '@/features/supervision/hooks'
import { Icon } from '@/shared/components/Icon'
import { TS } from '../copy'
import { useCopy } from './format'

/**
 * "Message teacher": the teacher's supervision conversation, the department's
 * one chat with a teacher (PD-11/PD-12). The same endpoint and destinations
 * as the Teacher file's "Supervision chat" button: the server finds the
 * conversation, or opens it the first time, and refuses anyone outside the
 * Teachers department. The refusal is shown as it is.
 */
export function MessageTeacher({
  teacherId,
  teacherName,
  className = 'btn btn--sm',
  withIcon = false,
}: {
  teacherId: string
  teacherName: string
  className?: string
  withIcon?: boolean
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const navigate = useNavigate()
  const open = useOpenSupervision()
  if (!staff) return null
  const go = (conversationId: string) =>
    navigate(
      isSuperAdmin(staff.role)
        ? `${adminSectionPath('conversations')}?c=${encodeURIComponent(conversationId)}`
        : canOpenArea(staff.role, 'chat')
          ? `/chat/${encodeURIComponent(conversationId)}`
          : '/',
    )
  return (
    <span className="tsx-message">
      <button
        type="button"
        className={className}
        aria-busy={open.isPending || undefined}
        disabled={open.isPending}
        aria-label={`${tx(TS.messageTeacher)}: ${teacherName}`}
        onClick={(e) => {
          e.stopPropagation()
          open.mutate(teacherId, { onSuccess: (r) => go(r.conversationId) })
        }}
      >
        {withIcon && <Icon name="conversations" size={18} />}
        {open.isPending ? tx(TS.opening) : tx(TS.messageTeacher)}
      </button>
      {open.error ? (
        <span className="field__error tsx-message__error" role="alert">
          {describeError(open.error, locale)}
        </span>
      ) : null}
    </span>
  )
}
