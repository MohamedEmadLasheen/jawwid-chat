/**
 * Where the LOCAL reference storage's signed URLs point.
 *
 * ## Why this is its own variable, and its own file
 *
 * `SignedLocalObjectStorage` mints URLs that a CLIENT must be able to reach, and
 * those URLs are served by this API's own `/storage` route. So it needs one fact
 * that nothing else in the storage seam needs: the public base URL of this API.
 *
 * It used to borrow `STORAGE_ENDPOINT` for that. `STORAGE_ENDPOINT` is also one
 * of the five variables whose presence SELECTS the S3 backend, so setting it to
 * reach the local route puts the process into a half-configured S3 state and the
 * API refuses to start. A QA deployment proved that the hard way.
 *
 * The two are therefore separate concepts and are kept separate:
 *
 * | variable                  | means                                    | read when |
 * |---------------------------|------------------------------------------|-----------|
 * | `STORAGE_ENDPOINT`        | the S3-compatible service endpoint       | S3 only   |
 * | `STORAGE_PUBLIC_BASE_URL` | this API's own public `/storage` base    | local only|
 *
 * There is deliberately NO fallback between them in either direction. A fallback
 * from `STORAGE_PUBLIC_BASE_URL` to `STORAGE_ENDPOINT` would make a local
 * deployment mint URLs pointing at a bucket; a fallback the other way would make
 * setting a public base URL count toward S3 selection. Both would reintroduce
 * exactly the confusion this file exists to end.
 *
 * This lives in its own module rather than in `storage.provider.ts` because
 * `object-storage.ts` needs it too, and the provider already imports that.
 */

/** Named so error messages and the env manifest cannot drift from the code. */
export const LOCAL_PUBLIC_BASE_URL_VAR = 'STORAGE_PUBLIC_BASE_URL';

/**
 * The laptop default: this API, on its default port, under its global prefix.
 *
 * The previous default omitted the `api/v1` prefix, which `main.ts` applies to
 * every route except `health*` -- so it was wrong even on a laptop. It is a
 * default rather than a required variable because a developer running one API on
 * one machine should not have to configure anything; every other environment
 * must set the variable, and the startup log says so when it has not.
 */
export const LOCAL_PUBLIC_BASE_URL_DEFAULT = 'http://localhost:3000/api/v1/storage';

export interface LocalPublicBaseUrl {
  /** Absolute, http(s), no trailing slash. */
  readonly value: string;
  /** False when the default was used, which every real environment should fix. */
  readonly configured: boolean;
}

/**
 * Resolve the public base URL for the local reference storage.
 *
 * Validates rather than trusts: a value that is not an absolute http(s) URL
 * cannot produce a reachable signed URL, and failing at startup is far cheaper
 * than a client discovering it one upload at a time. A trailing slash is
 * normalised away because the callers join with `/`.
 */
export function resolveLocalPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): LocalPublicBaseUrl {
  const raw = (env[LOCAL_PUBLIC_BASE_URL_VAR] ?? '').trim();
  if (raw.length === 0) {
    return { value: LOCAL_PUBLIC_BASE_URL_DEFAULT, configured: false };
  }
  if (!/^https?:\/\//.test(raw)) {
    throw new Error(
      `${LOCAL_PUBLIC_BASE_URL_VAR} must be an absolute http(s) URL -- it is the ` +
        "public base URL of this API's own /storage route, for example " +
        `"${LOCAL_PUBLIC_BASE_URL_DEFAULT}". It is NOT the S3 endpoint; that is ` +
        'STORAGE_ENDPOINT.',
    );
  }
  return { value: raw.replace(/\/+$/, ''), configured: true };
}
