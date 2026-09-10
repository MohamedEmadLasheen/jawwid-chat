import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Thread } from './Thread'
import { VoiceMessage, clock, isVoiceAttachment } from './VoiceMessage'
import { makeMessage, renderWithProviders } from '@/test/utils'
import type { Attachment } from '@/shared/types/domain'

const voiceAttachment: Attachment = {
  id: 'att_voice',
  name: 'voice.ogg',
  content_type: 'audio/ogg',
  size_bytes: 20480,
  url: 'https://storage.invalid/signed/voice',
}

const pdfAttachment: Attachment = {
  id: 'att_pdf',
  name: 'invoice.pdf',
  content_type: 'application/pdf',
  size_bytes: 4096,
  url: 'https://storage.invalid/signed/invoice',
}

/**
 * jsdom implements no media pipeline: `play()` and `pause()` are not defined and
 * `duration` is read-only NaN. These stubs stand in for the engine so the
 * component's own behaviour can be exercised.
 */
function stubMediaEngine({ duration = 18 }: { duration?: number } = {}) {
  const play = vi.fn(function (this: HTMLAudioElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  const pause = vi.fn(function (this: HTMLAudioElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true })
    this.dispatchEvent(new Event('pause'))
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: play, configurable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { value: pause, configurable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    get: () => duration,
    configurable: true,
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { value: true, configurable: true })

  let currentTime = 0
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value
    },
    configurable: true,
  })

  return { play, pause }
}

function audioElement(): HTMLAudioElement {
  const audio = document.querySelector('audio')
  if (!audio) throw new Error('no audio element rendered')
  return audio
}

