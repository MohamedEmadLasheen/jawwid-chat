import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { assertLegalConfiguration, isProduction, type LegalConfigState } from './legal-config';
import {
  LEGAL_DOCUMENT_KEYS,
  documentsFor,
  isAccountKind,
  isLegalClient,
  isLegalLocale,
  type AccountKind,
  type LegalClient,
  type LegalDocumentKey,
  type LegalDocumentRef,
  type LegalDto,
  type LegalMethod,
  type LegalStateDto,
  type RequiredLegalDocument,
} from './legal-documents';

/** One of an account kind's documents, as the database holds it right now. */
export interface LegalDocumentState extends LegalConfigState {
  readonly urlAr: string | null;
  readonly urlEn: string | null;
  /**
   * P-3: the account's acceptance satisfies the version in force -- it
   * accepted the latest version that requires acceptance at or before the one
   * in force, or any later version (false when nothing is in force).
   */
  readonly accepted: boolean;
  /** The latest version the account accepted that satisfies it (null when not accepted). */
  readonly acceptedVersion: string | null;
  readonly acceptedAt: Date | null;
}

/** An account's standing against the Terms of Use, computed by ONE query. */
export interface LegalStatus {
  readonly kind: AccountKind;
  /** The kind's two documents, terms first. */
  readonly documents: readonly LegalDocumentState[];
  /** In force and not yet accepted: what the client must show. */
  readonly required: readonly RequiredLegalDocument[];
  /**
   * Documents the gate cannot decide: in production, any document not in force
   * (missing row, not a string, unpublished version); elsewhere, only a row that
   * names an unpublished version or is not a string. Non-empty = 503.
   */
  readonly misconfigured: readonly LegalDocumentKey[];
}

/** What an acceptance carries besides the documents (chat.terms_acceptance.client, .locale). */
export interface LegalAcceptanceInput {
  readonly documents: unknown;
  readonly client: unknown;
  readonly locale: unknown;
}

interface ValidAcceptance {
  readonly documents: readonly { documentKey: LegalDocumentKey; version: string }[];
  readonly client: LegalClient;
  readonly locale: string;
}

interface StateRow {
  kind: string | null;
  document_key: string;
  configured: boolean;
  version: string | null;
  published: boolean;
  url_ar: string | null;
  url_en: string | null;
  accepted_version: string | null;
  accepted_at: Date | null;
}

/** The body POST /me/legal/accept takes: nothing else (above all, no account id). */
export const ACCEPT_BODY_KEYS: ReadonlySet<string> = new Set(['documents', 'client', 'locale']);

/**
 * PD-58 (A-3; roadmap §7.3-7.4): reads the owner's Terms of Use configuration,
 * decides who must accept what, and records acceptances.
 *
 * WRITES go only through chat.accept_legal_documents (the API never inserts
 * into chat.terms_acceptance itself), always with the AUTHENTICATED account --
 * never an id from a request body. Publishing a version is the owner's
 * release process (chat.publish_legal_version); no route publishes.
 *
 * Nothing here is cached across requests: a new version in force is asked for
 * at the account's next request (§7.7 criterion 3). The guard caches one
 * status per request.
 */
@Injectable()
export class LegalService implements OnModuleInit {
  private readonly log = new Logger('Legal');
  /** Outside production: warn once per process about a document not in force, not on every request. */
  private readonly warned = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /** §7.3: production refuses to start without the owner's four versions. */
  async onModuleInit(): Promise<void> {
    const problems = assertLegalConfiguration(await this.configuration());
    if (problems.length > 0) {
      this.log.warn(`PD-58 Terms of Use not fully configured (allowed outside production only): ${problems.join('; ')}`);
    } else {
      this.log.log('PD-58 Terms of Use: all four documents are in force');
    }
  }

  /** The four documents' configuration, for the boot check. */
  async configuration(): Promise<LegalConfigState[]> {
    const rows = await this.rows(null, LEGAL_DOCUMENT_KEYS);
    return rows.map((r) => ({
      documentKey: r.document_key as LegalDocumentKey,
      configured: r.configured,
      version: r.version,
      published: r.published,
    }));
  }

  /**
   * The account's standing: ONE query (the account, the config rows, the
   * versions, the acceptances by primary key). Null for an unknown account.
   */
  async statusOf(accountId: string): Promise<LegalStatus | null> {
    const rows = await this.rows(accountId, LEGAL_DOCUMENT_KEYS);
    const kind = rows[0]?.kind;
    if (!isAccountKind(kind)) return null;
    return this.decide(kind, rows);
  }

