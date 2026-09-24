/**
 * The Core webhook boundary's configuration, resolved from the environment.
 *
 * FAIL CLOSED. A deployment with no usable secret does not get a boundary that
 * accepts anything -- it gets one that answers 503 and accepts nothing. "An
 * unconfigured boundary must never be an open one" is the integration
 * contract's wording, and it is the reason this returns null rather than
 * throwing at boot: the rest of the API must still serve families while the
 * Core integration is unconfigured.
 *
 * NOTHING IS STORED IN THE DATABASE. The secret lives in the process
 * environment and nowhere else -- not in chat.config, not in a key table, not
 * in a log line. It is never part of an error message or a response body.
 */

/** One shared secret, named by the key id Core sends in `X-Jawwid-Key-Id`. */
export interface WebhookKey {
  readonly keyId: string;
  /**
   * The HMAC key, as RAW UTF-8 BYTES of the configured string.
   *
   * Not hex, not base64, no implicit transformation of any kind. A boundary
   * that guessed differently from the sender would reject every genuine
   * delivery, and the failure would be indistinguishable from an attack.
   */
  readonly secret: string;
}

export interface CoreWebhookConfig {
  readonly keys: readonly WebhookKey[];
  /** ± window for `X-Jawwid-Timestamp`, in seconds. */
  readonly toleranceSeconds: number;
}

/** The contract's default: 300 seconds either side. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** The raw body ceiling, checked before anything parses or trusts the body. */
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

/**
 * Parse `CORE_WEBHOOK_SECRETS`, whose shape is `keyid:secret[,keyid2:secret2]`.
 *
 * MORE THAN ONE ENTRY IS HOW A ROTATION LANDS: Core switches to the new key id
 * while both are accepted, and the old secret is dropped afterwards. That is
 * the whole of the key-management story -- there is deliberately no database
 * store and no second mechanism.
 *
 * A malformed entry is DROPPED rather than tolerated. Accepting `secret` with
 * no key id would mean guessing which key a delivery meant, and guessing is how
 * an authentication boundary becomes decorative. If dropping leaves no keys at
 * all, the boundary is unconfigured and answers 503.
 */
export function loadCoreWebhookConfig(
  env: NodeJS.ProcessEnv = process.env,
): CoreWebhookConfig | null {
  const keys: WebhookKey[] = [];
  const seen = new Set<string>();

  for (const entry of (env.CORE_WEBHOOK_SECRETS ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    // Split on the FIRST colon only: a secret is allowed to contain one.
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;

    const keyId = trimmed.slice(0, separator).trim();
    const secret = trimmed.slice(separator + 1);
    if (keyId.length === 0 || secret.length === 0) continue;
    // A repeated key id would make "which secret" ambiguous. First wins, and
    // the duplicate is dropped rather than silently shadowing it.
    if (seen.has(keyId)) continue;

    seen.add(keyId);
    keys.push({ keyId, secret });
  }

  if (keys.length === 0) return null;

  return { keys, toleranceSeconds: parseTolerance(env.CORE_WEBHOOK_TOLERANCE_SECONDS) };
}

/**
 * The replay window.
 *
 * An unparsable or non-positive value falls back to the documented default
 * rather than disabling the check: a typo in an environment variable must not
 * be a way to turn off replay protection.
 */
function parseTolerance(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TOLERANCE_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TOLERANCE_SECONDS;
  return Math.floor(parsed);
}
