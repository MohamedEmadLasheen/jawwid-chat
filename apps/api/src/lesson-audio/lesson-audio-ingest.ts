import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ObjectStorage, UploadAuthorization } from '../communication/attachments/object-storage';
import type { PrismaService } from '../platform/prisma.service';
import { LESSON_KEY, SHA256, STRING_ID, lessonAudioKey } from './lesson-audio-key';
import { lessonText } from './lesson-texts';
import { parseRecipe, renderSha256, type RenderRecipe } from './recipe';
import { VOICE_SOURCES, lessonVoice } from './voice-sources';

/**
 * PD-48: the ONE way a clip row is written (design §6 step 3). For each clip
 * of the operator's generation manifest:
 *   - its string must be in the lesson's approved text AS THE API WAS BUILT,
 *     with exactly that text (a clip for stale or held text is refused);
 *   - its recipe must parse, hash to the manifest's render_sha256, and name a
 *     voice listed in voice-sources.ts;
 *   - the file must still hash to the manifest's value;
 *   - it is uploaded to a temporary key, and what storage holds THERE is
 *     hashed before it reaches its own (content-addressed) key, which is
 *     hashed again: that hash, never the manifest's, is audio_sha256;
 *   - the row goes in through the ingest-only path (chat.ingesting_lesson_audio).
 * A clip is never replaced: the same (text, recipe) twice is refused, and a
 * regeneration is a new recipe (a lexicon fix, another take).
 * Writing a clip does not let anyone hear it: two reviewers approve it first.
 */
export const MAX_CLIP_BYTES = 5_000_000;

export interface ManifestClip {
  stringId: string;
  text: string;
  recipe: RenderRecipe;
  renderSha256: string;
  file: string;
  sha256: string;
}

export interface GenerationManifest {
  lesson: string;
  clips: ManifestClip[];
}

export interface ClipRowWriter {
  exists(organizationId: string, lesson: string, stringId: string, textSha256: string, renderSha256: string): Promise<boolean>;
  /** How many clips of this string's text exist already (the next attempt is one more). */
  count(organizationId: string, lesson: string, stringId: string, textSha256: string): Promise<number>;
  insert(row: {
    organizationId: string;
    lesson: string;
    stringId: string;
    text: string;
    recipe: RenderRecipe;
    renderSha256: string;
    audioSha256: string;
    byteSize: number;
    attempt: number;
  }): Promise<void>;
}

export interface LessonIngestDeps {
  storage: Pick<ObjectStorage, 'authorizeUpload' | 'copy' | 'delete' | 'read'>;
  upload(grant: UploadAuthorization, bytes: Buffer): Promise<void>;
  writer: ClipRowWriter;
  readFile(path: string): Promise<Buffer>;
}