  /**
   * The documents a NEW family accepts at PD-16 sign-up: the family terms and
   * the Code of Conduct in force, as a client shows them before the account
   * can sign in. Throws LEGAL_NOT_CONFIGURED when the gate cannot decide.
   */
  async currentFor(kind: AccountKind): Promise<RequiredLegalDocument[]> {
    const status = this.decide(kind, await this.rows(null, documentsFor(kind)));
    this.assertConfigured(status);
    return [...status.required];
  }

  /**
   * GET /me/legal: the kind's documents in force, their URLs, whether the
   * account's acceptance satisfies each, and what is still required. 503 when
   * the configuration cannot be decided (an operator must fix it).
   */
  async stateFor(accountId: string): Promise<LegalStateDto> {
    const status = await this.statusOf(accountId);
    if (!status) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'no such account', 403);
    this.assertConfigured(status);
    return {
      required: status.required.map((d) => ({ ...d })),
      documents: status.documents
        .filter((d) => d.published && d.version !== null && d.urlAr !== null && d.urlEn !== null)
        .map((d) => ({
          documentKey: d.documentKey,
          version: d.version!,
          urlAr: d.urlAr!,
          urlEn: d.urlEn!,
          accepted: d.accepted,
          acceptedVersion: d.acceptedVersion,
          acceptedAt: d.acceptedAt ? d.acceptedAt.toISOString() : null,
        })),
    };
  }

  /**
   * The one read behind every decision. Per document key:
   *   - the `legal.current.<key>` row and the version it names (V);
   *   - the FLOOR (P-3): the latest version that requires acceptance at or
   *     before V. Versions are ordered by (effective_at, created_at, version):
   *     a version name is the owner's free text and carries no order. When no
   *     requiring version is found (the ENG-09 guard makes that impossible),
   *     the floor is V itself -- fail closed;
   *   - the account's latest acceptance at or after the floor (or none).
   * accountId null: no account (the boot check, the sign-up screen).
   */
  private async rows(accountId: string | null, keys: readonly LegalDocumentKey[]): Promise<StateRow[]> {
    return this.prisma.$queryRaw<StateRow[]>`
      SELECT a.kind,
             d.key AS document_key,
             (c.key IS NOT NULL) AS configured,
             CASE WHEN jsonb_typeof(c.value) = 'string' THEN c.value #>> '{}' END AS version,
             (l.version IS NOT NULL) AS published,
             l.url_ar,
             l.url_en,
             acc.version AS accepted_version,
             acc.accepted_at
        FROM unnest(${[...keys]}::text[]) AS d(key)
        LEFT JOIN chat.account a ON a.id = ${accountId}::uuid
        LEFT JOIN chat.config c ON c.key = 'legal.current.' || d.key
        LEFT JOIN chat.legal_document_version l
               ON l.document_key = d.key AND jsonb_typeof(c.value) = 'string' AND l.version = c.value #>> '{}'
        LEFT JOIN LATERAL (
              SELECT r.effective_at, r.created_at, r.version
                FROM chat.legal_document_version r
               WHERE r.document_key = d.key
                 AND r.requires_reacceptance
                 AND (r.effective_at, r.created_at, r.version) <= (l.effective_at, l.created_at, l.version)
               ORDER BY r.effective_at DESC, r.created_at DESC, r.version DESC
               LIMIT 1) f ON l.version IS NOT NULL
        LEFT JOIN LATERAL (
              SELECT t.version, t.accepted_at
                FROM chat.terms_acceptance t
                JOIN chat.legal_document_version v ON v.document_key = t.document_key AND v.version = t.version
               WHERE t.account_id = a.id
                 AND t.document_key = d.key
                 AND (v.effective_at, v.created_at, v.version)
                     >= (coalesce(f.effective_at, l.effective_at), coalesce(f.created_at, l.created_at), coalesce(f.version, l.version))
               ORDER BY v.effective_at DESC, v.created_at DESC, v.version DESC
               LIMIT 1) acc ON l.version IS NOT NULL AND a.id IS NOT NULL`;
  }

  /** The client-facing block: what to accept, an empty list when nothing is outstanding. */
  toDto(status: LegalStatus | null): LegalDto {
    return { required: status ? status.required.map((d) => ({ ...d })) : [] };
  }

  /** The DTO for an account, for GET /me, login, refresh and a password change. Never throws on configuration. */
  async dtoFor(accountId: string): Promise<LegalDto> {
    return this.toDto(await this.statusOf(accountId));
  }

  /**
   * The gate (LegalGuard, and any service that must check without a route
   * decorator -- see requires-legal.decorator.ts): 503 when it cannot decide,
   * 403 TERMS_NOT_ACCEPTED while anything is outstanding.
   */
  assertAccepted(status: LegalStatus | null): void {
    if (!status) throw new CommError(CommErrorCode.TERMS_NOT_ACCEPTED, 'no account to check the Terms of Use against', 403);
    this.assertConfigured(status);
    if (status.required.length > 0) {
      throw new CommError(
        CommErrorCode.TERMS_NOT_ACCEPTED,
        'accept the current Terms of Use and Code of Conduct first (POST /me/legal/accept)',
        403,
        { required: status.required.map((d) => ({ ...d })) },
      );
    }
  }

  /** The same check by account id, for a service-level caller. */
  async assertAccountAccepted(accountId: string): Promise<void> {
    this.assertAccepted(await this.statusOf(accountId));
  }

  /**
   * POST /me/legal/accept. The documents must be this kind's own (no other
   * kind's terms, no duplicates), at the version in force, and must include
   * every outstanding one; re-accepting a document already accepted is a no-op.
   */
  async accept(accountId: string, input: LegalAcceptanceInput): Promise<LegalDto> {
    const valid = parseAcceptance(input);
    const status = await this.statusOf(accountId);
    if (!status) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'no such account', 403);
    this.assertConfigured(status);
    this.check(status, valid.documents, 'cover-outstanding');
    await this.record(this.prisma, accountId, valid, 'gate');
    return this.toDto(await this.statusOf(accountId));
  }

  /**
   * PD-16 sign-up (§7.4): the family terms and the Code of Conduct, exactly,
   * at the versions in force. Validated BEFORE the code is checked (it depends
   * only on the body and the configuration, so it tells nothing about the
   * e-mail); recorded inside the sign-up transaction by recordInTx.
   * Returns null when nothing is in force (outside production only).
   */
  async validateSignup(input: { acceptLegal: unknown; client: unknown; locale: unknown }): Promise<ValidAcceptance | null> {
    const current = await this.currentFor('family');
    const given = input.acceptLegal;
    if (current.length === 0 && (given === undefined || given === null || (Array.isArray(given) && given.length === 0))) {
      return null;
    }
    if (given === undefined || given === null || (Array.isArray(given) && given.length === 0)) {
      throw new CommError(CommErrorCode.LEGAL_REQUIRED, 'sign-up accepts the family terms and the Code of Conduct (acceptLegal)', 400);
    }
    const valid = parseAcceptance({ documents: given, client: input.client, locale: input.locale });
    const status: LegalStatus = {
      kind: 'family',
      documents: [],
      required: current,
      misconfigured: [],
    };
    this.check(status, valid.documents, 'exactly-current');
    return valid;
  }

  /** Records a validated acceptance inside the caller's transaction (sign-up). */
  async recordInTx(tx: Prisma.TransactionClient, accountId: string, valid: ValidAcceptance): Promise<void> {
    await this.record(tx, accountId, valid, 'signup');
  }

  // ------------------------------------------------------------------------

  private decide(kind: AccountKind, rows: readonly StateRow[]): LegalStatus {
    const production = isProduction();
    const documents: LegalDocumentState[] = [];
    const required: RequiredLegalDocument[] = [];
    const misconfigured: LegalDocumentKey[] = [];
    for (const key of documentsFor(kind)) {
      const r = rows.find((row) => row.document_key === key);
      const state: LegalDocumentState = {
        documentKey: key,
        configured: r?.configured ?? false,
        version: r?.version ?? null,
        published: r?.published ?? false,
        urlAr: r?.url_ar ?? null,
        urlEn: r?.url_en ?? null,
        accepted: (r?.accepted_version ?? null) !== null,
        acceptedVersion: r?.accepted_version ?? null,
        acceptedAt: r?.accepted_at ?? null,
      };
      documents.push(state);
      if (state.published && state.version !== null && state.urlAr !== null && state.urlEn !== null) {
        if (!state.accepted) required.push({ documentKey: key, version: state.version, urlAr: state.urlAr, urlEn: state.urlEn });
      } else if (state.configured || production) {
        // A row that names nothing publishable is a misconfiguration everywhere;
        // a missing row is one in production (§7.3, fail closed).
        misconfigured.push(key);
      } else if (!this.warned.has(key)) {
        this.warned.add(key);
        this.log.warn(`PD-58: legal.current.${key} is not configured; outside production it is not asked for`);
      }
    }
    return { kind, documents, required, misconfigured };
  }

  private assertConfigured(status: LegalStatus): void {
    if (status.misconfigured.length > 0) {
      throw new CommError(
        CommErrorCode.LEGAL_NOT_CONFIGURED,
        'the Terms of Use configuration is incomplete; an operator must fix it',
        503,
      );
    }
  }

  /**
   * 'cover-outstanding' (POST /me/legal/accept): own documents only, no
   * duplicates, current versions, and every outstanding document included.
   * 'exactly-current' (sign-up): exactly the documents in force.
   */
  private check(
    status: LegalStatus,
    documents: readonly { documentKey: LegalDocumentKey; version: string }[],
    mode: 'cover-outstanding' | 'exactly-current',
  ): void {
    const own = new Set<string>(documentsFor(status.kind));
    const keys = documents.map((d) => d.documentKey);
    const wrong = () =>
      new CommError(CommErrorCode.LEGAL_WRONG_DOCUMENTS, `a ${status.kind} account accepts ${[...own].join(' and ')}`, 400);
    if (new Set(keys).size !== keys.length || keys.some((k) => !own.has(k))) throw wrong();

    // The version in force for each of the kind's documents (accepted or not).
    const inForce = new Map<string, string>();
    for (const d of status.documents) {
      if (d.published && d.version !== null) inForce.set(d.documentKey, d.version);
    }
    for (const d of status.required) inForce.set(d.documentKey, d.version);

    if (mode === 'exactly-current') {
      const current = status.required.map((d) => d.documentKey);
      if (current.length !== keys.length || current.some((k) => !keys.includes(k))) throw wrong();
    } else if (status.required.some((d) => !keys.includes(d.documentKey))) {
      throw wrong();
    }
    // A document with nothing in force (outside production) cannot be accepted.
    if (keys.some((k) => !inForce.has(k))) throw wrong();
    for (const d of documents) {
      if (inForce.get(d.documentKey) !== d.version) {
        throw new CommError(
          CommErrorCode.LEGAL_VERSION_STALE,
          `${d.documentKey} has a newer version in force; reload and accept it`,
          409,
          { documentKey: d.documentKey },
        );
      }
    }
  }

  /**
   * The only write: chat.accept_legal_documents with the AUTHENTICATED account
   * (the token's, or the account the sign-up transaction just activated) and
   * how it was accepted (P-2: 'gate' | 'signup', never from the request).
   */
  private async record(
    db: Pick<Prisma.TransactionClient, '$queryRaw'>,
    accountId: string,
    valid: ValidAcceptance,
    method: LegalMethod,
  ): Promise<void> {
    const documents = JSON.stringify(valid.documents.map((d) => ({ document_key: d.documentKey, version: d.version })));
    await db.$queryRaw`
      SELECT chat.accept_legal_documents(${accountId}::uuid, ${documents}::jsonb, ${valid.client}, ${valid.locale}, ${method})`;
  }
}

/** 400 COMMON.VALIDATION for a malformed body; the documents' meaning is checked later. */
function parseAcceptance(input: LegalAcceptanceInput): ValidAcceptance {
  const invalid = (field: string) => new CommError(CommErrorCode.VALIDATION, `${field} is invalid`, 400);
  if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 8) throw invalid('documents');
  const documents = input.documents.map((raw: unknown) => {
    const d = (raw ?? {}) as Partial<LegalDocumentRef>;
    if (typeof d.documentKey !== 'string' || typeof d.version !== 'string' || d.version.length < 1 || d.version.length > 64) {
      throw invalid('documents');
    }
    if (!(LEGAL_DOCUMENT_KEYS as readonly string[]).includes(d.documentKey)) {
      throw new CommError(CommErrorCode.LEGAL_WRONG_DOCUMENTS, `${d.documentKey} is not a legal document`, 400);
    }
    return { documentKey: d.documentKey as LegalDocumentKey, version: d.version };
  });
  if (!isLegalClient(input.client)) throw invalid('client');
  if (!isLegalLocale(input.locale)) throw invalid('locale');
  return { documents, client: input.client, locale: input.locale };
}
