import { api } from '@/core/api/client'
import type { AyahsAnswer, VerseRef } from './board'

/**
 * PD-39 §10 1b, 1c, 4a: teachers' boards for staff, read-only
 * (apps/api/src/whiteboards/whiteboard.controller.ts, TeacherBoardsController).
 * The key is necessary, never sufficient: the server answers 404 unless the
 * caller is the teacher's assigned supervisor, their active backup, the
 * Teachers Manager or the super admin, and it logs every listing and open.
 */

/** Either key opens the page; the server decides each teacher. */
export const BOARD_KEYS = ['whiteboards.view', 'whiteboards.retention'] as const
/** The access history and the copy of a departed teacher's board. */
export const RETENTION_KEYS = ['whiteboards.retention'] as const

export interface BoardSummary {
  id: string
  title: string
  lessonId: string | null
  state: 'active' | 'trashed' | 'retained'
  revision: number
  pageCount: number
  createdAt: string
  updatedAt: string
  trashedAt: string | null
  purgeAfter: string | null
  /** A departed teacher's board: kept until this moment, then deleted for good. */
  retainedUntil: string | null
}

export interface BoardPageJson {
  id: string
  position: number
  layout: string
  background: string
  document: unknown
  updatedAt: string
}

export interface BoardDetail extends BoardSummary {
  teacherId: string
  /** Always false here: staff never edit a teacher's board. */
  canEdit: boolean
  pages: BoardPageJson[]
}

export interface AccessLogEntry {
  viewerId: string | null
  viewerKind: 'teacher' | 'staff' | 'support_session' | 'system' | string
  viewerName: string | null
  basis: string
  action: string
  detail: Record<string, unknown> | null
  at: string
}

const seg = (s: string) => encodeURIComponent(s)

export const teacherBoardsApi = {
  list: (teacherId: string) => api.get<BoardSummary[]>('/teacher-boards', { teacherId }),
  board: (boardId: string) => api.get<BoardDetail>(`/teacher-boards/${seg(boardId)}`),
  accessLog: (boardId: string) => api.get<AccessLogEntry[]>(`/teacher-boards/${seg(boardId)}/access-log`),
  /** `key` makes a retry of the same copy answer the first copy, never make a second one. */
  copy: (boardId: string, teacherId: string, key: string) => api.post<BoardSummary>(`/teacher-boards/${seg(boardId)}/copy`, { teacherId }, key),
  /** The verified text of one verse element's range (PD-29 P0-2, shared with PD-39). */
  ayahs: (ref: VerseRef) => api.get<AyahsAnswer>('/quran/ayahs', { surah: ref.surah, from: ref.fromAyah, to: ref.toAyah }),
}

export const teacherBoardsKeys = {
  all: ['teacher-boards'] as const,
  list: (teacherId: string) => ['teacher-boards', 'list', teacherId] as const,
  board: (boardId: string) => ['teacher-boards', 'board', boardId] as const,
  accessLog: (boardId: string) => ['teacher-boards', 'access-log', boardId] as const,
  verse: (key: string) => ['teacher-boards', 'verse', key] as const,
}
