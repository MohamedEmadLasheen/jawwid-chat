// CHATSCHED-013: what the staff call screen reads from the server about a
// dropped call, and the words it says for it -- in both languages.
import { describe, expect, it } from 'vitest'
import { toServerEvent } from './CallProvider'
import { endedText } from './CallOverlay'
import { IDLE_CALL, type CallState } from './callController'
import { callCopyFor } from './copy'

const CALL_COPY_EN = callCopyFor('en')
const CALL_COPY_AR = callCopyFor('ar')

describe('the server events of a dropped call', () => {
  it('call.ended carries its reason; an older payload without one still ends the call', () => {
    expect(toServerEvent('call.ended', { callId: 'c1', outcome: 'answered', durationSeconds: 70, reason: 'connection_lost' })).toEqual({
      event: 'call.ended',
      payload: { callId: 'c1', outcome: 'answered', durationSeconds: 70, reason: 'connection_lost' },
    })
    expect(toServerEvent('call.ended', { callId: 'c1', outcome: 'answered', durationSeconds: 70 })).toMatchObject({
      payload: { outcome: 'answered', reason: null },
    })
  })

  it('call.interrupted carries the moment the server ends it; a malformed one is dropped', () => {
    expect(toServerEvent('call.interrupted', { callId: 'c1', until: '2026-10-31T12:01:00.000Z' })).toEqual({
      event: 'call.interrupted',
      payload: { callId: 'c1', until: Date.parse('2026-10-31T12:01:00.000Z') },
    })
    expect(toServerEvent('call.interrupted', { callId: 'c1', until: 'soon' })).toBeNull()
    expect(toServerEvent('call.resumed', { callId: 'c1' })).toEqual({ event: 'call.resumed', payload: { callId: 'c1' } })
  })
})

describe('the words', () => {
  const ended = (over: Partial<CallState>): CallState => ({ ...IDLE_CALL, phase: 'ended', ...over })

  it('a connection lost says so, whatever the outcome; a hang-up is unchanged', () => {
    expect(endedText(ended({ outcome: 'answered', endReason: 'connection_lost' }), CALL_COPY_EN)).toBe('Call ended: the connection was lost')
    expect(endedText(ended({ outcome: 'answered', endReason: 'connection_lost' }), CALL_COPY_AR)).toBe('انتهت المكالمة: انقطع الاتصال')
    expect(endedText(ended({ outcome: 'answered', endReason: 'hung_up' }), CALL_COPY_EN)).toBe('Call ended')
  })
})
