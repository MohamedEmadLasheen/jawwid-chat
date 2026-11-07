/**
 * PD-58 (owner decision A-3; roadmap 2026-11-03 §7.1): which legal documents an
 * account accepts. The code holds the document KEYS only -- never a version
 * name, a URL or a word of the documents (N-3 is pending). Versions and URLs
 * are the owner's: chat.legal_document_version (published by the owner's
 * release process with chat.publish_legal_version) and the chat.config rows
 * `legal.current.<document_key>` that name the version in force.
 *
 *   chat.account.kind   terms document     plus
 *   family              terms_family       code_of_conduct
 *   teacher             terms_teacher      code_of_conduct
 *   staff               terms_staff        code_of_conduct   (Sales and the Super Admin too)
 */
export const LEGAL_DOCUMENT_KEYS = ['terms_family', 'terms_teacher', 'terms_staff', 'code_of_conduct'] as const;
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

export type AccountKind = 'family' | 'teacher' | 'staff';

/** The documents one account kind accepts, in the order a client shows them. */
export function documentsFor(kind: AccountKind): readonly [LegalDocumentKey, LegalDocumentKey] {
  switch (kind) {
    case 'family':
      return ['terms_family', 'code_of_conduct'];
    case 'teacher':
      return ['terms_teacher', 'code_of_conduct'];
    case 'staff':
      return ['terms_staff', 'code_of_conduct'];
  }
}

export function isAccountKind(value: unknown): value is AccountKind {
  return value === 'family' || value === 'teacher' || value === 'staff';
}

/** The chat.config key that names a document's version in force (§7.2). */
export function currentVersionKey(key: LegalDocumentKey): string {
  return `legal.current.${key}`;
}

/** Where an acceptance was given (chat.terms_acceptance.client). */
export const LEGAL_CLIENTS = ['android', 'ios', 'web_portal', 'admin_web'] as const;
export type LegalClient = (typeof LEGAL_CLIENTS)[number];

export function isLegalClient(value: unknown): value is LegalClient {
  return typeof value === 'string' && (LEGAL_CLIENTS as readonly string[]).includes(value);
}

/** A BCP 47-shaped tag, exactly as chat.terms_acceptance's check reads it ('ar', 'en', 'ar-EG'). */
export function isLegalLocale(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 35 && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(value);
}

/** One document the caller must accept, as GET /me and the login answer list it. */
export interface RequiredLegalDocument {
  readonly documentKey: LegalDocumentKey;
  readonly version: string;
  readonly urlAr: string;
  readonly urlEn: string;
}

/** The `legal` block of GET /me, POST /auth/login and POST /auth/refresh. */
export interface LegalDto {
  readonly required: readonly RequiredLegalDocument[];
}

/** One document named in a request: {documentKey, version}. */
export interface LegalDocumentRef {
  readonly documentKey: string;
  readonly version: string;
}

/** P-2: how an acceptance was given (chat.terms_acceptance.method). The server decides it, never the request. */
export type LegalMethod = 'signup' | 'gate';

/** One of the account's documents in force, as GET /me/legal lists it. */
export interface LegalDocumentStateDto extends RequiredLegalDocument {
  /** The account's acceptance satisfies this version (P-3: it may be of an earlier version that required acceptance). */
  readonly accepted: boolean;
  /** The version whose acceptance satisfies it; null when not accepted. */
  readonly acceptedVersion: string | null;
  /** When that acceptance was recorded (ISO 8601, the database's clock); null when not accepted. */
  readonly acceptedAt: string | null;
}

/** GET /me/legal. */
export interface LegalStateDto {
  /** The same list as GET /me `legal.required`: what to accept, empty when nothing is outstanding. */
  readonly required: readonly RequiredLegalDocument[];
  /** The kind's documents in force (its terms first, then the Code of Conduct). */
  readonly documents: readonly LegalDocumentStateDto[];
}
