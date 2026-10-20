import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { OBJECT_STORAGE } from '../../platform/tokens';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AVATAR_HEAD_BYTES, isAvatarMime, inspectImage } from '../../staff-profile/image-inspection';
import { assertSafeObjectKey } from '../attachments/object-key';
import type { ObjectStorage, UploadAuthorization } from '../attachments/object-storage';
import { ConversationService } from '../conversations/conversation.service';
import type { Actor } from '../../platform/types';
import { signWallpaper } from './wallpaper-urls';

/** The eight background presets; null is the default look. Mirrored by the CHECK in 20261020150000. */
export const CHAT_THEMES = ['lagoon', 'sand', 'rose', 'sky', 'lilac', 'olive', 'slate', 'dusk'] as const;
export type ChatTheme = (typeof CHAT_THEMES)[number];

export const MAX_WALLPAPER_BYTES = 4 * 1024 * 1024;
export const MIN_WALLPAPER_DIMENSION = 200;
export const MAX_WALLPAPER_DIMENSION = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (message: string) => new CommError(CommErrorCode.CHAT_THEME_INVALID, message, 400);
const refused = (problem: WallpaperProblem) => new CommError(problem.code, problem.message, 400);

/** Why a wallpaper photo was refused: a code per reason, an English message for logs. */
export interface WallpaperProblem {
  code: CommErrorCode;
  message: string;
}
const absent = () => new CommError(CommErrorCode.CHAT_WALLPAPER_NOT_FOUND, 'not available', 404);

export function isChatTheme(value: unknown): value is ChatTheme {
  return typeof value === 'string' && (CHAT_THEMES as readonly string[]).includes(value);
}

/** `wallpapers/<actorId>/<conversationId>` -- the only prefix a viewer may upload under for a chat. */
export function wallpaperPrefixFor(actorId: string, conversationId: string): string {
  return `wallpapers/${actorId}/${conversationId}`;
}

/** Structural, never `startsWith`: exactly this viewer's and this chat's key shape. */
export function isWallpaperKeyOf(actorId: string, conversationId: string, objectKey: string): boolean {
  try {
    assertSafeObjectKey(objectKey);
  } catch {
    return false;
  }
  const s = objectKey.split('/');
  return s.length === 4 && s[0] === 'wallpapers' && s[1] === actorId && s[2] === conversationId && UUID.test(s[3]!);
}

/**
 * Chat themes (owner decisions 2026-10-20): PRIVATE to the viewer, presets plus
 * the viewer's own photo, stored on the server so they follow the account.
 *
 * Everything here is keyed by the caller's own (conversation, actor) row of
 * chat.conversation_participant_state, and every write first asks the same
 * read decision as the rest of the chat: one cannot theme a chat one cannot
 * open. A wallpaper is served to its OWNER only (`authorizeWallpaperRead`),
 * and only while they can still read the chat.
 */
