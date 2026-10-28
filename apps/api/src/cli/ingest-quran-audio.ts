import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import type { PrismaService } from '../platform/prisma.service';
import { planIngest, type IngestPlan } from '../quran/audio-archive';
import { prismaAudioRowWriter } from '../quran/audio-ingest';
import { runIngest } from '../quran/audio-ingest-run';
import { AUDIO_SOURCES } from '../quran/audio-sources';
import { describeTarget } from './bootstrap-super-admin';

/**
 * `node dist/cli/ingest-quran-audio.js` -- ingest a recitation's per-ayah audio.
 *
 *   --archive <path>        an official archive (repeatable); its file name and
 *                           SHA-256 must be listed in quran/audio-sources.ts
 *   --reciter <code>        default kfgqpc-hudhaify
 *   (default)               DRY RUN: plan and report; nothing is stored or written
 *   --write                 store the files and write the rows (via ingestAyahAudio)
 *   --target <host:port/db> REQUIRED with --write; must name DATABASE_URL's target
 *   --allow-partial         with --write: proceed although some of the 6,236 ayat are missing
 *   --allow-non-local       with --write: required when APP_ENV is not local/test/ci
 *
 * Writing audio does not serve it: the release gate (quran/audio-gate.ts)
 * decides who hears it, and no student does until the licence is recorded.
 */
const LOCAL_ENVS = new Set(['local', 'test', 'ci', '']);

export interface IngestArgs {
  archives: string[];
  reciter: string;
  write: boolean;
  target?: string;
  allowPartial: boolean;
  allowNonLocal: boolean;
}

export class UsageError extends Error {}

export function parseIngestArgs(argv: string[]): IngestArgs {
  const args: IngestArgs = { archives: [], reciter: 'kfgqpc-hudhaify', write: false, allowPartial: false, allowNonLocal: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--archive': args.archives.push(value()); break;
      case '--reciter': args.reciter = value(); break;
      case '--dry-run': args.write = false; break;
      case '--write': args.write = true; break;
      case '--target': args.target = value(); break;
      case '--allow-partial': args.allowPartial = true; break;
      case '--allow-non-local': args.allowNonLocal = true; break;
      default: throw new UsageError(`unknown option ${flag}`);
    }
  }
  if (args.archives.length === 0) throw new UsageError('give at least one --archive');
  if (!AUDIO_SOURCES.has(args.reciter)) throw new UsageError(`${args.reciter} is not a reciter in quran/audio-sources.ts`);
  return args;
}

/** What the operator reads: never the audio, never a credential. */
export function summarise(plan: IngestPlan) {
  return {
    reciter: plan.reciter,
    archives: plan.archives,
    accepted: plan.accepted.length,
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
  const plan = planIngest(args.archives.map((p) => ({ name: basename(p), bytes: readFileSync(p) })), spec);
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
  const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
  if (!LOCAL_ENVS.has(appEnv) && !args.allowNonLocal) throw new UsageError(`APP_ENV=${appEnv}; pass --allow-non-local to write outside a local environment`);
  if (!plan.complete && !args.allowPartial) throw new UsageError(`${plan.missing.length} ayat are missing or an archive was refused; pass --allow-partial to write the rest`);
  const prisma = new PrismaClient();
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
