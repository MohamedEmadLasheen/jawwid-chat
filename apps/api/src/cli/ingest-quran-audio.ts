import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { cliPrismaClient } from './cli-prisma';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import type { PrismaService } from '../platform/prisma.service';
import { listExtracted, planIngest, verifyArchive, type IngestPlan } from '../quran/audio-archive';
import { prismaAudioRowWriter } from '../quran/audio-ingest';
import { runIngest } from '../quran/audio-ingest-run';
import { AUDIO_SOURCES } from '../quran/audio-sources';
import { describeTarget } from './bootstrap-super-admin';

/**
 * `node dist/cli/ingest-quran-audio.js` -- ingest a recitation's per-ayah audio.
 *
 *   --archive <path>        the official archive; its file name, size and SHA-256
 *                           (hashed as a stream) must be listed in quran/audio-sources.ts
 *   --extracted <dir>       the folder the archive was extracted into, with the
 *                           system bsdtar (`bsdtar -xf <archive> -C <dir>`), never run;
 *                           its manifest hash must be the one pinned for the archive
 *   --reciter <code>        default kfgqpc-huthify-hafs
 *   (default)               DRY RUN: plan and report; nothing is stored or written
 *   --write                 store the files and write the rows (via ingestAyahAudio)
 *   --target <host:port/db> REQUIRED with --write; must name DATABASE_URL's target
 *   --allow-non-local       with --write: required unless APP_ENV is EXPLICITLY local, test or ci
 *
 * --write needs a COMPLETE plan: the archive verified, the extracted folder the
 * pinned one, no reject, and all 6,236 ayat. The dry run prints the folder's
 * manifest hash, to be pinned in audio-sources.ts after the first verified
 * extraction.
 *
 * Writing audio does not serve it: the release gate (quran/audio-gate.ts)
 * decides who hears it, and no student does until the licence is recorded.
 */
const LOCAL_ENVS = new Set(['local', 'test', 'ci']);

/** Writing is local-only unless asked; an unset APP_ENV is NOT local. */
export function mayWriteHere(appEnv: string, allowNonLocal: boolean): boolean {
  return allowNonLocal || LOCAL_ENVS.has(appEnv.trim().toLowerCase());
}

export interface IngestArgs {
  archive: string;
  extracted: string;
  reciter: string;
  write: boolean;
  target?: string;
  allowNonLocal: boolean;
}

export class UsageError extends Error {}

export function parseIngestArgs(argv: string[]): IngestArgs {
  const args: IngestArgs = { archive: '', extracted: '', reciter: 'kfgqpc-huthify-hafs', write: false, allowNonLocal: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--archive': args.archive = value(); break;
      case '--extracted': args.extracted = value(); break;
      case '--reciter': args.reciter = value(); break;
      case '--dry-run': args.write = false; break;
      case '--write': args.write = true; break;
      case '--target': args.target = value(); break;
      case '--allow-non-local': args.allowNonLocal = true; break;
      default: throw new UsageError(`unknown option ${flag}`);
    }
  }
  if (!args.archive) throw new UsageError('give the --archive');
  if (!args.extracted) throw new UsageError('give the --extracted folder (the archive extracted with bsdtar)');
  if (!AUDIO_SOURCES.has(args.reciter)) throw new UsageError(`${args.reciter} is not a reciter in quran/audio-sources.ts`);
  return args;
}

/** What the operator reads: never the audio, never a credential. */
export function summarise(plan: IngestPlan) {
  return {
    reciter: plan.reciter,
    archive: { name: plan.archive.name, sha256: plan.archive.sha256, bytes: plan.archive.bytes, refused: plan.archive.refused },
    extractedManifestSha256: plan.extractedManifestSha256,
    manifest: plan.manifest,
    accepted: plan.accepted.length,
    extras: plan.extras,
    rejected: plan.rejected.length,
    rejects: plan.rejected.slice(0, 100),
    missing: plan.missing.length,
    missingFirst: plan.missing.slice(0, 50),
    expected: plan.expected,
    complete: plan.complete,
  };
}

async function main(): Promise<void> {
  const args = parseIngestArgs(process.argv.slice(2));
  const spec = AUDIO_SOURCES.get(args.reciter)!;
  const plan = await planIngest(await verifyArchive(args.archive, basename(args.archive), spec), await listExtracted(args.extracted), spec);
  const summary = summarise(plan);
  if (!args.write) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, ...summary }, null, 2)}\n`);
    process.exitCode = plan.complete && plan.rejected.length === 0 ? 0 : 1;
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new UsageError('DATABASE_URL is not set');
  const target = describeTarget(databaseUrl);
  if (args.target !== target) throw new UsageError(`--target ${args.target ?? '(missing)'} does not match DATABASE_URL (${target})`);
  const appEnv = process.env.APP_ENV ?? '';
  if (!mayWriteHere(appEnv, args.allowNonLocal)) throw new UsageError(`APP_ENV=${appEnv || '(unset)'}; it must be local, test or ci, or pass --allow-non-local`);
  if (!plan.complete) throw new UsageError(`the plan is not complete (archive ${plan.archive.refused ? 'refused' : 'ok'}, folder ${plan.manifest}, ${plan.rejected.length} rejects, ${plan.missing.length} missing): nothing is written`);
  const prisma = cliPrismaClient();
  try {
    const report = await runIngest(
      plan,
      {
        storage: selectObjectStorage().storage,
        upload: async (grant, bytes) => {
          const res = await fetch(grant.uploadUrl, { method: grant.method, headers: grant.headers, body: bytes });
          if (!res.ok) throw new Error(`upload refused: ${res.status}`);
        },
        writer: prismaAudioRowWriter(prisma as unknown as PrismaService),
        readFile: (p) => readFile(p),
      },
      { dryRun: false },
    );
    process.stdout.write(`${JSON.stringify({ target, ...summary, ...report }, null, 2)}\n`);
    process.exitCode = report.failed.length ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    process.stderr.write(`ingest-quran-audio: ${e instanceof UsageError ? 'USAGE: ' : ''}${(e as Error).message}\n`);
    process.exitCode = 2;
  });
}