describe('VoiceMessage', () => {
  beforeEach(() => {
    stubMediaEngine()
  })

  describe('what it renders before anything is played', () => {
    it('streams rather than downloading the whole note up front', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)

      const audio = audioElement()
      // A thread of fifty voice notes must fetch fifty short headers, not fifty
      // files.
      expect(audio.getAttribute('preload')).toBe('metadata')
      expect(audio.getAttribute('src')).toBe(voiceAttachment.url)
    })

    it('shows the duration once the browser reports it', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)

      fireEvent(audioElement(), new Event('loadedmetadata'))

      expect(screen.getByText('0:18')).toBeInTheDocument()
    })

    it('says it is a voice message in words, not by icon alone', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)
      expect(screen.getByText('Voice message')).toBeInTheDocument()
    })
  })

  describe('playback', () => {
    it('plays and pauses from the same control', async () => {
      const { play, pause } = stubMediaEngine()
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)

      await userEvent.click(screen.getByRole('button', { name: 'Play voice message' }))
      expect(play).toHaveBeenCalledTimes(1)

      await userEvent.click(screen.getByRole('button', { name: 'Pause voice message' }))
      expect(pause).toHaveBeenCalledTimes(1)
      // Back to a play affordance, named in words rather than by glyph.
      expect(screen.getByRole('button', { name: 'Play voice message' })).toBeInTheDocument()
    })

    it('resuming continues from the current position', async () => {
      const { play } = stubMediaEngine()
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)

      await userEvent.click(screen.getByRole('button', { name: 'Play voice message' }))
      const audio = audioElement()
      fireEvent(audio, new Event('loadedmetadata'))
      audio.currentTime = 7
      fireEvent(audio, new Event('timeupdate'))

      expect(screen.getByText('0:07 / 0:18')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Pause voice message' }))
      await userEvent.click(screen.getByRole('button', { name: 'Play voice message' }))

      // Pause never reset the clock, so play resumed rather than restarting.
      expect(audio.currentTime).toBe(7)
      expect(play).toHaveBeenCalledTimes(2)
    })

    it('shows playback progress on a seekable track', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)
      const audio = audioElement()
      fireEvent(audio, new Event('loadedmetadata'))

      const track = screen.getByRole('slider', { name: 'Playback position' })
      fireEvent.change(track, { target: { value: '9' } })

      expect(audio.currentTime).toBe(9)
    })

    it('starting one note stops another already playing', async () => {
      const { pause } = stubMediaEngine()
      renderWithProviders(
        <>
          <VoiceMessage attachment={voiceAttachment} />
          <VoiceMessage attachment={{ ...voiceAttachment, id: 'att_voice_2' }} />
        </>,
      )

      const [, second] = screen.getAllByRole('button', { name: 'Play voice message' })
      expect(second).toBeDefined()
      await userEvent.click(second as HTMLElement)

      // Two voice notes talking over each other is never what the listener asked
      // for.
      expect(pause).toHaveBeenCalled()
    })
  })

  describe('failure', () => {
    it('an expired or unplayable URL is reported rather than looking idle', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)

      fireEvent(audioElement(), new Event('error'))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This voice message could not be played.',
      )
    })

    it('an unknown duration is not rendered as Infinity', () => {
      stubMediaEngine({ duration: Number.POSITIVE_INFINITY })
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />)

      fireEvent(audioElement(), new Event('loadedmetadata'))

      expect(screen.getByText('0:00')).toBeInTheDocument()
      expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument()
    })
  })

  describe('inside the thread', () => {
    it('renders a player instead of a paperclip count', () => {
      renderWithProviders(
        <Thread
          messages={[makeMessage({ body: '', attachments: [voiceAttachment] })]}
          isLoading={false}
          hasMore={false}
          onLoadMore={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Play voice message' })).toBeInTheDocument()
      expect(screen.queryByText('📎 1')).not.toBeInTheDocument()
    })

    it('still counts ordinary files as attachments', () => {
      renderWithProviders(
        <Thread
          messages={[makeMessage({ body: 'Invoice attached', attachments: [pdfAttachment] })]}
          isLoading={false}
          hasMore={false}
          onLoadMore={vi.fn()}
        />,
      )

      expect(screen.getByText('📎 1')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Play voice message' })).not.toBeInTheDocument()
    })

    it('a voice note keeps the thread bubble, author and time', () => {
      renderWithProviders(
        <Thread
          messages={[
            makeMessage({
              body: '',
              author_type: 'contact',
              author_name: 'Umm Yusuf',
              attachments: [voiceAttachment],
            }),
          ]}
          isLoading={false}
          hasMore={false}
          onLoadMore={vi.fn()}
        />,
      )

      expect(screen.getByText('Umm Yusuf')).toBeInTheDocument()
      const bubble = document.querySelector('.voice')?.closest('.msg__bubble')
      expect(bubble).not.toBeNull()
    })
  })

  describe('Arabic', () => {
    it('is fully localised', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />, { locale: 'ar' })

      expect(screen.getByText('رسالة صوتية')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'تشغيل الرسالة الصوتية' })).toBeInTheDocument()
    })

    it('the seek track does not mirror, because it is a timeline of sound', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />, { locale: 'ar' })

      // The page is RTL; the track is not. Mirroring it would make the recording
      // appear to run backwards.
      expect(document.documentElement.dir).toBe('rtl')
      expect(screen.getByRole('slider', { name: 'موضع التشغيل' })).toHaveAttribute('dir', 'ltr')
    })

    it('the duration stays an LTR run', () => {
      renderWithProviders(<VoiceMessage attachment={voiceAttachment} />, { locale: 'ar' })
      fireEvent(audioElement(), new Event('loadedmetadata'))

      expect(screen.getByText('0:18')).toHaveAttribute('dir', 'ltr')
    })
  })

  describe('helpers', () => {
    it('recognises audio attachments and nothing else', () => {
      expect(isVoiceAttachment(voiceAttachment)).toBe(true)
      expect(isVoiceAttachment({ ...voiceAttachment, content_type: 'audio/mpeg' })).toBe(true)
      expect(isVoiceAttachment(pdfAttachment)).toBe(false)
      expect(isVoiceAttachment({ ...voiceAttachment, content_type: 'image/png' })).toBe(false)
    })

    it('formats a duration as m:ss, adding hours only when there are any', () => {
      expect(clock(8)).toBe('0:08')
      expect(clock(78)).toBe('1:18')
      expect(clock(3660)).toBe('1:01:00')
    })

    it('never renders a negative or non-finite duration', () => {
      expect(clock(-5)).toBe('0:00')
      expect(clock(Number.NaN)).toBe('0:00')
      expect(clock(Number.POSITIVE_INFINITY)).toBe('0:00')
    })
  })
})
