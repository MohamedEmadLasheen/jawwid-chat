import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ChatComposer } from './ChatComposer'
import { MESSAGE_MAX_CHARACTERS, messageLength, messageTooLong } from './messageLength'

/**
 * PARENT-003: a message is at most 4000 characters, counted as the server and
 * the mobile composer count them (what a person sees). The composer shows a
 * counter near the limit; past it, Send waits and says why -- nothing is sent
 * for the server to refuse.
 */
describe('PARENT-003: the message length limit', () => {
  it('is 4000 characters, an emoji or a vowelled letter counting once', () => {
    expect(MESSAGE_MAX_CHARACTERS).toBe(4000)
    const heart = '❤️'
    expect(messageLength(heart.repeat(4001))).toBe(4001)
    expect(messageTooLong(heart.repeat(4000))).toBe(false)
    expect(messageTooLong('بَ'.repeat(4001))).toBe(true)
  })
})

describe('PARENT-003: the composer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ quickReplies: [], candidates: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })
  afterEach(() => vi.unstubAllGlobals())

  function open() {
    const onSend = vi.fn()
    renderWithProviders(<ChatComposer onSend={onSend} reply={null} onCancelReply={() => undefined} conversationId="c-1" />, {
      staff: makeStaff({ id: 's-1', role: 'admin' }),
    })
    const box = screen.getByRole('combobox', { name: 'Message' })
    const send = screen.getByRole('button', { name: 'Send' })
    return { onSend, box, send }
  }

  it('says nothing about length far from the limit', () => {
    const { box } = open()
    fireEvent.change(box, { target: { value: 'hello' } })
    expect(screen.queryByText(/\/ 4000/)).toBeNull()
  })

  it('counts near the limit, and sends exactly 4000 characters', () => {
    const { onSend, box, send } = open()
    fireEvent.change(box, { target: { value: 'a'.repeat(4000) } })
    expect(screen.getByText('4000 / 4000')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: 'a'.repeat(4000) }))
  })

  it('past 4000: Send waits, Enter sends nothing, and it says why', () => {
    const { onSend, box, send } = open()
    fireEvent.change(box, { target: { value: 'a'.repeat(4001) } })
    expect(screen.getByText('4001 / 4000')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('A message can be at most 4000 characters. Shorten it or split it in two.')
    expect(send).toBeDisabled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })
})
