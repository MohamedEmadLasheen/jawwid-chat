import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VoiceRecorder, VoiceNotePlayer, type RecordingDevice } from './VoiceRecorder'
import { baseMime, pickRecordingType } from './voiceNote'
import { chatCopy } from './copy'

const copy = chatCopy.en

/** A scripted microphone + MediaRecorder: what the browser would do, minus devices. */
function fakeDevice(opts: { deny?: boolean; supported?: string[] } = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const recorders: Array<{ mimeType: string; state: string }> = []
  const device: RecordingDevice = {
    getUserMedia: vi.fn(async () => {
      if (opts.deny) throw new DOMException('denied', 'NotAllowedError')
      return stream
    }),
    isTypeSupported: (t) => (opts.supported ?? ['audio/webm;codecs=opus', 'audio/webm']).includes(t),
    createRecorder: (_s, mimeType) => {
      const r = {
        mimeType,
        state: 'inactive',
        ondataavailable: null as null | ((e: { data: Blob }) => void),
        onstop: null as null | (() => void),
        start() {
          r.state = 'recording'
        },
        stop() {
          r.state = 'inactive'
          r.ondataavailable?.({ data: new Blob(['voice-bytes'], { type: mimeType }) })
          r.onstop?.()
        },
      }
      recorders.push(r)
      return r as unknown as MediaRecorder
    },
  }
  return { device, track, recorders }
}

let requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }>
function stubNetwork(opts: { sendStatus?: number } = {}) {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}))
      const body = init?.body instanceof Blob ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ url, method, headers, body })
      const json = (d: unknown, status = 200) =>
        new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/messages/attachments/authorize')) {
        return json({
          objectKey: 'attachments/obj-1',
          uploadUrl: 'http://storage.test/put/attachments%2Fobj-1?expires=1&size=11&sig=s',
          method: 'PUT',
          headers: { 'content-type': 'audio/webm' },
        })
      }
      if (url.startsWith('http://storage.test/')) return new Response(null, { status: 200 })
      if (url.endsWith('/conversations/conv-1/messages') && method === 'POST') {
        if (opts.sendStatus && opts.sendStatus !== 200) {
          return json({ error: { code: 'COMM.NOT_CONVERSATION_MEMBER', message: 'Not a member' } }, opts.sendStatus)
        }
        return json({ id: 'm-1', attachments: [] })
      }
      return json({}, 404)
    }),
  )
}

