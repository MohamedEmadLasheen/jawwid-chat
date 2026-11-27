import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { isManager, isOperator, isSuperAdmin } from '@/core/permissions/capabilities'
import { Dialog } from '@/shared/components/Dialog'
import { Menu, type MenuItem } from '@/shared/components/Menu'
import { Splitter, useResizableWidth } from '@/shared/components/Splitter'
import { ErrorState, LoadingState } from '@/shared/components/States'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { chatApi, chatKeys } from './chatApi'
import { chatCopyFor } from './copy'
import { useChatRealtime } from './useChatRealtime'
import { ConversationList } from './ConversationList'
import { ChatThread } from './ChatThread'
import { ConversationInfo } from './ConversationInfo'
import { ThreadStart } from './ThreadStart'
import { useWorkspaceKeys } from './useWorkspaceKeys'
import { NewFamilyGroupDialog } from './NewFamilyGroupDialog'
import { NewDirectChatDialog } from './NewDirectChatDialog'
import { StarredDialog } from './StarredDialog'
import { JoinGroupDialog } from './SeatParts'
import { Icon } from '@/shared/components/Icon'
import { isGroup } from './chatView'
import { CoverActions } from '@/features/organization/CoverBanner'
import { HandOverDialog } from '@/features/organization/HandOverDialog'
import { T as OrgT, useCopy as useOrgCopy } from '@/features/organization/copy'
import { useMyCover } from '@/features/organization/hooks'
import './chat.css'

export { conversationName } from './chatView'

const LIST_WIDTH_KEY = 'jawwid.chat.listWidth'
const INFO_KEY = 'jawwid.chat.infoPanel'

