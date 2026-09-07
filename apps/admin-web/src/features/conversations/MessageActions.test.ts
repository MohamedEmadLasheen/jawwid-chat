import { describe, expect, it } from 'vitest'
import { capabilitiesFor } from './MessageActions'
import type { Message } from '@/shared/types/conversation'

/**
 * Which actions the console offers on a message.
 *
 * The SERVER remains authoritative — every one of these is decided again by
 * `AuthorizationService` when the request lands. What this file pins is the
 * direction the console errs in: an action offered and then refused reads as a
 * broken console, so anything the server would refuse must not appear.
 *
 * The rules mirror `canEditMessage` and `canDeleteForEveryone` in
 * `apps/api/src/platform/authorization.service.ts`.
 */
const NOW = Date.parse('2026-09-07T12:00:00.000Z')

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversationId: 'c1',
    seq: '1',
    authorKind: 'staff',
    authorId: 'me',
    onBehalfMode: null,
    type: 'text',
    body: 'hello',
    visibility: 'customer',
    moderation: 'published',
    origin: 'user',
    replyToMessageId: null,
    replyPreview: null,
    clientMessageId: null,
    editedAt: null,
    editCount: 0,
    isForwarded: false,
    deletedAt: null,
    deletedForAll: false,
    createdAt: new Date(NOW).toISOString(),
    attachments: [],
    reactions: [],
    receipts: [],
    ...over,
  }
}

const agedBy = (minutes: number) =>
  message({ createdAt: new Date(NOW - minutes * 60_000).toISOString() })

describe('message capabilities', () => {
  it('offers everything on the operator’s own fresh text message', () => {
    const can = capabilitiesFor(message(), 'me', NOW)
    expect(can).toEqual({
      canReact: true,
      canForward: true,
      canEdit: true,
      canDeleteForMe: true,
      canDeleteForEveryone: true,
    })
  })

  it('never offers to edit or withdraw somebody else’s message', () => {
    const can = capabilitiesFor(message({ authorId: 'somebody-else' }), 'me', NOW)
    expect(can.canEdit).toBe(false)
    expect(can.canDeleteForEveryone).toBe(false)
    // But it can still be reacted to, forwarded, and hidden.
    expect(can.canReact).toBe(true)
    expect(can.canForward).toBe(true)
    expect(can.canDeleteForMe).toBe(true)
  })

  it('closes editing after the window, and withdrawal after its longer one', () => {
    expect(capabilitiesFor(agedBy(14), 'me', NOW).canEdit).toBe(true)
    expect(capabilitiesFor(agedBy(16), 'me', NOW).canEdit).toBe(false)

    expect(capabilitiesFor(agedBy(59), 'me', NOW).canDeleteForEveryone).toBe(true)
    expect(capabilitiesFor(agedBy(61), 'me', NOW).canDeleteForEveryone).toBe(false)
  })

  it('never closes "hide for me" — it destroys nothing and is private', () => {
    expect(capabilitiesFor(agedBy(60 * 24 * 400), 'me', NOW).canDeleteForMe).toBe(true)
  })

  it('offers nothing but hiding on a withdrawn message', () => {
    const can = capabilitiesFor(message({ deletedForAll: true }), 'me', NOW)
    expect(can.canReact).toBe(false)
    expect(can.canEdit).toBe(false)
    expect(can.canForward).toBe(false)
    expect(can.canDeleteForEveryone).toBe(false)
    // A tombstone is still a row in this operator's view, and hiding it is
    // what the API allows and what the mobile client offers. Deletion
    // semantics are shared between the clients, not re-decided by each.
    expect(can.canDeleteForMe).toBe(true)
  })

  it('will not forward or edit a message still awaiting approval', () => {
    // It is not visible to the group yet; forwarding it would spread something
    // the group has not been shown, and the API refuses it for that reason.
    const can = capabilitiesFor(message({ moderation: 'pending' }), 'me', NOW)
    expect(can.canForward).toBe(false)
    expect(can.canEdit).toBe(false)
    expect(can.canReact).toBe(false)
  })

  it('will not forward or edit a media message', () => {
    // Attachments are objects in storage with their own scoped URLs: copying
    // the row would point a new audience at an object they were never
    // authorized for, and there is no caption to edit.
    for (const type of ['image', 'voice', 'file'] as const) {
      const can = capabilitiesFor(message({ type }), 'me', NOW)
      expect(can.canForward).toBe(false)
      expect(can.canEdit).toBe(false)
    }
  })

  it('offers nothing on a system message', () => {
    const can = capabilitiesFor(message({ authorKind: 'system', authorId: null }), 'me', NOW)
    expect(can.canReact).toBe(false)
    expect(can.canDeleteForMe).toBe(false)
    expect(can.canEdit).toBe(false)
  })

  it('treats an unknown viewer as somebody else, never as the author', () => {
    // Failing closed: a console that has not resolved who is looking must not
    // offer author-only actions on the strength of a null.
    const can = capabilitiesFor(message({ authorId: null }), null, NOW)
    expect(can.canEdit).toBe(false)
    expect(can.canDeleteForEveryone).toBe(false)
  })
})
