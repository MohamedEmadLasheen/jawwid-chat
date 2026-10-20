import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { PhotoError, prepareWallpaper } from '@/features/profile/photo'
import { CHAT_THEMES, chatApi, chatKeys, type ChatConversation, type ChatTheme } from './chatApi'
import { chatCopyFor } from './copy'

/**
 * The viewer's OWN look for one chat (owner decisions 2026-10-20): a preset
 * background and, optionally, a photo. Private -- nobody else's view changes --
 * and stored on the server, so it follows the account. Each choice applies at
 * once; the chat behind the dialog shows it.
 */
export function ThemeDialog({ conversation, onClose }: { conversation: ChatConversation; onClose: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const state = conversation.viewerState
  const current = state?.theme ?? null
  const wallpaper = state?.wallpaperUrl ?? null

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversation.id) })
    void queryClient.invalidateQueries({ queryKey: chatKeys.list })
  }
  // Optimistic: the swatch and the chat behind it change on the click.
  const patch = (next: Partial<NonNullable<ChatConversation['viewerState']>>) =>
    queryClient.setQueryData<ChatConversation>(chatKeys.conversation(conversation.id), (old) =>
      old ? { ...old, viewerState: { pinned: false, archived: false, mutedUntil: null, ...old.viewerState, ...next } } : old,
    )

  // One message for the LATEST action only: each new action clears the last
  // one's error, so an old failure never sits under a later success.
  const [failure, setFailure] = useState<string | null>(null)
  const describe = (e: unknown): string =>
    e instanceof PhotoError
      ? copy.wallpaperProblem[e.problem] ?? copy.actionFailed
      : e instanceof ApiError
        ? copy.wallpaperRefused[e.code] ?? e.localized(locale)
        : copy.actionFailed

  const theme = useMutation({
    mutationFn: (next: ChatTheme | null) => chatApi.setTheme(conversation.id, next),
    onMutate: (next) => {
      setFailure(null)
      patch({ theme: next })
    },
    onError: (e) => setFailure(describe(e)),
    onSettled: refresh,
  })
  const upload = useMutation({
    mutationFn: async (picked: File) => {
      const prepared = await prepareWallpaper(picked)
      try {
        return await chatApi.uploadWallpaper(conversation.id, prepared.blob)
      } finally {
        URL.revokeObjectURL?.(prepared.previewUrl)
      }
    },
    onMutate: () => setFailure(null),
    onSuccess: ({ wallpaperUrl }) => patch({ wallpaperUrl }),
    // A photo the browser could not prepare, or a server refusal, in the
    // viewer's language; anything else (a failed PUT) generically.
    onError: (e) => setFailure(describe(e)),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: () => chatApi.removeWallpaper(conversation.id),
    onMutate: () => {
      setFailure(null)
      patch({ wallpaperUrl: null })
    },
    onError: (e) => setFailure(describe(e)),
    onSettled: refresh,
  })

  return (
    <Dialog
      title={copy.themeTitle}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <p className="field__hint">{copy.themeHint}</p>
      <div className="cw-themes" role="radiogroup" aria-label={copy.themeTitle}>
        {[null, ...CHAT_THEMES].map((key) => (
          <button
            key={key ?? 'default'}
            type="button"
            role="radio"
            aria-checked={current === key}
            className={key ? `cw-theme cw-bg--${key}` : 'cw-theme'}
            onClick={() => theme.mutate(key)}
          >
            <span className="cw-theme__swatch" aria-hidden="true" />
            {key ? copy.themeNames[key] : copy.themeDefault}
          </button>
        ))}
      </div>

      <div className="cw-wall">
        <span
          className="cw-wall__preview"
          aria-hidden="true"
          style={wallpaper ? { backgroundImage: `url("${wallpaper}")` } : undefined}
        />
        <div>
          <div className="field__label">{copy.wallpaper}</div>
          <p className="field__hint">{copy.wallpaperHint}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--sm" disabled={upload.isPending} onClick={() => file.current?.click()}>
              <Icon name="image" size={14} />
              {upload.isPending ? copy.wallpaperUploading : wallpaper ? copy.wallpaperReplace : copy.wallpaperChoose}
            </button>
            {wallpaper && (
              <button type="button" className="btn btn--sm btn--ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
                <Icon name="trash" size={14} />
                {copy.wallpaperRemove}
              </button>
            )}
          </div>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          data-testid="wallpaper-file"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            e.target.value = ''
            if (picked) upload.mutate(picked)
          }}
        />
      </div>
      {failure && (
        <p className="field__error" role="alert">
          {failure}
        </p>
      )}
    </Dialog>
  )
}
