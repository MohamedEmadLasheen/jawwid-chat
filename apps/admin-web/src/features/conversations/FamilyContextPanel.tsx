import { useI18n } from '@/core/i18n/I18nProvider'
import { useFamily, useFamilyLabels, useFamilyLearners } from '@/features/directory/hooks'
import { Avatar } from '@/shared/components/Avatar'
import { Icon } from '@/shared/components/Icon'
import { ErrorState } from '@/shared/components/States'
import type { Conversation } from '@/shared/types/conversation'
import type { Learner } from '@/shared/types/directory'
import { titleOf } from './conversationDisplay'

/**
 * ZONE 3 — WHO THIS FAMILY IS.
 *
 * `family-360.md` asks one question: *"who is this family, and what is true
 * about them right now?"*, answered without leaving the conversation. This is
 * the honest subset of that panel — the part the API can actually answer.
 *
 * ## Seven blocks of real data, four reserved
 *
 * Everything rendered here comes from an endpoint the API serves today:
 * `GET /families/:id`, `GET /families/:id/learners`, `GET /families/:id/labels`,
 * and the conversation's own membership list. That is the family's **status**,
 * **tier**, **language**, **Primary Owner**, its **labels**, its **students**
 * (with each student's level and current teacher) and the conversation's
 * **participants**.
 *
 * Payment status, subscription and renewal, the course and next class, and
 * open tasks are **Jawwid Core's**, and Core is out of launch scope. They are
 * not omitted and they are not faked: their place is kept, and the panel says
 * plainly where they will come from. The alternative — a dash, a zero, or a
 * plausible-looking value — is worse than an absence, because an operator can
 * act on a number and cannot act on a blank. Nothing here calls a Core
 * endpoint, and nothing here holds a placeholder value.
 *
 * ## It reads; it does not act
 *
 * The primary action on this screen is always the reply in the middle zone.
 * Ownership transfer, lifecycle changes and teacher assignment all exist in
 * the directory, where they carry their audit reasons; duplicating them here
 * would be a second, thinner path to an audited act.
 */
