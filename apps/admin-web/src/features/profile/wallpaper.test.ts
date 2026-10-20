import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotoError, prepareWallpaper } from './photo'

/**
 * prepareWallpaper's size rule (review fix, PR #72): judged on the SCALED
 * picture, because a wide panorama shrinks below the minimum on its short side
 * and the server would refuse it only after a wasted upload.
 *
 * jsdom decodes no images and draws on no canvas, so a stand-in Image reports
 * the size; a picture that passes the size rule then fails at the canvas
 * ('unreadable'), which is how the two outcomes are told apart.
 */
function imageOfSize(width: number, height: number) {
  class FakeImage {
    naturalWidth = width
    naturalHeight = height
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
}

const problemOf = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (e) {
    return e instanceof PhotoError ? e.problem : 'other'
  }
}
const file = () => new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' })

describe('prepareWallpaper', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses a panorama that would be too thin once scaled, before any upload', async () => {
    imageOfSize(6000, 300) // scaled to 2048 x 102
    expect(await problemOf(prepareWallpaper(file()))).toBe('too_small')
  })

  it('lets a large photo through the size rule (it is scaled, not refused)', async () => {
    imageOfSize(4000, 3000) // scaled to 2048 x 1536
    expect(await problemOf(prepareWallpaper(file()))).toBe('unreadable') // jsdom has no canvas
  })

  it('still refuses a picture that is simply too small', async () => {
    imageOfSize(150, 150)
    expect(await problemOf(prepareWallpaper(file()))).toBe('too_small')
  })
})
