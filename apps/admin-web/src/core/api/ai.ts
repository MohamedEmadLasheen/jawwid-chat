import { api, newIdempotencyKey } from './client'

/**
 * The Phase 7 assistant endpoints.
 *
 * Every response carries `ai_generated: true` where it contains model output.
 * The UI uses that to mark it, per Phase 7 §34: AI output must never be
 * rendered so that it reads as a verified human statement.
 */

export interface KnowledgeArticle {
  id: string
  title: string
  question: string
  answer: string
  category: string
  locale: string
  status: 'draft' | 'approved' | 'inactive'
  version: number
  approvedAt: string | null
  updatedAt: string
}

export interface KnowledgeRevision {
  id: string
  version: number
  title: string
  answer: string
  status: string
  changeReason: string
  changedAt: string
}

export interface FaqAnswer {
  answered: boolean
  answer: string | null
  confidence: number | null
  sources: { id: string; title: string; version: number }[]
  /** Why the assistant declined. Never null when `answered` is false. */
  fallback: 'no_knowledge' | 'low_confidence' | 'ungrounded' | 'ai_unavailable' | null
  aiGenerated: true
}

export interface Suggestion {
  id: string
  conversationId: string
  body: string
  status: string
  confidence: string | null
  knowledgeIds: string[]
  createdAt: string
}

export interface ConversationSummary {
  id: string
  problem: string
  whatWasDone: string
  pendingAction: string
  importantHistory: string
  /** What the model concluded rather than read. Rendered apart from the rest. */
  inferences: string[]
  createdAt: string
}

export interface AttentionFlag {
  id: string
  conversationId: string
  familyId: string | null
  riskType:
    | 'frustrated_parent'
    | 'unanswered_messages'
    | 'potential_escalation'
    | 'cancellation_intent'
  severity: 'low' | 'medium' | 'high'
  confidence: string | null
  reason: string
  /** 'sweep' is arithmetic; 'ai' is a judgement. Shown, because they differ. */
  detectedBy: 'ai' | 'sweep'
  status: string
  createdAt: string
}

export const knowledgeApi = {
  list: (params: { status?: string; locale?: string } = {}) =>
    api.get<{ articles: KnowledgeArticle[] }>('/ai/knowledge', params),
  revisions: (id: string) =>
    api.get<{ revisions: KnowledgeRevision[] }>(`/ai/knowledge/${id}/revisions`),
  create: (input: {
    title: string
    question: string
    answer: string
    category?: string
    locale?: string
    reason: string
  }) => api.post<KnowledgeArticle>('/ai/knowledge', input, newIdempotencyKey()),
  update: (id: string, input: Partial<KnowledgeArticle> & { reason: string }) =>
    api.patch<KnowledgeArticle>(`/ai/knowledge/${id}`, input),
  approve: (id: string, reason: string) =>
    api.post<KnowledgeArticle>(`/ai/knowledge/${id}/approve`, { reason }, newIdempotencyKey()),
  retire: (id: string, reason: string) =>
    api.post<KnowledgeArticle>(`/ai/knowledge/${id}/retire`, { reason }, newIdempotencyKey()),
}

export const assistantApi = {
  ask: (question: string, locale = 'ar') => api.post<FaqAnswer>('/ai/faq', { question, locale }),

  summarize: (conversationId: string, refresh = false) =>
    api.post<{ summary: ConversationSummary | null; cached: boolean }>('/ai/summaries', {
      conversationId,
      refresh,
    }),

  suggestions: (conversationId: string) =>
    api.get<{ suggestions: Suggestion[] }>('/ai/suggestions', { conversationId }),

  /** Drafts a reply. Sends nothing -- `send` below is a separate, human act. */
  generate: (conversationId: string) =>
    api.post<{ suggestion: Suggestion | null }>('/ai/suggestions', { conversationId }),

  /**
   * THE send. Passing `body` means the manager edited the draft first, which
   * the server records distinctly.
   */
  send: (id: string, body?: string) =>
    api.post<{ messageId: string }>(`/ai/suggestions/${id}/send`, { body }, newIdempotencyKey()),

  dismiss: (id: string) => api.post<Suggestion>(`/ai/suggestions/${id}/dismiss`, {}),
}

export const attentionApi = {
  queue: (params: { riskType?: string; severity?: string } = {}) =>
    api.get<{ flags: AttentionFlag[] }>('/ai/attention', params),
  acknowledge: (id: string) => api.post<AttentionFlag>(`/ai/attention/${id}/acknowledge`, {}),
  resolve: (id: string, note: string) =>
    api.post<AttentionFlag>(`/ai/attention/${id}/resolve`, { note }),
  dismiss: (id: string, note: string) =>
    api.post<AttentionFlag>(`/ai/attention/${id}/dismiss`, { note }),
}
