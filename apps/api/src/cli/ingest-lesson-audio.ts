import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import type { PrismaService } from '../platform/prisma.service';
import { LESSON_KEY } from '../lesson-audio/lesson-audio-key';
import { parseManifest, planLessonIngest, prismaClipRowWriter, runLessonIngest } from '../lesson-audio/lesson-audio-ingest';
import { describeTarget } from './bootstrap-super-admin';

/**
 * `node dist/cli/ingest-lesson-audio.js` -- PD-48: put generated voice-over
 * clips in storage, each as a PENDING clip that two reviewers must approve.
 *
 *   --manifest <path>       the manifest.json scripts/lessons/tts/generate.py wrote;
 *                           the clips are the files beside it
 *   (default)               DRY RUN: which clips would be accepted and why the rest
 *                           would not; nothing is stored or written
 *   --write                 store the clips and write the rows
 *   --target <host:port/db> REQUIRED with --write or --export; must name DATABASE_URL's target
 *   --allow-non-local       with --write: required unless APP_ENV is EXPLICITLY local, test or ci
 *   --export <lesson>       print the lesson's clips and decisions (states, hashes; no
 *                           text, no URLs) for scripts/lessons/tts/plan.py. Read-only.
 *
 * It never calls a TTS vendor and holds no vendor key: generation is the
 * operator's script, on the operator's machine.
 */
export class UsageError extends Error {}

const LOCAL_ENVS = new Set(['local', 'test', 'ci']);

/** Writing is local-only unless asked; an unset APP_ENV is NOT local (as for the Quran audio ingest, kept separate on purpose). */
export function mayWriteHere(appEnv: string, allowNonLocal: boolean): boolean {
  return allowNonLocal || LOCAL_ENVS.has(appEnv.trim().toLowerCase());
}

export interface LessonIngestArgs {
  manifest: string;
  write: boolean;
  exportLesson?: string;
  target?: string;
  allowNonLocal: boolean;
}

export function parseLessonIngestArgs(argv: string[]): LessonIngestArgs {
  const args: LessonIngestArgs = { manifest: '', write: false, allowNonLocal: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--manifest': args.manifest = value(); break;
      case '--dry-run': args.write = false; break;
      case '--write': args.write = true; break;
      case '--export': args.exportLesson = value(); break;
      case '--target': args.target = value(); break;
      case '--allow-non-local': args.allowNonLocal = true; break;
      default: throw new UsageError(`unknown option ${flag}`);
    }
  }
  if (args.exportLesson !== undefined) {
    if (!LESSON_KEY.test(args.exportLesson)) throw new UsageError('--export needs a lesson key such as arabic-001');
    if (args.manifest || args.write) throw new UsageError('--export reads only: give no --manifest or --write');
    return args;
  }
  if (!args.manifest) throw new UsageError('give the --manifest');
  return args;
}

function checkedTarget(target: string | undefined): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new UsageError('DATABASE_URL is not set');
  const actual = describeTarget(databaseUrl);
  if (target !== actual) throw new UsageError(`--target ${target ?? '(missing)'} does not match DATABASE_URL (${actual})`);
  return actual;
}

async function exportLesson(lesson: string, target: string): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const clips = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT c.string_id AS "stringId", c.text_sha256 AS "textSha256", c.render_sha256 AS "renderSha256",
             c.attempt::int AS attempt, chat.lesson_audio_clip_state(c.id) AS state
        FROM chat.lesson_audio_clip c WHERE c.lesson_key = ${lesson} ORDER BY c.string_id, c.created_at`;
    const decisions = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT string_id AS "stringId", text_sha256 AS "textSha256", decision
        FROM chat.lesson_audio_string_decision WHERE lesson_key = ${lesson} ORDER BY at`;
    process.stdout.write(`${JSON.stringify({ target, lesson, clips, decisions }, null, 1)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const args = parseLessonIngestArgs(process.argv.slice(2));
  if (args.exportLesson) {
    await exportLesson(args.exportLesson, checkedTarget(args.target));
    return;
  }
  const manifest = parseManifest(JSON.parse(await readFile(args.manifest, 'utf8')));
  if (typeof manifest === 'string') throw new UsageError(manifest);
  if (!args.write) {
    const { accepted, refused } = planLessonIngest(manifest);
    process.stdout.write(`${JSON.stringify({ dryRun: true, lesson: manifest.lesson, accepted: accepted.length, refused }, null, 2)}\n`);
    process.exitCode = refused.length ? 1 : 0;
    return;
  }
  const target = checkedTarget(args.target);
  const appEnv = process.env.APP_ENV ?? '';
  if (!mayWriteHere(appEnv, args.allowNonLocal)) throw new UsageError(`APP_ENV=${appEnv || '(unset)'}; it must be local, test or ci, or pass --allow-non-local`);
  const prisma = new PrismaClient();
  try {
    const report = await runLessonIngest(
      manifest,
      dirname(args.manifest),
      {
        storage: selectObjectStorage().storage,
        upload: async (grant, bytes) => {
          const res = await fetch(grant.uploadUrl, { method: grant.method, headers: grant.headers, body: bytes });
          if (!res.ok) throw new Error(`upload refused: ${res.status}`);
        },
        writer: prismaClipRowWriter(prisma as unknown as PrismaService),
        readFile: (p) => readFile(p),
      },
      { dryRun: false },
    );
    process.stdout.write(`${JSON.stringify({ target, ...report }, null, 2)}\n`);
    process.exitCode = report.refused.length ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    process.stderr.write(`ingest-lesson-audio: ${e instanceof UsageError ? 'USAGE: ' : ''}${(e as Error).message}\n`);
    process.exitCode = 2;
  });
}
