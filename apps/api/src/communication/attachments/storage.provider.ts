import { Logger } from '@nestjs/common';
import type { ObjectStorage } from './object-storage';
import { SignedLocalObjectStorage } from './object-storage';
import { S3ObjectStorage, type S3StorageConfig } from './s3-object-storage';
import {
  LOCAL_PUBLIC_BASE_URL_VAR,
  resolveLocalPublicBaseUrl,
} from './storage-config';

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
 * `STORAGE_ENDPOINT` means ONE thing: the S3-compatible service endpoint.
 *
 * It used to mean two -- also the base URL of *this API's own* `/storage` route,
 * for the local reference implementation -- and that overload was a trap, because
 * its presence is also what SELECTS S3. Setting it to reach the local route
 * therefore produced a half-configured S3 process that refuses to start. The
 * local public base URL is now `STORAGE_PUBLIC_BASE_URL`, resolved in
 * `storage-config.ts`, and neither variable falls back to the other.
 */
export function selectObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('ObjectStorage'),
): StorageSelection {
  const present = S3_VARS.filter((name) => (env[name] ?? '').trim().length > 0);

  if (present.length === 0) {
    // RT-039: the local reference storage builds its upload links on
    // STORAGE_PUBLIC_BASE_URL (storage-config.ts), defaulting to
    // http://localhost:3000/api/v1/storage -- a developer machine, which no
    // client of a deployed API can reach. Outside a developer / test
    // environment the local reference storage is refused at startup instead
    // of shipped, whatever that variable says.
    const appEnv = (env.APP_ENV ?? 'local').trim().toLowerCase();
    if (!['local', 'test', 'ci', ''].includes(appEnv)) {
      throw new Error(
        `object storage: APP_ENV=${appEnv} with no S3 configuration -- the local reference storage ` +
          'would hand clients upload links to a developer machine (default http://localhost:3000/api/v1/storage) ' +
          'served from this container\'s filesystem. ' +
          `Set ${S3_VARS.join(', ')}.`,
      );
    }
    logger.warn(
      'object storage is the local reference implementation: attachments are ' +
        'written to this container filesystem, are lost on redeploy, and are ' +
        'not shared between replicas. Set ' +
        S3_VARS.join(', ') +
        ' to use S3-compatible storage.',
    );

    // Read and validated HERE, once, and handed to the implementation. A client
    // has to reach these URLs, so a wrong base URL is not a cosmetic problem --
    // it is an upload that cannot happen. Saying the resolved value out loud at
    // startup is what turns that from a per-upload mystery into one log line.
    const publicBase = resolveLocalPublicBaseUrl(env);
    if (publicBase.configured) {
      logger.log(`object storage: local reference, signed URLs at ${publicBase.value}`);
    } else {
      logger.warn(
        `${LOCAL_PUBLIC_BASE_URL_VAR} is not set, so signed storage URLs will ` +
          `point at ${publicBase.value}. Any deployment a client reaches over ` +
          'the network must set it to this API\'s own public /storage base URL ' +
          `(for example http://10.0.0.5:3399/api/v1/storage), or every upload ` +
          'and download will be unreachable. Do NOT use STORAGE_ENDPOINT for ' +
          'this: that variable selects the S3 backend.',
      );
    }

    return {
      storage: new SignedLocalObjectStorage({ publicBaseUrl: publicBase.value }),
      kind: 'local',
    };
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

  // Set but meaningless here: S3 presigns against its own endpoint, so this is
  // ignored rather than wrong. Said out loud so nobody debugs a URL by editing a
  // variable this process is not reading.
  if ((env[LOCAL_PUBLIC_BASE_URL_VAR] ?? '').trim().length > 0) {
    logger.warn(
      `${LOCAL_PUBLIC_BASE_URL_VAR} is set but ignored: it configures the local ` +
        'reference storage only, and this process uses S3-compatible storage.',
    );
  }

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
