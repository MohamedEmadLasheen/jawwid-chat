import { LEGAL_DOCUMENT_KEYS, currentVersionKey, type LegalDocumentKey } from './legal-documents';

/**
 * PD-58 §7.3: configuration safety, FAIL CLOSED.
 *
 * In production the API (and the worker, which boots the same AppModule)
 * refuses to start when any of the four `legal.current.*` rows is missing, is
 * not a version name, or names a version that was never published -- the same
 * stance as the Stripe guard (billing/stripe-config.ts) and the push provider
 * guard. Outside production a missing configuration is a warning, and the gate
 * treats that one document as not configured (see LegalService). So "no terms
 * configured" can never quietly mean "no terms required" in production.
 *
 * The rows are the owner's (N-3). The release process publishes each version
 * with chat.publish_legal_version, then names it in force:
 *
 *   insert into chat.config (key, value, scope, description)
 *   values ('legal.current.terms_family', to_jsonb('<the owner''s version>'::text), 'legal',
 *           'PD-58: the family terms in force')
 *   on conflict (key) do update set value = excluded.value, updated_at = now();
 */

/** What the database holds for one document (one row of LegalService.configuration()). */
export interface LegalConfigState {
  readonly documentKey: LegalDocumentKey;
  /** A `legal.current.<key>` row exists. */
  readonly configured: boolean;
  /** The row's value when it is a JSON string; null when absent or any other JSON type. */
  readonly version: string | null;
  /** chat.legal_document_version holds (documentKey, version). */
  readonly published: boolean;
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.APP_ENV ?? '').trim() === 'production';
}

/**
 * Every problem with the configuration, one line each (names and keys only --
 * a version name is the owner's, but it is not a secret; still, only the key
 * is printed). Empty when all four documents are configured and published.
 */
export function legalConfigurationProblems(states: readonly LegalConfigState[]): string[] {
  const problems: string[] = [];
  for (const key of LEGAL_DOCUMENT_KEYS) {
    const state = states.find((s) => s.documentKey === key);
    const name = currentVersionKey(key);
    if (!state || !state.configured) problems.push(`${name} is missing`);
    else if (state.version === null) problems.push(`${name} is not a version name (a JSON string)`);
    else if (!state.published) problems.push(`${name} names a version that was never published (chat.publish_legal_version)`);
  }
  return problems;
}

/**
 * The boot check. Throws in production when anything is missing; returns the
 * problems elsewhere so the caller logs them as a warning.
 */
export function assertLegalConfiguration(states: readonly LegalConfigState[], env: NodeJS.ProcessEnv = process.env): string[] {
  const problems = legalConfigurationProblems(states);
  if (problems.length > 0 && isProduction(env)) {
    throw new Error(
      `PD-58: production refuses to start without the owner's Terms of Use configuration: ${problems.join('; ')}`,
    );
  }
  return problems;
}
