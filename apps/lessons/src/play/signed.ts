import playApprovals from '../content/approvals/play.json';
import { APPROVAL_KEYS, type ApprovalKey } from '../content/quran-content';
import { MECHANICS, type Mechanic } from './mechanics';

/**
 * PD-49: what decides which games a child may play -- the mechanics registry,
 * the signed approvals/play.json and the keys that may sign it. Fixed at build
 * time and frozen: no parent component passes them, so no page can hand
 * PlayLesson its own keys or approvals (tests replace this module instead).
 */
export const SIGNED: Readonly<{ mechanics: readonly Mechanic[]; approvals: unknown; keys: readonly ApprovalKey[] }> = Object.freeze({
  mechanics: MECHANICS,
  approvals: playApprovals,
  keys: APPROVAL_KEYS,
});
