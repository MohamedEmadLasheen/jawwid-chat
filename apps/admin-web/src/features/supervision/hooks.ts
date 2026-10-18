import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  supervisionApi,
  supervisionKeys,
  uploadCertificateFile,
  type ApproveBody,
  type CertificateState,
  type LeaveState,
} from './api'

export function useCertificates(state?: CertificateState) {
  return useQuery({ queryKey: supervisionKeys.certificates(state), queryFn: () => supervisionApi.certificates(state), staleTime: 15_000 })
}

export function useLeaveRequests(state?: LeaveState) {
  return useQuery({ queryKey: supervisionKeys.leave(state), queryFn: () => supervisionApi.leaveRequests(state), staleTime: 15_000 })
}

/**
 * One teacher's leave. A refusal (403) is an answer, not an outage -- the
 * section simply does not show -- so it is not retried.
 */
export function useTeacherLeave(teacherId: string, year?: number) {
  return useQuery({
    queryKey: supervisionKeys.teacherLeave(teacherId, year),
    queryFn: () => supervisionApi.teacherLeave(teacherId, year),
    staleTime: 15_000,
    retry: false,
  })
}

function useRefreshAll() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: supervisionKeys.allCertificates })
    void qc.invalidateQueries({ queryKey: supervisionKeys.allLeave })
    void qc.invalidateQueries({ queryKey: supervisionKeys.allTeacherLeave })
    // A leave approval writes day_off entries the Teacher File shows.
    void qc.invalidateQueries({ queryKey: ['teacher-files'] })
  }
}

/** Upload the file on its signed URL, then issue. Nothing is issued if the upload fails. */
export function useIssueCertificate() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: async ({ certificateId, file }: { certificateId: string; file: File }) => {
      const { objectKey } = await uploadCertificateFile(certificateId, file)
      return supervisionApi.issueCertificate(certificateId, {
        objectKey,
        mimeType: file.type,
        byteSize: file.size,
        fileName: file.name,
      })
    },
    onSuccess: done,
  })
}

export function useDeclineCertificate() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ certificateId, reason }: { certificateId: string; reason: string }) =>
      supervisionApi.declineCertificate(certificateId, reason),
    onSuccess: done,
  })
}

export function useApproveLeave() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: ApproveBody }) => supervisionApi.approveLeave(requestId, body),
    onSuccess: done,
  })
}

export function useDeclineLeave() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note: string }) => supervisionApi.declineLeave(requestId, note),
    onSuccess: done,
  })
}

export function useCancelLeave() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note: string }) => supervisionApi.cancelLeave(requestId, note),
    onSuccess: done,
  })
}

export function useSetAllowance(teacherId: string) {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: (body: { year: number; days: number; note?: string }) => supervisionApi.setAllowance(teacherId, body),
    onSuccess: done,
  })
}

export function useOpenSupervision() {
  return useMutation({ mutationFn: (teacherId: string) => supervisionApi.openSupervision(teacherId) })
}