/** The context panel is open until someone closes it; the choice is remembered. */
function readInfoPref(): boolean {
  try {
    return localStorage.getItem(INFO_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * The admin's chat workspace: the same conversations, through the same API, as
 * the parent and teacher apps. What appears in the list is exactly what the
 * server will let this admin open (staff scope); nothing here filters or widens
 * it. Three panes -- list, thread, and the context panel (the family, then the
 * conversation's own details), which is a drawer below 1100px; below 768px one
 * pane shows at a time. J / K / Enter / Escape work the list from the keyboard.
 */
export function ChatPage() {
  const { locale, date } = useI18n()
  const copy = chatCopyFor(locale)
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId: string }>()
  // ?m=<messageId>: open the chat at that message (a search hit or a star).
  const [params, setParams] = useSearchParams()
  const focusMessageId = params.get('m')
  const openAt = (id: string, messageId: string) =>
    navigate(`/chat/${encodeURIComponent(id)}?m=${encodeURIComponent(messageId)}`)
  const { state } = useRealtime()
  const { staff } = useSession()
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [creatingDirect, setCreatingDirect] = useState(false)
  const [showingStarred, setShowingStarred] = useState(false)
  const [joiningGroup, setJoiningGroup] = useState(false)
  // PD-33, as MyCoverBanner (features/organization) has it: who covers and until
  // when stay banners over the list; "I'm away" itself is a quiet action in the
  // list's header rather than a bar of its own. Supervisors and backups only;
  // the server says who may hand over.
  const otx = useOrgCopy()
  const mayCover = !!staff && (staff.role === 'admin' || staff.role === 'coverage')
  const myCover = useMyCover(mayCover)
  const cover = mayCover ? myCover.data : undefined
  const canGoAway = !!cover && !cover.away && cover.canHandOver
  const [handingOver, setHandingOver] = useState(false)
  const wide = useMediaQuery('(min-width: 1100px)')
  const resizable = useMediaQuery('(min-width: 1024px)')
  const listWidth = useResizableWidth(LIST_WIDTH_KEY, 360, 280, 520)
  const [infoPref, setInfoPref] = useState(readInfoPref)
  const [sheetOpen, setSheetOpen] = useState(false)

  const list = useQuery({
    queryKey: chatKeys.list,
    queryFn: chatApi.list,
    // A covering admin who is not a member receives no membership event for a
    // brand-new conversation of a family they cover; a slow poll is the
    // fallback for that one case. Everything else arrives by realtime.
    refetchInterval: 60_000,
  })
  const conversations = useMemo(() => list.data ?? [], [list.data])
  useChatRealtime(useMemo(() => conversations.map((c) => c.id), [conversations]))

  const details = useQuery({
    queryKey: chatKeys.conversation(conversationId ?? ''),
    queryFn: () => chatApi.get(conversationId!),
    enabled: !!conversationId,
  })
  const open = details.data ?? null

  const toggleInfo = () => {
    if (!wide) {
      setSheetOpen((v) => !v)
      return
    }
    setInfoPref((v) => {
      try {
        localStorage.setItem(INFO_KEY, v ? '0' : '1')
      } catch {
        /* a remembered panel is a convenience only */
      }
      return !v
    })
  }
  const infoShown = wide ? infoPref : sheetOpen
  const infoTitle = open && isGroup(open) ? copy.groupInfo : copy.contactInfo

  // PD-8: supervisors (and the super admin, who reaches every family) create
  // family groups; only the super admin opens a 1:1 with anyone. The server
  // decides each request.
  const canCreateGroup = !!staff && (isOperator(staff.role) || isSuperAdmin(staff.role))
  const canOpenDirect = !!staff && isSuperAdmin(staff.role)
  const canJoinGroup = !!staff && (isOperator(staff.role) || isManager(staff.role))

  const newItems: MenuItem[] = [
    ...(canOpenDirect ? [{ key: 'direct', label: copy.newDirect, icon: 'conversations' as const, onSelect: () => setCreatingDirect(true) }] : []),
    ...(canCreateGroup ? [{ key: 'group', label: copy.newGroup, icon: 'users' as const, onSelect: () => setCreatingGroup(true) }] : []),
    // PD-35: a teacher supervisor joins their teachers' students' groups; the
    // server lists only those, so for anyone else the list is simply empty.
    ...(canJoinGroup ? [{ key: 'join', label: copy.joinGroup, icon: 'users' as const, onSelect: () => setJoiningGroup(true) }] : []),
  ]

  const style = resizable ? ({ '--list-w': `${listWidth.width}px` } as CSSProperties) : undefined
  useWorkspaceKeys({ listId: 'chat-list', onBack: conversationId ? () => navigate('/chat') : null })

  return (
    <div className="workspace cw" data-view={conversationId ? 'thread' : 'list'} style={style}>
      <section className="workspace__list" id="chat-list" aria-label={copy.title}>
        {state !== 'connected' && (
          <div className="banner banner--warn" role="status">
            {copy.offline}
          </div>
        )}
        {/* PD-33: who covers until when ("I'm away" is in the list's header). */}
        {cover?.away && (
          <div className="banner banner--info cover-banner" role="status">
            <span dir="auto">
              {cover.away.status === 'scheduled'
                ? otx(OrgT.scheduled, { backup: cover.away.backup.name, date: date(cover.away.startsAt) })
                : otx(OrgT.awayBanner, { backup: cover.away.backup.name, date: date(cover.away.endsAt) })}
            </span>
            <CoverActions cover={cover.away} />
          </div>
        )}
        {(cover?.covering ?? [])
          .filter((x) => x.status === 'active')
          .map((x) => (
            <div key={x.id} className="banner banner--info cover-banner" role="status">
              <span dir="auto">{otx(OrgT.coveringBanner, { name: x.supervisor.name, date: date(x.endsAt) })}</span>
              <CoverActions cover={x} />
            </div>
          ))}
        {list.isLoading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={conversationId ?? null}
            onSelect={(id) => navigate(`/chat/${encodeURIComponent(id)}`)}
            onOpenMessage={openAt}
            // PD-44: the Dashboard's waiting tile lands here as /chat?view=waiting.
            initialView={params.get('view') === 'waiting' ? 'waiting' : undefined}
            actions={
              <>
                {canGoAway && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    onClick={() => setHandingOver(true)}
                    aria-label={otx(OrgT.imAway)}
                    title={otx(OrgT.imAway)}
                  >
                    <Icon name="calendarPlus" size={18} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  onClick={() => setShowingStarred(true)}
                  aria-label={copy.starredTitle}
                  title={copy.starredTitle}
                >
                  <Icon name="star" size={18} />
                </button>
                {newItems.length > 0 && <Menu label={copy.newMenu} icon="plus" items={newItems} className="cw-list__new" />}
              </>
            }
          />
        )}
      </section>

      {resizable && <Splitter {...listWidth} label={copy.title} controls="chat-list" />}

      <section className="workspace__thread" aria-label={copy.title}>
        {conversationId ? (
          <ChatThread
            key={conversationId}
            conversationId={conversationId}
            backTo="/chat"
            infoShown={infoShown}
            onToggleInfo={toggleInfo}
            focusMessageId={focusMessageId}
            onFocused={() => setParams({}, { replace: true })}
          />
        ) : list.data === undefined ? null : (
          <ThreadStart conversations={conversations} onOpen={(id) => navigate(`/chat/${encodeURIComponent(id)}`)} />
        )}
      </section>

      {open && wide && infoPref && (
        <aside className="workspace__panel" aria-labelledby="chat-info-title">
          <h2 className="workspace__panel-title" id="chat-info-title">
            {infoTitle}
          </h2>
          <ConversationInfo c={open} />
        </aside>
      )}
      {open && !wide && sheetOpen && (
        <Dialog variant="sheet" title={infoTitle} onClose={() => setSheetOpen(false)}>
          <ConversationInfo c={open} />
        </Dialog>
      )}

      {handingOver && staff && <HandOverDialog supervisor={{ id: staff.id, name: staff.name }} onClose={() => setHandingOver(false)} />}
      {showingStarred && (
        <StarredDialog
          onClose={() => setShowingStarred(false)}
          onOpen={(id, messageId) => {
            setShowingStarred(false)
            openAt(id, messageId)
          }}
        />
      )}
      {creatingDirect && (
        <NewDirectChatDialog
          onClose={() => setCreatingDirect(false)}
          onOpened={(id) => {
            setCreatingDirect(false)
            navigate(`/chat/${encodeURIComponent(id)}`)
          }}
        />
      )}
      {joiningGroup && (
        <JoinGroupDialog
          onClose={() => setJoiningGroup(false)}
          onJoined={(id) => {
            setJoiningGroup(false)
            navigate(`/chat/${encodeURIComponent(id)}`)
          }}
        />
      )}
      {creatingGroup && (
        <NewFamilyGroupDialog
          onClose={() => setCreatingGroup(false)}
          onCreated={(id) => {
            setCreatingGroup(false)
            navigate(`/chat/${encodeURIComponent(id)}`)
          }}
        />
      )}
    </div>
  )
}
