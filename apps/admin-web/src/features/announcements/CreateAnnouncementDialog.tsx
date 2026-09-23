import { useState } from 'react'
import { Dialog } from '@/shared/components/Dialog'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isManager } from '@/core/permissions/capabilities'
import { useCreateAnnouncement } from './hooks'
import type { CreateAnnouncementInput } from '@/core/api/endpoints'

type Priority = CreateAnnouncementInput['priority']
type Audience = CreateAnnouncementInput['targetType']

/**
 * Compose an announcement.
 *
 * It creates a DRAFT. Publishing is a second, separate act on the list, because
 * an announcement to every parent in the academy should not be sendable by
 * mistyping a form — and a draft that can be re-read before it goes is the
 * cheapest safeguard this product has.
 *
 * URGENT IS RATIONED IN THE UI AS WELL AS THE SERVER. It bypasses quiet hours
 * and category mutes, so only admin and manager may choose it; a coverage lead
 * sees it disabled with the reason rather than discovering a 403 after typing.
 * The server refuses it regardless, and so does a trigger on chat.announcement —
 * this is an affordance, never the control.
 */
export function CreateAnnouncementDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { staff } = useSession()
  const create = useCreateAnnouncement()

  const [titleAr, setTitleAr] = useState('')
  const [bodyAr, setBodyAr] = useState('')
  const [titleEn, setTitleEn] = useState('')
  const [bodyEn, setBodyEn] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [audience, setAudience] = useState<Audience>('all_parents')
  const [expiresAt, setExpiresAt] = useState('')

  // admin and manager only, mirroring AnnouncementService.requirePublisher and
  // chat.guard_announcement_authority.
  const mayDeclareUrgent =
    staff != null && (isManager(staff.role) || staff.role === 'admin')

  // Arabic is required; English is optional and falls back to Arabic, matching
  // how chat.notification_template renders for a parent whose locale has none.
  const canSubmit = titleAr.trim().length > 0 && bodyAr.trim().length > 0

  const submit = async () => {
    if (!canSubmit) return
    await create.mutateAsync({
      titleAr: titleAr.trim(),
      bodyAr: bodyAr.trim(),
      titleEn: titleEn.trim() || null,
      bodyEn: bodyEn.trim() || null,
      priority,
      targetType: audience,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    })
    onClose()
  }

  return (
    <Dialog
      title={t('announcements.create')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!canSubmit || create.isPending}
            onClick={() => void submit()}
          >
            {t('announcements.saveDraft')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="ann-title-ar">{t('announcements.titleAr')}</label>
        <input
          id="ann-title-ar"
          value={titleAr}
          onChange={(event) => setTitleAr(event.target.value)}
          dir="rtl"
        />
      </div>

      <div className="field">
        <label htmlFor="ann-body-ar">{t('announcements.bodyAr')}</label>
        <textarea
          id="ann-body-ar"
          rows={4}
          value={bodyAr}
          onChange={(event) => setBodyAr(event.target.value)}
          dir="rtl"
        />
      </div>

      <div className="field">
        <label htmlFor="ann-title-en">{t('announcements.titleEn')}</label>
        <input
          id="ann-title-en"
          value={titleEn}
          onChange={(event) => setTitleEn(event.target.value)}
        />
        <p className="field__hint">{t('announcements.englishOptional')}</p>
      </div>

      <div className="field">
        <label htmlFor="ann-body-en">{t('announcements.bodyEn')}</label>
        <textarea
          id="ann-body-en"
          rows={4}
          value={bodyEn}
          onChange={(event) => setBodyEn(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="ann-audience">{t('announcements.audience')}</label>
        <select
          id="ann-audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value as Audience)}
        >
          <option value="all_parents">{t('announcements.audience.allParents')}</option>
          <option value="all_teachers">{t('announcements.audience.allTeachers')}</option>
          <option value="all_staff">{t('announcements.audience.allStaff')}</option>
        </select>
        {/*
          Named audiences only. The API also supports specific families, contacts
          and learners, but choosing those needs a picker fed by a family search
          endpoint this admin app does not have — and offering an id field
          instead would be exactly the technical interface an operator should
          never be handed.
        */}
      </div>

      <div className="field">
        <label htmlFor="ann-priority">{t('announcements.priority')}</label>
        <select
          id="ann-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
        >
          <option value="normal">{t('announcements.priority.normal')}</option>
          <option value="important">{t('announcements.priority.important')}</option>
          <option value="urgent" disabled={!mayDeclareUrgent}>
            {t('announcements.priority.urgent')}
          </option>
        </select>
        <p className="field__hint">
          {mayDeclareUrgent
            ? t('announcements.urgentMeaning')
            : t('announcements.urgentForbidden')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="ann-expires">{t('announcements.expires')}</label>
        <input
          id="ann-expires"
          type="date"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
        <p className="field__hint">{t('announcements.expiresMeaning')}</p>
      </div>

      {create.isError && (
        <p className="field__error" role="alert">
          {t('common.retry')}
        </p>
      )}
    </Dialog>
  )
}
