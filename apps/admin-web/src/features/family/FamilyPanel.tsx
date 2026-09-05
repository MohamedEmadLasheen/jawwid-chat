import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import type { FamilyDetail } from '@/shared/types/domain'

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/**
 * Family 360. Always visible beside the thread so the operator understands the
 * customer without leaving the conversation.
 *
 * Two things it never renders: a phone number (contacts expose name and
 * relationship only), and any attention score or internal rule name.
 */
export function FamilyPanel({ detail }: { detail: FamilyDetail }) {
  const { t, date, dateTime, number } = useI18n()
  const { family, owner, on_duty, contacts, learners, subscription, pinned_notes, recent_cases, open_tasks } = detail

  const renewalDays = daysUntil(subscription?.renewal_due_at ?? null)

  return (
    <aside className="column column--panel" aria-label={family.display_name}>
      <div className="panel">
        <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{family.display_name}</h2>
        <div className="row__meta">
          <Badge tone={family.state === 'at_risk' ? 'danger' : 'neutral'}>{family.state}</Badge>
          {family.tier === 'priority' && <Badge tone="today">{family.tier}</Badge>}
          {family.manual_flag === 'urgent' && <Badge tone="danger">urgent</Badge>}
        </div>
        {family.state_reason && <div className="row__reason">{family.state_reason}</div>}
      </div>

      {/*
        Owner and on-duty are shown as separate lines, always. They are different
        concepts and conflating them is how a coverage reply becomes an
        accidental ownership change in someone's head.
      */}
      <div className="panel">
        <div className="kv">
          <span className="kv__k">{t('family.owner')}</span>
          <span className="kv__v">{owner.name}</span>
        </div>
        <div className="kv">
          <span className="kv__k">{t('family.onDuty')}</span>
          <span className="kv__v">
            {on_duty ? on_duty.name : t('handling.none')}
            {on_duty && on_duty.id !== owner.id && (
              <> <Badge tone="coverage">{t(`handling.${on_duty.mode}` as const)}</Badge></>
            )}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel__title">{t('family.contacts')}</h3>
        {contacts.filter((c) => c.is_active).map((contact) => (
          <div className="kv" key={contact.id}>
            <span className="kv__k">{contact.name}</span>
            <span className="kv__v">
              {contact.relationship}
              {!contact.can_message && <> <Badge>read-only</Badge></>}
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3 className="panel__title">{t('family.learners')}</h3>
        {learners.map((learner) => (
          <div key={learner.id} style={{ marginBlockEnd: 'var(--space-3)' }}>
            <div className="kv">
              <span className="kv__k">{learner.name}</span>
              <span className="kv__v">{learner.level ?? '—'}</span>
            </div>
            {learner.teacher_name && (
              <div className="kv">
                <span className="kv__k">teacher</span>
                <span className="kv__v">{learner.teacher_name}</span>
              </div>
            )}
            {learner.next_class_at && (
              <div className="kv">
                <span className="kv__k">{t('family.nextClass')}</span>
                <span className="kv__v">{dateTime(learner.next_class_at)}</span>
              </div>
            )}
            {learner.last_attended_at && (
              <div className="kv">
                <span className="kv__k">{t('family.lastAttended')}</span>
                <span className="kv__v">{date(learner.last_attended_at)}</span>
              </div>
            )}
            {learner.consecutive_absences > 0 && (
              <div className="row__meta">
                <Badge tone="danger">
                  {t('family.absences', { count: number(learner.consecutive_absences) })}
                </Badge>
              </div>
            )}
          </div>
        ))}
      </div>

      {subscription && (
        <div className="panel">
          <h3 className="panel__title">{t('family.subscription')}</h3>
          <div className="kv"><span className="kv__k">plan</span><span className="kv__v">{subscription.plan}</span></div>
          <div className="kv"><span className="kv__k">status</span><span className="kv__v">{subscription.status}</span></div>
          {subscription.ends_at && (
            <div className="kv"><span className="kv__k">ends</span><span className="kv__v">{date(subscription.ends_at)}</span></div>
          )}
          {subscription.last_payment_status && (
            <div className="kv">
              <span className="kv__k">last payment</span>
              <span className="kv__v">
                {subscription.last_payment_status === 'failed' ? (
                  <Badge tone="danger">{subscription.last_payment_status}</Badge>
                ) : (
                  subscription.last_payment_status
                )}
              </span>
            </div>
          )}
          {renewalDays !== null && renewalDays >= 0 && (
            <div className="row__meta">
              <Badge tone={renewalDays <= 3 ? 'danger' : 'today'}>
                {t('family.renewalIn', { days: number(renewalDays) })}
              </Badge>
            </div>
          )}
        </div>
      )}

      {pinned_notes.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">{t('family.notes')}</h3>
          {pinned_notes.map((note) => (
            <div key={note.id} className="msg__bubble" style={{ marginBlockEnd: 8 }}>
              {note.body}
              <div className="msg__meta">
                <span>{note.author_name}</span>
                <span>{date(note.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {recent_cases.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">{t('family.cases')}</h3>
          {recent_cases.map((item) => (
            <div className="kv" key={item.id}>
              <span className="kv__k">{item.type}</span>
              <span className="kv__v">{t(`case.status.${item.status}` as const)}</span>
            </div>
          ))}
        </div>
      )}

      {open_tasks.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">{t('family.tasks')}</h3>
          {open_tasks.map((task) => (
            <div className="kv" key={task.id}>
              <span className="kv__k">{task.title}</span>
              <span className="kv__v">{task.due_at ? date(task.due_at) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
