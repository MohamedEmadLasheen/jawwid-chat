import { Logger } from '@nestjs/common';
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { canonicalJson } from './review-subjects';

/**
 * PD-49: the signature on an approvals export (plan F.3; department head,
 * 2026-10-29). Only the API holds the private key, LESSON_APPROVALS_SIGNING_KEY,
 * an Ed25519 key the owner generates; it is never in the repository, a log or
 * a chat. The repository holds the PUBLIC keys with their ids
 * (apps/lessons/src/content/approvals-keys.json), so CI verifies every
 * committed approvals file and a hand-edited or forged one fails. Rotation:
 * a new key gets a new id; old keys stay listed (retired), so what they signed
 * stays verifiable.
 *
 * The key is a PEM PKCS#8 private key, or its base64 DER. Unset or unreadable:
 * no signer, and the export refuses (fail closed).
 */
export interface Signer {
  step: 'check' | 'teacher' | 'scholar';
  staffId: string;
  at: string;
}

export interface ApprovalsPayload {
  v: 1;
  /** The environment that signed it (APP_ENV): CI accepts only "production" approvals, under a production key. */
  env: string;
  /** When it was signed: a changed approvals file must be strictly newer than the one it replaces (no replay). */
  issuedAt: string;
  datasetId: string;
  lessonKey: string;
  approvals: { id: string; approvalSha256: string; steps: string[]; signers: Signer[] }[];
}

export interface SignedApprovals {
  payload: ApprovalsPayload;
  keyId: string;
  signature: string;
}

/** A key's id: the first 16 hex of the SHA-256 of its public SPKI DER (as scripts/lessons/verify-approvals.mjs). */
export function keyIdOf(publicKey: KeyObject): string {
  return createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);
}

export function readSigningKey(raw: string | undefined): KeyObject | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const key = text.startsWith('-----BEGIN')
      ? createPrivateKey({ key: text, format: 'pem' })
      : createPrivateKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'pkcs8' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

export class ApprovalsSigner {
  private readonly key: KeyObject | null;
  readonly keyId: string | null;

  constructor(raw: string | undefined = process.env.LESSON_APPROVALS_SIGNING_KEY) {
    this.key = readSigningKey(raw);
    this.keyId = this.key ? keyIdOf(createPublicKey(this.key)) : null;
    // Said once, at boot, and never the value: a key that is set but unusable is a misconfiguration.
    if (raw?.trim() && !this.key) {
      new Logger('ApprovalsSigner').warn('LESSON_APPROVALS_SIGNING_KEY is set but is not a readable Ed25519 private key: approvals cannot be exported');
    }
  }

  get available(): boolean {
    return this.key !== null;
  }

  /** The signed envelope, over the canonical JSON of the payload. */
  sign(payload: ApprovalsPayload): SignedApprovals | null {
    if (!this.key || !this.keyId) return null;
    const signature = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), this.key).toString('base64');
    return { payload, keyId: this.keyId, signature };
  }
}
