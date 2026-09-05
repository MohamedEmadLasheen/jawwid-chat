import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { taskApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import type { Task } from '@/shared/types/domain'

export function useTasks(filters: {
  scope: 'mine' | 'team' | 'department'
  status?: string
  overdue?: boolean
}) {
  const query = useInfiniteQuery({
    queryKey: qk.tasks(filters),
    queryFn: ({ pageParam }) => taskApi.list({ ...filters, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const tasks: Task[] = query.data?.pages.flatMap((page) => page.items) ?? []
  return { ...query, tasks }
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Task, 'status' | 'due_at' | 'result'>> }) =>
      taskApi.update(id, patch),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tasksAll })
      // Completing the last open task on a case reopens it and moves the family
      // to TODAY (brief §8) — that happens server-side, so the inbox is stale.
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
    },
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof taskApi.create>[0]) => taskApi.create(input),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: qk.tasksAll })
      void queryClient.invalidateQueries({ queryKey: qk.family(task.family_id) })
    },
  })
}
