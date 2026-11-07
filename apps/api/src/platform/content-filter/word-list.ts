import draft from './word-list.draft.json';

/**
 * LD-12 / MG-3: the word list the content filter uses in production.
 *
 * DRAFT, PENDING OWNER APPROVAL. The words are data, in
 * `word-list.draft.json` beside this file, so the owner and the Teachers
 * department review a plain list rather than code. Changing a word is a
 * reviewed change: the false-positive guard test must still pass.
 */
export interface DraftWordList {
  /** Starts with "DRAFT" until the owner approves the list. */
  status: string;
  approvedBy: string | null;
  approvedOn: string | null;
  ar: readonly string[];
  en: readonly string[];
}

export const DRAFT_WORD_LIST: DraftWordList = draft;