export interface LessonIngestReport {
  dryRun: boolean;
  lesson: string;
  accepted: number;
  written: number;
  refused: Array<{ stringId: string; reason: string }>;
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** The manifest, if it is one; otherwise the reason. Nothing else in it is trusted later. */
export function parseManifest(raw: unknown): GenerationManifest | string {
  const m = raw as { lesson?: unknown; clips?: unknown } | null;
  if (!m || typeof m !== 'object' || typeof m.lesson !== 'string' || !LESSON_KEY.test(m.lesson) || !Array.isArray(m.clips)) return 'not a generation manifest';
  if (m.clips.length > 5000) return 'too many clips in one manifest';
  for (const c of m.clips as Array<Record<string, unknown>>) {
    if (!c || typeof c.stringId !== 'string' || !STRING_ID.test(c.stringId)) return 'a clip without a string id';
    if (typeof c.text !== 'string' || typeof c.renderSha256 !== 'string' || !SHA256.test(c.renderSha256)) return `${c.stringId}: text or renderSha256`;
    if (typeof c.sha256 !== 'string' || !SHA256.test(c.sha256)) return `${c.stringId}: sha256`;
    // A bare file name in the manifest's folder: never a path.
    if (typeof c.file !== 'string' || !/^[a-z0-9_.-]{1,120}\.mp3$/.test(c.file) || c.file.includes('..')) return `${c.stringId}: file`;
  }
  return m as GenerationManifest;
}

/** What may be ingested, and why the rest may not -- without touching storage or the database. */
export function planLessonIngest(
  manifest: GenerationManifest,
  pin: (lesson: string) => string | null = lessonVoice,
): { accepted: ManifestClip[]; refused: LessonIngestReport['refused'] } {
  const text = lessonText(manifest.lesson);
  const voice = pin(manifest.lesson);
  const accepted: ManifestClip[] = [];
  const refused: LessonIngestReport['refused'] = [];
  const seen = new Set<string>();
  for (const c of manifest.clips) {
    const refuse = (reason: string) => refused.push({ stringId: c.stringId, reason });
    const s = text?.strings.get(c.stringId);
    if (!text) refuse(`no lesson ${manifest.lesson} with voice-over in this build`);
    else if (!s) refuse('not an approved string of this lesson (held, unknown, or the API is older than the lesson)');
    else if (c.text !== s.text || sha(c.text) !== s.sha256) refuse('generated for other text than the lesson\'s: regenerate');
    else {
      const recipe = parseRecipe(c.recipe);
      if (typeof recipe === 'string') refuse(`recipe: ${recipe}`);
      else if (renderSha256(recipe) !== c.renderSha256) refuse('the recipe does not hash to renderSha256');
      else if (!VOICE_SOURCES.has(`${recipe.vendor}:${recipe.voice}`)) refuse(`${recipe.vendor}:${recipe.voice} is not a voice in voice-sources.ts`);
      // One voice per lesson (owner Q5): once the pilot pinned it, no other voice goes in.
      else if (voice !== null && `${recipe.vendor}:${recipe.voice}` !== voice) refuse(`${manifest.lesson} is voiced by ${voice} only (lesson-voices.json)`);
      else if (seen.has(`${c.stringId}:${c.renderSha256}`)) refuse('listed twice');
      else {
        seen.add(`${c.stringId}:${c.renderSha256}`);
        accepted.push({ ...c, recipe });
      }
    }
  }
  return { accepted, refused };
}

async function bytesOf(storage: LessonIngestDeps['storage'], key: string): Promise<Buffer | null> {
  const o = await storage.read(key);
  if (!o || o === 'unsatisfiable') return null;
  if (Buffer.isBuffer(o.body)) return o.body;
  const chunks: Buffer[] = [];
  for await (const c of o.body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

export async function runLessonIngest(
  manifest: GenerationManifest,
  folder: string,
  deps: LessonIngestDeps,
  opts: { dryRun: boolean; organizationId: string; pin?: (lesson: string) => string | null },
): Promise<LessonIngestReport> {
  const { accepted, refused } = planLessonIngest(manifest, opts.pin);
  const org = opts.organizationId;
  const report: LessonIngestReport = { dryRun: opts.dryRun, lesson: manifest.lesson, accepted: accepted.length, written: 0, refused };
  if (opts.dryRun) return report;
  const copy = deps.storage.copy?.bind(deps.storage);
  if (!copy) throw new Error('this storage cannot place an object under an exact key (no copy)');
  for (const c of accepted) {
    const textSha256 = sha(c.text);
    let temp: string | null = null;
    try {
      if (await deps.writer.exists(org, manifest.lesson, c.stringId, textSha256, c.renderSha256)) throw new Error('already ingested: a clip is never replaced (regenerate with a new recipe)');
      const bytes = await deps.readFile(join(folder, c.file));
      if (bytes.length === 0 || bytes.length > MAX_CLIP_BYTES) throw new Error(`the file is empty or larger than ${MAX_CLIP_BYTES} bytes`);
      if (sha(bytes) !== c.sha256) throw new Error('the file changed since it was generated');
      const grant = await deps.storage.authorizeUpload({ prefix: `lesson-audio-incoming/${manifest.lesson}`, mimeType: 'audio/mpeg', byteSize: bytes.length });
      temp = grant.objectKey;
      await deps.upload(grant, bytes);
      const uploaded = await bytesOf(deps.storage, temp);
      if (!uploaded || sha(uploaded) !== c.sha256) throw new Error('what storage holds differs from the file: not placed');
      const key = lessonAudioKey(manifest.lesson, c.stringId, c.sha256);
      if (!(await copy(temp, key))) throw new Error('the upload is not in storage');
      // The row's hash is what the clip's OWN key holds, read back now.
      const placed = await bytesOf(deps.storage, key);
      if (!placed || sha(placed) !== c.sha256) throw new Error(`${key} does not hold the generated bytes`);
      const attempt = (await deps.writer.count(org, manifest.lesson, c.stringId, textSha256)) + 1;
      await deps.writer.insert({
        organizationId: org,
        lesson: manifest.lesson,
        stringId: c.stringId,
        text: c.text,
        recipe: c.recipe,
        renderSha256: c.renderSha256,
        audioSha256: sha(placed),
        byteSize: placed.length,
        attempt,
      });
      report.written++;
    } catch (e) {
      report.refused.push({ stringId: c.stringId, reason: (e as Error).message });
    } finally {
      if (temp) await deps.storage.delete(temp).catch(() => undefined);
    }
  }
  return report;
}

/** The database side: one row, through the ingest-only path. */
export function prismaClipRowWriter(prisma: PrismaService): ClipRowWriter {
  return {
    async exists(org, lesson, stringId, textSha256, renderSha256) {
      const rows = await prisma.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM chat.lesson_audio_clip
         WHERE organization_id = ${org}::uuid AND lesson_key = ${lesson} AND string_id = ${stringId} AND text_sha256 = ${textSha256} AND render_sha256 = ${renderSha256}`;
      return rows.length > 0;
    },
    async count(org, lesson, stringId, textSha256) {
      const rows = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM chat.lesson_audio_clip WHERE organization_id = ${org}::uuid AND lesson_key = ${lesson} AND string_id = ${stringId} AND text_sha256 = ${textSha256}`;
      return rows[0]?.n ?? 0;
    },
    async insert(row) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('chat.ingesting_lesson_audio', 'on', true)`;
        await tx.$executeRaw`
          INSERT INTO chat.lesson_audio_clip (organization_id, lesson_key, string_id, text, render, render_sha256, vendor, voice, audio_sha256, byte_size, attempt)
          VALUES (${row.organizationId}::uuid, ${row.lesson}, ${row.stringId}, ${row.text}, ${JSON.stringify(row.recipe)}::jsonb, ${row.renderSha256},
                  ${row.recipe.vendor}, ${row.recipe.voice}, ${row.audioSha256}, ${row.byteSize}, ${row.attempt})`;
      });
    },
  };
}
