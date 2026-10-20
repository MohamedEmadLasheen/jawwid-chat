/**
 * Preparing a profile photo in the browser before upload.
 *
 * The chosen file is decoded and re-drawn onto a 512x512 canvas (centre crop),
 * then exported as WebP (JPEG where the browser cannot encode WebP). That makes
 * every upload small and square, and -- because a canvas carries pixels only --
 * drops EXIF metadata such as a phone's GPS position.
 *
 * This is a CONVENIENCE, not the control. The server reads the stored bytes
 * back and refuses anything that is not a real JPEG/PNG/WebP of acceptable
 * size and dimensions, whatever this function did or did not do.
 */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024
export const MIN_DIMENSION = 64
export const OUTPUT_SIZE = 512

export type PhotoProblem = 'type' | 'too_big' | 'too_small' | 'unreadable'

export class PhotoError extends Error {
  constructor(readonly problem: PhotoProblem) {
    super(problem)
    this.name = 'PhotoError'
  }
}

export interface PreparedPhoto {
  blob: Blob
  previewUrl: string
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) throw new PhotoError('type')
  if (file.size > MAX_SOURCE_BYTES) throw new PhotoError('too_big')

  const image = await decode(file)
  const { naturalWidth: w, naturalHeight: h } = image
  if (w < MIN_DIMENSION || h < MIN_DIMENSION) throw new PhotoError('too_small')

  const side = Math.min(w, h)
  const out = Math.min(OUTPUT_SIZE, side)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoError('unreadable')
  ctx.drawImage(image, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out)

  const blob = (await toBlob(canvas, 'image/webp', 0.9)) ?? (await toBlob(canvas, 'image/jpeg', 0.9))
  if (!blob || !(ACCEPTED_TYPES as readonly string[]).includes(blob.type)) throw new PhotoError('unreadable')
  return { blob, previewUrl: URL.createObjectURL(blob) }
}

/** A chat wallpaper keeps its whole picture; the long side is cut down to this. */
export const WALLPAPER_MAX_SIDE = 2048
export const WALLPAPER_MIN_SIDE = 200

/**
 * A chat wallpaper: the whole picture (no crop), scaled so its long side is at
 * most WALLPAPER_MAX_SIDE, re-encoded through a canvas (pixels only, so no
 * location or camera metadata leaves the device), WebP or JPEG.
 */
export async function prepareWallpaper(file: File): Promise<PreparedPhoto> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) throw new PhotoError('type')
  if (file.size > MAX_SOURCE_BYTES) throw new PhotoError('too_big')
  const image = await decode(file)
  const { naturalWidth: w, naturalHeight: h } = image
  if (w < WALLPAPER_MIN_SIDE || h < WALLPAPER_MIN_SIDE) throw new PhotoError('too_small')
  const scale = Math.min(1, WALLPAPER_MAX_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoError('unreadable')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = (await toBlob(canvas, 'image/webp', 0.85)) ?? (await toBlob(canvas, 'image/jpeg', 0.85))
  if (!blob || !(ACCEPTED_TYPES as readonly string[]).includes(blob.type)) throw new PhotoError('unreadable')
  return { blob, previewUrl: URL.createObjectURL(blob) }
}

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL?.(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL?.(url)
      reject(new PhotoError('unreadable'))
    }
    img.src = url
  })
}

/** Some browsers silently fall back to PNG for an unsupported type; a PNG is still acceptable. */
function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.type === type ? b : b?.type === 'image/png' ? b : null), type, quality))
}