@Injectable()
export class ChatThemeService {
  private readonly logger = new Logger(ChatThemeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private async readable(actorId: string, conversationId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = await this.conversations.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    return actor;
  }

  /**
   * Choose a preset, or `null` for the default look. The wallpaper, if any,
   * stays. `theme` must be present: an absent field (a stale or broken client)
   * is refused rather than read as "reset to default" on every device.
   */
  async setTheme(actorId: string, conversationId: string, theme: unknown): Promise<{ theme: ChatTheme | null }> {
    if (theme === undefined) throw invalid('theme is required: one of the presets, or null for the default look');
    if (theme !== null && !isChatTheme(theme)) throw invalid(`theme is one of ${CHAT_THEMES.join(', ')}, or null`);
    const actor = await this.readable(actorId, conversationId);
    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      create: { conversationId, actorId: actor.actorId, theme },
      update: { theme },
    });
    return { theme };
  }

  /**
   * Step 1: a short-lived PUT bound to type and size, under this viewer's own
   * prefix for this chat. The key is recorded as the viewer's ONE pending
   * upload for the chat; a previous pending upload (never committed) is
   * deleted, so uploads that are never committed cannot pile up in storage.
   */
  async authorizeWallpaperUpload(
    actorId: string,
    conversationId: string,
    input: { mimeType?: unknown; byteSize?: unknown },
  ): Promise<UploadAuthorization> {
    const actor = await this.readable(actorId, conversationId);
    if (!isAvatarMime(input.mimeType)) {
      throw refused({ code: CommErrorCode.CHAT_WALLPAPER_TYPE, message: 'a wallpaper must be a JPEG, PNG or WebP image' });
    }
    const byteSize = Number(input.byteSize);
    if (!Number.isInteger(byteSize) || byteSize <= 0) throw invalid('byteSize must be a positive integer');
    if (byteSize > MAX_WALLPAPER_BYTES) {
      throw refused({ code: CommErrorCode.CHAT_WALLPAPER_TOO_LARGE, message: `a wallpaper must be at most ${MAX_WALLPAPER_BYTES} bytes` });
    }
    const grant = await this.storage.authorizeUpload({ prefix: wallpaperPrefixFor(actor.actorId, conversationId), mimeType: input.mimeType, byteSize });
    const replaced = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockRow(tx, conversationId, actor.actorId);
      await tx.conversationParticipantState.update({
        where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
        data: { wallpaperPendingKey: grant.objectKey },
      });
      return row.pending;
    });
    if (replaced && replaced !== grant.objectKey) await this.discard(replaced);
    return grant;
  }

  /**
   * Step 2: make the viewer's pending upload this chat's wallpaper. The key
   * must be exactly the pending one (or the wallpaper already in use, which is
   * a no-op); the stored bytes are judged (real type, still image, sensible
   * size); a refused object is deleted. The row is locked while it changes, so
   * two commits at once are ordered and the replaced wallpaper is always the
   * one deleted -- no object is ever left behind unreferenced.
   */
  async commitWallpaper(actorId: string, conversationId: string, input: { objectKey?: unknown }): Promise<{ wallpaperUrl: string }> {
    const actor = await this.readable(actorId, conversationId);
    const objectKey = typeof input.objectKey === 'string' ? input.objectKey : '';
    if (!isWallpaperKeyOf(actor.actorId, conversationId, objectKey)) throw invalid('that object is not a wallpaper upload for this chat');

    const current = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      select: { wallpaperObjectKey: true, wallpaperPendingKey: true },
    });
    if (current?.wallpaperObjectKey === objectKey) {
      return { wallpaperUrl: signWallpaper(conversationId, actor.actorId, objectKey)! };
    }
    if (current?.wallpaperPendingKey !== objectKey) throw invalid('no pending wallpaper upload matches that key; upload it first');

    // Judged before the row is locked: the read is network I/O.
    const stored = await this.storage.readHead(objectKey, AVATAR_HEAD_BYTES);
    const problem = stored
      ? judgeWallpaper(stored.head, stored.byteSize, stored.contentType)
      : { code: CommErrorCode.CHAT_THEME_INVALID, message: 'no uploaded wallpaper was found for that key; upload it first' };

    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockRow(tx, conversationId, actor.actorId);
      // Another request moved on (a newer upload, or this one already committed).
      if (row.pending !== objectKey) return row.wallpaper === objectKey ? { kind: 'done' as const } : { kind: 'stale' as const };
      if (problem) {
        await tx.conversationParticipantState.update({
          where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
          data: { wallpaperPendingKey: null },
        });
        return { kind: 'refused' as const };
      }
      await tx.conversationParticipantState.update({
        where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
        data: { wallpaperObjectKey: objectKey, wallpaperPendingKey: null },
      });
      return { kind: 'stored' as const, previous: row.wallpaper };
    });

    if (outcome.kind === 'stale') throw invalid('no pending wallpaper upload matches that key; upload it first');
    if (outcome.kind === 'refused') {
      await this.discard(objectKey);
      throw problem!.code === CommErrorCode.CHAT_THEME_INVALID ? invalid(problem!.message) : refused(problem!);
    }
    if (outcome.kind === 'stored' && outcome.previous && outcome.previous !== objectKey) await this.discard(outcome.previous);
    return { wallpaperUrl: signWallpaper(conversationId, actor.actorId, objectKey)! };
  }

  /** The viewer's row for this chat, created if missing, locked for the rest of `tx`. */
  private async lockRow(
    tx: Prisma.TransactionClient,
    conversationId: string,
    actorId: string,
  ): Promise<{ wallpaper: string | null; pending: string | null }> {
    await tx.$executeRaw`
      INSERT INTO chat.conversation_participant_state (conversation_id, actor_id)
      VALUES (${conversationId}::uuid, ${actorId}::uuid)
      ON CONFLICT (conversation_id, actor_id) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ wallpaper: string | null; pending: string | null }>>`
      SELECT wallpaper_object_key AS wallpaper, wallpaper_pending_key AS pending
        FROM chat.conversation_participant_state
       WHERE conversation_id = ${conversationId}::uuid AND actor_id = ${actorId}::uuid
       FOR UPDATE`;
    return rows[0] ?? { wallpaper: null, pending: null };
  }

  async removeWallpaper(actorId: string, conversationId: string): Promise<{ wallpaperUrl: null }> {
    const actor = await this.readable(actorId, conversationId);
    const row = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      select: { wallpaperObjectKey: true },
    });
    if (row?.wallpaperObjectKey) {
      await this.prisma.conversationParticipantState.update({
        where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
        data: { wallpaperObjectKey: null },
      });
      await this.discard(row.wallpaperObjectKey);
    }
    return { wallpaperUrl: null };
  }

  /**
   * RT-037 for wallpapers: the media route calls this on EVERY request after the
   * signature checks out. The signature binds the viewer; the object served is
   * the viewer's OWN row's wallpaper for that chat, and only while they can
   * still read the chat. Every refusal is the same 404.
   */
  async authorizeWallpaperRead(viewerId: string, conversationId: string): Promise<{ objectKey: string }> {
    if (!UUID.test(conversationId)) throw absent();
    try {
      await this.readable(viewerId, conversationId);
    } catch {
      throw absent();
    }
    const row = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_actorId: { conversationId, actorId: viewerId } },
      select: { wallpaperObjectKey: true },
    });
    if (!row?.wallpaperObjectKey || !isWallpaperKeyOf(viewerId, conversationId, row.wallpaperObjectKey)) throw absent();
    return { objectKey: row.wallpaperObjectKey };
  }

  private async discard(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.logger.warn(`could not delete an unreferenced wallpaper object: ${(error as Error).message}`);
    }
  }
}

/** Null when the stored bytes are an acceptable wallpaper; otherwise the reason, as a code and a message. */
export function judgeWallpaper(head: Buffer, byteSize: number, declaredMime: string | null): WallpaperProblem | null {
  const type = (message: string) => ({ code: CommErrorCode.CHAT_WALLPAPER_TYPE, message });
  const dimensions = (message: string) => ({ code: CommErrorCode.CHAT_WALLPAPER_DIMENSIONS, message });
  if (byteSize <= 0 || head.length === 0) return type('the uploaded wallpaper is empty');
  if (byteSize > MAX_WALLPAPER_BYTES) {
    return { code: CommErrorCode.CHAT_WALLPAPER_TOO_LARGE, message: `a wallpaper must be at most ${MAX_WALLPAPER_BYTES} bytes` };
  }
  const image = inspectImage(head);
  if (!image) return type('the uploaded file is not a JPEG, PNG or WebP image');
  if (declaredMime !== image.mime) return type('the uploaded bytes do not match the declared image type');
  if (image.animated) return { code: CommErrorCode.CHAT_WALLPAPER_ANIMATED, message: 'animated images are not accepted as a wallpaper' };
  if (image.width < MIN_WALLPAPER_DIMENSION || image.height < MIN_WALLPAPER_DIMENSION) {
    return dimensions(`a wallpaper must be at least ${MIN_WALLPAPER_DIMENSION} x ${MIN_WALLPAPER_DIMENSION} pixels`);
  }
  if (image.width > MAX_WALLPAPER_DIMENSION || image.height > MAX_WALLPAPER_DIMENSION) {
    return dimensions(`a wallpaper must be at most ${MAX_WALLPAPER_DIMENSION} x ${MAX_WALLPAPER_DIMENSION} pixels`);
  }
  return null;
}
