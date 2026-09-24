import { Logger } from '@nestjs/common';
import type { ObjectStorage } from './object-storage';
import { SignedLocalObjectStorage } from './object-storage';
import { S3ObjectStorage, type S3StorageConfig } from './s3-object-storage';

/**
 * Which storage implementation this process runs. Owner: AI #7.
 *
 * ## Configured, not compiled
 *
 * The provider is chosen from the environment, so pointing staging at
 * Cloudflare R2, production at R2 or S3, and a laptop at neither is a
 * configuration decision. No provider is named in code, and choosing one later
 * is not a code change.
 *
 * ## Why a partial configuration is a startup failure
 *
 * The dangerous state is not "no S3 configured" -- that is a laptop. It is
 * "S3 half-configured": a bucket and an endpoint but no credentials, or the
 * reverse. Falling back to local storage there would produce a deployment that
 * boots, accepts uploads, and writes them to a container filesystem that the
 * next deploy deletes -- while every dashboard says the bucket is configured.
 * So a partial configuration refuses to start and names the variables that are
 * missing.
 */
const S3_VARS = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
] as const;

/** The credential-bearing half. Named so an error can say "set these too". */
const S3_CREDENTIAL_VARS = ['STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'] as const;

export interface StorageSelection {
  storage: ObjectStorage;
  /** `s3` or `local`, for the startup log and for tests to assert on. */
  kind: 's3' | 'local';
}

/**
 * `STORAGE_ENDPOINT` means two different things, and this is the only place
 * that has to know it.
 *
 * For the local reference implementation it is the base URL of *this API's own*
 * `/storage` route, because that is where its signed URLs point. For S3 it is
 * the storage endpoint. The two never apply at once: the value is read as an S3
 * endpoint only when the credentials and bucket are present as well.
 */
export function selectObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('ObjectStorage'),
): StorageSelection {
  const present = S3_VARS.filter((name) => (env[name] ?? '').trim().length > 0);

  if (present.length === 0) {
    logger.warn(
      'object storage is the local reference implementation: attachments are ' +
        'written to this container filesystem, are lost on redeploy, and are ' +
        'not shared between replicas. Set ' +
        S3_VARS.join(', ') +
        ' to use S3-compatible storage.',
    );
    return { storage: new SignedLocalObjectStorage(), kind: 'local' };
  }

  if (present.length !== S3_VARS.length) {
    const missing = S3_VARS.filter((name) => !present.includes(name));
    throw new Error(
      `object storage is partially configured: ${present.join(', ')} set, ` +
        `${missing.join(', ')} missing. Set all of ${S3_VARS.join(', ')} to use ` +
        'S3-compatible storage, or none of them to use the local reference ' +
        'implementation. Starting with a partial configuration would silently ' +
        'write attachments to a container filesystem that the next deploy deletes.',
    );
  }

  const config = readS3Config(env);
  logger.log(
    `object storage: S3-compatible, bucket "${config.bucket}", region ` +
      `"${config.region}", signed URL TTL ${config.signedUrlTtlSeconds}s`,
  );
  return { storage: new S3ObjectStorage(config), kind: 's3' };
}

/**
 * Reads the S3 half of the storage configuration.
 *
 * Credentials are read here and nowhere else, are never logged, and are never
 * placed on a response: `UploadAuthorization` carries a presigned URL, which
 * grants one operation on one key for a bounded time, and never the key pair
 * that signed it.
 */
export function readS3Config(env: NodeJS.ProcessEnv = process.env): S3StorageConfig {
  for (const name of S3_VARS) {
    if (!(env[name] ?? '').trim()) {
      throw new Error(`${name} is required for S3-compatible object storage`);
    }
  }

  const endpoint = env.STORAGE_ENDPOINT!.trim();
  if (!/^https?:\/\//.test(endpoint)) {
    throw new Error('STORAGE_ENDPOINT must be an absolute http(s) URL');
  }

  const ttl = Number(env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error('STORAGE_SIGNED_URL_TTL_SECONDS must be a positive number of seconds');
  }
  // A signed URL is a bearer credential for one object. An hour-long one
  // outlives the screen it was rendered on and ends up in logs, proxies and
  // pasted tickets; ADR-005 sets the default at 300s and this keeps the ceiling
  // near it rather than leaving it to a typo.
  if (ttl > 3600) {
    throw new Error(
      'STORAGE_SIGNED_URL_TTL_SECONDS must not exceed 3600: a signed URL is a ' +
        'bearer credential for one object and must be short-lived (ADR-005)',
    );
  }

  return {
    endpoint,
    region: env.STORAGE_REGION!.trim(),
    bucket: env.STORAGE_BUCKET!.trim(),
    accessKeyId: env.STORAGE_ACCESS_KEY!.trim(),
    secretAccessKey: env.STORAGE_SECRET_KEY!.trim(),
    signedUrlTtlSeconds: ttl,
  };
}

/** Exported for the tests and for error messages. */
export const S3_STORAGE_VARS = S3_VARS;
export const S3_STORAGE_CREDENTIAL_VARS = S3_CREDENTIAL_VARS;
