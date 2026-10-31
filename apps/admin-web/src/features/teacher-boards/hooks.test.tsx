// PD-39 PR-4 (review of #336): the board's images in the staff viewer. Under
// StrictMode an effect runs, is cleaned up and runs again; the images must
// still arrive. Only the images on the page on view are loaded, each at most
// the page's width, and an image that fails or is not among the board's
// signed ones shows as unavailable.
import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardImages, MAX_IMAGE_EDGE } from './hooks'
import type { BoardAssetJson } from './api'

/** An <img> that "loads" its URL: `bad` fails, `big` is 8000 x 2000, anything else 40 x 30. */
class FakeImage {
  static requested: string[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  decoding = ''
  naturalWidth = 0
  naturalHeight = 0
  private url = ''
  get src() {
    return this.url
  }
  set src(url: string) {
    this.url = url
    if (!url) return
    FakeImage.requested.push(url)
    setTimeout(() => {
      if (url.includes('bad')) return this.onerror?.()
      ;[this.naturalWidth, this.naturalHeight] = url.includes('big') ? [8000, 2000] : [40, 30]
      this.onload?.()
    }, 5)
  }
}

const asset = (id: string, url: string): BoardAssetJson => ({ id, url, width: 40, height: 30, expiresAt: '2099-01-01T00:00:00Z' })

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>

describe('useBoardImages', () => {
  const bitmaps: Array<{ resizeWidth?: number; resizeHeight?: number }> = []
  beforeEach(() => {
    FakeImage.requested = []
    bitmaps.length = 0
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('createImageBitmap', async (_img: unknown, opts: { resizeWidth?: number; resizeHeight?: number }) => {
      bitmaps.push(opts)
      return { width: opts.resizeWidth, height: opts.resizeHeight, close: () => {} }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('under StrictMode the images still arrive (the effect runs twice)', async () => {
    const assets = [asset('a1', 'https://s.test/a1'), asset('a2', 'https://s.test/a2')]
    const { result } = renderHook(() => useBoardImages(assets, ['a1', 'a2']), { wrapper: strict })
    expect(result.current('a1').status).toBe('loading')
    await waitFor(() => expect(result.current('a1').status).toBe('ready'))
    await waitFor(() => expect(result.current('a2').status).toBe('ready'))
    // Each is fetched once, however often the effect ran.
    expect(FakeImage.requested.sort()).toEqual(['https://s.test/a1', 'https://s.test/a2'])
  })

  it('a new assets list mid-load (a re-render) does not strand an image on "loading"', async () => {
    const { result, rerender } = renderHook(({ list }) => useBoardImages(list, ['a1']), {
      wrapper: strict,
      initialProps: { list: [asset('a1', 'https://s.test/a1')] },
    })
    rerender({ list: [asset('a1', 'https://s.test/a1')] })
    await waitFor(() => expect(result.current('a1').status).toBe('ready'))
  })

  it('one that fails to load, or is not among the board\'s images, shows as unavailable', async () => {
    const { result } = renderHook(() => useBoardImages([asset('a1', 'https://s.test/bad')], ['a1', 'gone']), { wrapper: strict })
    await waitFor(() => expect(result.current('a1').status).toBe('unavailable'))
    expect(result.current('gone').status).toBe('unavailable')
  })

  it('only the images on the page on view are loaded; the next page\'s when it is shown', async () => {
    const assets = [asset('a1', 'https://s.test/a1'), asset('a2', 'https://s.test/a2')]
    const { result, rerender } = renderHook(({ wanted }) => useBoardImages(assets, wanted), {
      wrapper: strict,
      initialProps: { wanted: ['a1'] },
    })
    await waitFor(() => expect(result.current('a1').status).toBe('ready'))
    expect(FakeImage.requested).toEqual(['https://s.test/a1'])
    rerender({ wanted: ['a2'] })
    await waitFor(() => expect(result.current('a2').status).toBe('ready'))
    expect(FakeImage.requested).toEqual(['https://s.test/a1', 'https://s.test/a2'])
    // Already loaded: kept, not fetched again.
    rerender({ wanted: ['a1'] })
    expect(result.current('a1').status).toBe('ready')
    expect(FakeImage.requested).toHaveLength(2)
  })

  it('an image larger than the page is kept no larger than the page\'s width', async () => {
    const { result } = renderHook(() => useBoardImages([asset('a1', 'https://s.test/big')], ['a1']), { wrapper: strict })
    await waitFor(() => expect(result.current('a1').status).toBe('ready'))
    expect(bitmaps).toEqual([expect.objectContaining({ resizeWidth: MAX_IMAGE_EDGE, resizeHeight: 480 })])
    const found = result.current('a1')
    expect(found.status === 'ready' && (found.source as { width: number }).width).toBe(MAX_IMAGE_EDGE)
  })

  it('nothing is set after the viewer closes', async () => {
    const { unmount } = renderHook(() => useBoardImages([asset('a1', 'https://s.test/a1')], ['a1']), { wrapper: strict })
    const errors = vi.spyOn(console, 'error')
    unmount()
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