export function FamilyContextPanel({
  conversation,
  drawerOpen,
  onClose,
}: {
  conversation: Conversation
  /**
   * Whether the DRAWER is open, below the three-pane breakpoint.
   *
   * Above 1280 the panel is permanent and this is ignored — that decision
   * belongs to the stylesheet's media query, not to React, so there is one
   * breakpoint in the codebase rather than two that can drift apart. The
   * closed panel stays mounted so its queries survive a toggle.
   */
  drawerOpen: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const familyId = conversation.familyId

  const family = useFamily(familyId)
  const learners = useFamilyLearners(familyId)
  const labels = useFamilyLabels(familyId)

  const members = conversation.members ?? []
  const isGroup =
    conversation.type === 'student_group' || conversation.type === 'class_group'

  return (
    <aside
      className={drawerOpen ? 'context' : 'context context--drawer-closed'}
      aria-label={t('context.title')}
    >
      <div className="context__scroll">
        <header className="context__hero">
          <Avatar
            name={family.data?.displayName ?? titleOf(conversation)}
            kind={isGroup ? 'group' : 'person'}
            size="lg"
          />
          <div style={{ minInlineSize: 0, flex: 1 }}>
            <div className="context__hero-name">
              {family.data?.displayName ?? titleOf(conversation)}
            </div>
            <div className="context__hero-sub">
              {t('conversation.members', { count: String(members.length) })}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn context__close"
            aria-label={t('console.contextClose')}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        {/*
          A class group belongs to the academy rather than to one family, so
          there is no family record to read. Saying that outright is the point:
          an empty panel would read as a failure to load.
        */}
        {!familyId && (
          <section className="context__section">
            <p className="context__empty">{t('context.noFamily')}</p>
            <p className="context__empty">{t('context.noFamilyHint')}</p>
          </section>
        )}

        {familyId && family.isPending && <ContextSkeleton />}

        {familyId && family.error && (
          <section className="context__section">
            <ErrorState error={family.error} onRetry={() => void family.refetch()} />
          </section>
        )}

        {familyId && family.data && (
          <>
            <section className="context__section">
              <h3 className="context__section-title">
                <Icon name="families" size={14} />
                {t('context.family')}
              </h3>

              <div className="context__row">
                <span className="context__key">{t('context.state')}</span>
                <span className="context__value">
                  <StateChip state={family.data.state} />
                </span>
              </div>

              <div className="context__row">
                <span className="context__key">{t('context.tier')}</span>
                <span className="context__value">
                  {family.data.tier === 'priority' ? (
                    <span className="chip chip--brand">{t('family.tier.priority')}</span>
                  ) : (
                    <span className="chip">{t('family.tier.standard')}</span>
                  )}
                </span>
              </div>

              {/*
                THE PRIMARY OWNER IS A PERMANENT ROW (DD-02, `terminology.md`
                §1). It is present for every family in every state, and it is
                never replaced by whoever happens to be handling the
                conversation right now — that distinction is the one mechanism
                that stops coverage reading as a transfer of ownership.
              */}
              <div className="context__row">
                <span className="context__key">{t('responsibility.primaryOwner')}</span>
                <span className="context__value">
                  {family.data.supervisorName ?? t('responsibility.unassigned')}
                </span>
              </div>

              <div className="context__row">
                <span className="context__key">{t('context.language')}</span>
                <span className="context__value">
                  {/* The family's language, named in the OPERATOR's language.
                      Printing «العربية» inside an English console is a data
                      value leaking into the interface. */}
                  {family.data.language === 'ar' ? t('language.ar') : t('language.en')}
                </span>
              </div>
            </section>

            <section className="context__section">
              <h3 className="context__section-title">
                <Icon name="labels" size={14} />
                {t('context.labels')}
              </h3>
              {(labels.data?.labels ?? []).length === 0 ? (
                <p className="context__empty">{t('context.noLabels')}</p>
              ) : (
                <div className="context__chips">
                  {(labels.data?.labels ?? []).map((label) => (
                    <span key={label.id} className="chip">
                      {label.name}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="context__section">
              <h3 className="context__section-title">
                <Icon name="student" size={14} />
                {t('context.students')}
              </h3>
              {(learners.data?.learners ?? []).length === 0 ? (
                <p className="context__empty">{t('context.noStudents')}</p>
              ) : (
                <ul className="context__list">
                  {(learners.data?.learners ?? []).map((learner) => (
                    <LearnerCard key={learner.id} learner={learner} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <section className="context__section">
          <h3 className="context__section-title">
            <Icon name="groups" size={14} />
            {t('context.participants')}
          </h3>
          <ul className="context__list">
            {members.map((member) => (
              <li key={member.actorId} className="context__card">
                <Avatar name={member.displayName ?? '؟'} size="sm" tone="muted" />
                <div style={{ minInlineSize: 0, flex: 1 }}>
                  <div className="context__card-title">{member.displayName ?? '—'}</div>
                  <div className="context__card-sub">
                    {t(`member.${member.memberRole}` as 'member.parent')}
                    {member.isSilent ? ` · ${t('member.silent')}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <CoreReservedSection />
      </div>
    </aside>
  )
}

/**
 * The family's lifecycle state, as a labelled chip.
 *
 * Never colour alone: `at_risk` is a red chip **that says "at risk"**, and it
 * still says it in greyscale. The states are the six the API stores; a state
 * this console has not been taught is rendered verbatim rather than being
 * swallowed, because an unknown state is information too.
 */
function StateChip({ state }: { state: string }) {
  const { t } = useI18n()
  const known = [
    'onboarding',
    'active',
    'at_risk',
    'renewal_due',
    'paused',
    'churned',
  ].includes(state)

  const tone =
    state === 'at_risk' ? 'chip--danger'
    : state === 'renewal_due' ? 'chip--warning'
    : state === 'active' ? 'chip--brand'
    : ''

  return (
    <span className={`chip ${tone}`}>
      {known ? t(`family.state.${state}` as 'family.state.active') : state}
    </span>
  )
}

function LearnerCard({ learner }: { learner: Learner }) {
  const { t } = useI18n()
  return (
    <li className={learner.isActive ? 'context__card' : 'context__card context__card--inactive'}>
      <Avatar name={learner.name} size="sm" tone="muted" />
      <div style={{ minInlineSize: 0, flex: 1 }}>
        <div className="context__card-title">
          {learner.name}
          {!learner.isActive && (
            <span className="chip" style={{ marginInlineStart: 'var(--space-2)' }}>
              {t('learner.inactive')}
            </span>
          )}
        </div>
        <div className="context__card-sub">{learner.level ?? t('learner.noLevel')}</div>
        <div className="context__card-sub">
          {t('learner.teacher')} ·{' '}
          {learner.currentTeacherName ?? t('learner.noTeacher')}
        </div>
      </div>
    </li>
  )
}

/**
 * The reserved block.
 *
 * Four capabilities the operations team will want, all of them Jawwid Core's
 * to answer, and Core is out of launch scope. This states that once, above the
 * four, rather than four times — and it renders as hatched, non-interactive
 * space so that it reads as *reserved* rather than as *failed to load*.
 *
 * There is no query behind this component, no placeholder value inside it, and
 * no control that pretends to fetch one.
 */
function CoreReservedSection() {
  const { t } = useI18n()
  const reserved = [
    'context.unavailable.payment',
    'context.unavailable.subscription',
    'context.unavailable.nextClass',
    'context.unavailable.tasks',
  ] as const

  return (
    <section className="context__section" aria-label={t('context.unavailableTitle')}>
      <h3 className="context__section-title">
        <Icon name="info" size={14} />
        {t('context.unavailableTitle')}
      </h3>
      <div className="context__list">
        {reserved.map((key) => (
          <div className="context__pending" key={key}>
            <div className="context__pending-title">{t(key)}</div>
          </div>
        ))}
      </div>
      <p className="context__pending-note">{t('context.unavailableNote')}</p>
    </section>
  )
}

/** Skeletons matching each section's shape, resolved as one panel (§7). */
function ContextSkeleton() {
  return (
    <div className="context__section" aria-hidden="true">
      <div className="skeleton skeleton-line" style={{ inlineSize: '40%' }} />
      <div style={{ display: 'grid', gap: 'var(--space-4)', marginBlockStart: 'var(--space-4)' }}>
        {['70%', '55%', '80%', '45%'].map((width, index) => (
          <div className="skeleton skeleton-line" key={index} style={{ inlineSize: width }} />
        ))}
      </div>
    </div>
  )
}
