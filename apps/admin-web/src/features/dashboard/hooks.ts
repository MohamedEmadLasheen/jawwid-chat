import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dashboardApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'

/**
 * Manager one-click. The brief forbids activating a backup automatically.
 *
 * Activating a backup changes who on_duty() returns, which changes whose inbox
 * a family sits in, so duty and the inbox are refreshed with the dashboard.
 */
export function useActivateBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: dashboardApi.activateBackup,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.duty })
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
      void queryClient.invalidateQueries({ queryKey: qk.dashboardAll })
    },
  })
}
