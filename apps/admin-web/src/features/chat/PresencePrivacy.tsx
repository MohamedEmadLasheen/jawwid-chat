import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { chatApi, chatKeys } from './chatApi'
import { liveCopyFor } from './liveCopy'

/**
 * PD-37: "Hide my last seen" (staff only; the server refuses anyone else).
 * WhatsApp's switch, both ways: on, nobody sees this person's last seen and
 * they see nobody's. Online stays visible either way.
 */
export function PresencePrivacy() {
  const { locale } = useI18n()
  const copy = liveCopyFor(locale)
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: chatKeys.presenceSettings, queryFn: chatApi.presenceSettings })
  const save = useMutation({
    mutationFn: (hide: boolean) => chatApi.setHideLastSeen(hide),
    onSuccess: (r) => {
      queryClient.setQueryData(chatKeys.presenceSettings, r)
      // What this viewer sees of others changes too (reciprocity).
      void queryClient.invalidateQueries({ queryKey: ['chat', 'presence'] })
    },
  })
  if (!settings.data) return null
  const hidden = save.isPending ? !!save.variables : settings.data.hideLastSeen
  return (
    <section className="sp-card" aria-labelledby="sp-presence">
      <h2 id="sp-presence" className="sp-card__title">
        {copy.presenceTitle}
      </h2>
      <label className="cw-switch">
        <input
          type="checkbox"
          role="switch"
          checked={hidden}
          disabled={save.isPending}
          onChange={() => save.mutate(!hidden)}
        />
        <span>{copy.hideLastSeen}</span>
      </label>
      <p className="field__hint">{copy.hideLastSeenHint}</p>
    </section>
  )
}
