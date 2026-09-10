import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { presentSystemMessage } from './systemMessage'
import { messages } from '@/core/i18n/messages'
import { ConversationView } from './ConversationView'
import { renderWithProviders, makeStaff } from '@/test/utils'
import type { Conversation, Message } from '@/shared/types/conversation'

/**
 * THE RULE UNDER TEST: a system event's raw payload never reaches a pixel.
 *
 * A real group conversation on the verification stack rendered
 * `{"kind":"group.created","learner":"learner_smoke"}` to an operator. These
 * tests pin both halves of the fix — the mapping, and the fact that the thread
 * goes through it.
 */
describe('system event presentation', () => {
  it('names the student when a group is created', () => {
    expect(
      presentSystemMessage(JSON.stringify({ kind: 'group.created', learner: 'سلمى' })),
    ).toEqual({
      kind: 'localized',
      key: 'system.groupCreated',
      params: { learner: 'سلمى' },
    })
  })

  it('falls back to the unnamed sentence when the payload has no student', () => {
    expect(presentSystemMessage(JSON.stringify({ kind: 'group.created' }))).toEqual({
      kind: 'localized',
      key: 'system.groupCreatedUnnamed',
    })
  })

  it('picks the membership sentence that matches what actually changed', () => {
    const of = (added: number, removed: number) =>
      presentSystemMessage(
        JSON.stringify({ kind: 'group.membership_changed', added, removed }),
      )

    expect(of(2, 1)).toEqual({
      kind: 'localized',
      key: 'system.membersChangedBoth',
      params: { added: '2', removed: '1' },
    })
    expect(of(3, 0)).toEqual({
      kind: 'localized',
      key: 'system.membersChangedAdded',
      params: { added: '3' },
    })
    expect(of(0, 4)).toEqual({
      kind: 'localized',
      key: 'system.membersChangedRemoved',
      params: { removed: '4' },
    })
    // Zero is "nothing to say", not a number worth rendering.
    expect(of(0, 0)).toEqual({ kind: 'localized', key: 'system.membersChanged' })
  })

  it('carries the archive reason when the server recorded one', () => {
    expect(
      presentSystemMessage(JSON.stringify({ kind: 'group.archived', reason: 'انتهى الفصل' })),
    ).toEqual({
      kind: 'localized',
      key: 'system.groupArchivedReason',
      params: { reason: 'انتهى الفصل' },
    })
    expect(presentSystemMessage(JSON.stringify({ kind: 'group.archived' }))).toEqual({
      kind: 'localized',
      key: 'system.groupArchived',
    })
  })

  it('names the teacher and the group for a class call', () => {
    expect(
      presentSystemMessage(
        JSON.stringify({
          kind: 'class_call_started',
          callId: 'c1',
          teacherName: 'الأستاذ سامي',
          groupName: 'حلقة التجويد',
        }),
      ),
    ).toEqual({
      kind: 'localized',
      key: 'system.classCallStarted',
      params: { teacher: 'الأستاذ سامي', group: 'حلقة التجويد' },
    })
  })

  it('renders a plain-text body as itself — it was never a payload', () => {
    expect(presentSystemMessage('تم تحويل المسؤولية.')).toEqual({
      kind: 'literal',
      text: 'تم تحويل المسؤولية.',
    })
  })

  /**
   * The important one. A server deployed ahead of this client must not be able
   * to leak an envelope into a family's history.
   */
  it('never returns the payload for an event it has not been taught', () => {
    for (const body of [
      JSON.stringify({ kind: 'something.new', secret: 'value' }),
      JSON.stringify({ noKind: true }),
      JSON.stringify([1, 2, 3]),
      JSON.stringify(42),
      '',
      null,
    ]) {
      const result = presentSystemMessage(body)
      expect(result).toEqual({ kind: 'localized', key: 'system.unknown' })
    }
  })

  it('has no mapping that can produce a brace or a quote in either locale', () => {
    // Every system sentence is prose. A stray `{"` in one would mean a payload
    // had been pasted into the strings file.
    for (const locale of ['en', 'ar'] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (!key.startsWith('system.')) continue
        expect(value, `${locale}.${key}`).not.toMatch(/[{}]"/)
        expect(value, `${locale}.${key}`).not.toContain('kind')
      }
    }
  })
})

describe('the thread renders system events, not payloads', () => {
  const conversation: Conversation = {
    id: 'conv_1',
    type: 'student_group',
    familyId: null,
    learnerId: 'lrn_1',
    title: 'مجموعة الطالب سلمى',
    state: 'open',
    needsReply: false,
    lastSeq: '2',
    lastActivityAt: new Date().toISOString(),
    archivedAt: null,
    teacherRequiresApproval: false,
    parentRequiresApproval: false,
    members: [],
  }

  const systemMessage: Message = {
    id: 'msg_sys',
    conversationId: 'conv_1',
    seq: '1',
    authorKind: 'system',
    authorId: null,
    onBehalfMode: null,
    type: 'system',
    body: JSON.stringify({ kind: 'group.created', learner: 'سلمى' }),
    visibility: 'customer',
    moderation: 'published',
    origin: 'automation',
    replyToMessageId: null,
    replyPreview: null,
    clientMessageId: null,
    editedAt: null,
    editCount: 0,
    isForwarded: false,
    deletedAt: null,
    deletedForAll: false,
    createdAt: new Date().toISOString(),
    attachments: [],
    reactions: [],
    receipts: [],
  }

  it('shows the Arabic sentence and none of the JSON', async () => {
    const { queryClient } = renderWithProviders(
      <ConversationView conversation={conversation} onReplyTo={() => {}} />,
      { locale: 'ar', staff: makeStaff() },
    )
    // Seed the message page directly: this asserts RENDERING, and going
    // through the network would be asserting the fetch layer instead.
    queryClient.setQueryData(['conversations', 'conv_1', 'messages'], {
      pages: [{ messages: [systemMessage], nextBefore: null }],
      pageParams: [undefined],
    })

    expect(await screen.findByText('تم إنشاء مجموعة الطالب سلمى.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('group.created')
    expect(document.body.textContent).not.toContain('{')
  })
})