let clock = 0
beforeEach(() => {
  clock = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:draft'), revokeObjectURL: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())

function renderRecorder(device: RecordingDevice | null, extra: Partial<Parameters<typeof VoiceRecorder>[0]> = {}) {
  return render(
    <VoiceRecorder conversationId="conv-1" visibility="customer" copy={copy} locale="en" device={device} now={() => clock} {...extra} />,
  )
}

async function recordFor(ms: number) {
  fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
  await screen.findByRole('status')
  clock += ms
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  await screen.findByRole('button', { name: 'Send voice message' })
}

describe('recording and sending a voice message', () => {
  it('authorizes, uploads to the signed URL WITHOUT a bearer, then sends a voice message', async () => {
    stubNetwork()
    const { device, track } = fakeDevice()
    const onSent = vi.fn()
    renderRecorder(device, { onSent })
    await recordFor(4200)
    expect(track.stop).toHaveBeenCalled() // the microphone is released as soon as recording stops
    expect(requests).toHaveLength(0) // nothing leaves the browser until Send

    fireEvent.click(screen.getByRole('button', { name: 'Send voice message' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))

    const [authorize, put, send] = requests
    expect(authorize!.url).toMatch(/\/conversations\/conv-1\/messages\/attachments\/authorize$/)
    expect(authorize!.body).toEqual({ kind: 'voice', mimeType: 'audio/webm', byteSize: 11, visibility: 'customer' })

    expect(put!.method).toBe('PUT')
    expect(put!.url).toBe('http://storage.test/put/attachments%2Fobj-1?expires=1&size=11&sig=s')
    expect(put!.headers).toEqual({ 'content-type': 'audio/webm' })
    expect(Object.keys(put!.headers).map((h) => h.toLowerCase())).not.toContain('authorization')

    expect(send!.method).toBe('POST')
    expect(send!.headers['Idempotency-Key']).toBeTruthy()
    expect(send!.body).toMatchObject({
      type: 'voice',
      visibility: 'customer',
      attachments: [{ kind: 'voice', objectKey: 'attachments/obj-1', mimeType: 'audio/webm', byteSize: 11, durationMs: 4200 }],
    })
    expect((send!.body as { clientMessageId: string }).clientMessageId).toBe(send!.headers['Idempotency-Key'])
    expect(screen.getByRole('button', { name: 'Record voice message' })).toBeTruthy()
  })

  it('a refused send keeps the recording, shows the server\'s reason, and a retry reuses the same message id', async () => {
    stubNetwork({ sendStatus: 403 })
    const { device } = fakeDevice()
    renderRecorder(device)
    await recordFor(1000)
    fireEvent.click(screen.getByRole('button', { name: 'Send voice message' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Not a member')
    const firstId = (requests.at(-1)!.body as { clientMessageId: string }).clientMessageId

    fireEvent.click(screen.getByRole('button', { name: 'Send voice message' }))
    await waitFor(() => expect(requests.filter((r) => r.method === 'POST' && r.url.endsWith('/messages'))).toHaveLength(2))
    expect((requests.at(-1)!.body as { clientMessageId: string }).clientMessageId).toBe(firstId)
  })

  it('a denied microphone says so and sends nothing', async () => {
    stubNetwork()
    renderRecorder(fakeDevice({ deny: true }).device)
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', copy.voiceMicDenied)
    expect(requests).toHaveLength(0)
  })

  it('a browser that cannot record a type the server accepts says so', async () => {
    stubNetwork()
    renderRecorder(fakeDevice({ supported: ['audio/x-unknown'] }).device)
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', copy.voiceUnsupported)
  })

  it('cancel discards the recording, frees the microphone, sends nothing', async () => {
    stubNetwork()
    const { device, track } = fakeDevice()
    renderRecorder(device)
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }))
    expect(await screen.findByRole('button', { name: 'Record voice message' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send voice message' })).toBeNull()
    expect(track.stop).toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })

  it('leaving the conversation mid-recording frees the microphone', async () => {
    stubNetwork()
    const { device, track } = fakeDevice()
    const { unmount } = renderRecorder(device)
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await screen.findByRole('status')
    unmount()
    expect(track.stop).toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })

  it('autoStart (from the call window) starts recording once, without a click', async () => {
    stubNetwork()
    const { device } = fakeDevice()
    const onAutoStarted = vi.fn()
    renderRecorder(device, { autoStart: true, onAutoStarted })
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(device.getUserMedia).toHaveBeenCalledTimes(1)
    expect(onAutoStarted).toHaveBeenCalledTimes(1)
  })

  it('stops by itself at the server\'s 10-minute ceiling and keeps what was said', async () => {
    vi.useFakeTimers()
    try {
      stubNetwork()
      const { device } = fakeDevice()
      renderRecorder(device)
      fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
      await act(async () => {
        await Promise.resolve()
      })
      clock = 10 * 60 * 1000
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.getByRole('button', { name: 'Send voice message' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('voice notes in the thread', () => {
  it('plays a signed URL; an unsigned one is reported, not broken', () => {
    const { rerender, container } = render(<VoiceNotePlayer url="https://media.test/a" durationMs={65000} copy={copy} />)
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('https://media.test/a')
    expect(screen.getByText('1:05')).toBeTruthy()
    rerender(<VoiceNotePlayer url={null} copy={copy} />)
    expect(screen.getByText(copy.voiceUnavailable)).toBeTruthy()
  })
})

describe('voice note types', () => {
  it('sends the bare type the server matches', () => {
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(baseMime('Audio/MP4')).toBe('audio/mp4')
  })
  it('prefers what the server accepts and the browser records', () => {
    expect(pickRecordingType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecordingType(() => false)).toBeNull()
  })
})
