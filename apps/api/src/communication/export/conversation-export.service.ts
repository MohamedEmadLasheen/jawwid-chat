import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { Actor } from '../../platform/types';
import { ZipWriter, type ZipSink } from '../../platform/zip-writer';
import { ActorKind, StaffRole, Visibility } from '../contracts/vocab';
import type { MessageAttachment } from '@prisma/client';
import type { MessageDto, MessageWithRelations } from '../contracts/dto';
import type { ObjectStorage } from '../attachments/object-storage';
import { ConversationService } from '../conversations/conversation.service';
import { MessageService } from '../messages/message.service';

/** What the route needs before it sends a single byte. */
export interface PreparedExport {
  fileName: string;
  /** Writes the archive; the export is already authorized and audited. */
  write(sink: ZipSink): Promise<void>;
}

interface Item {
  row: MessageWithRelations;
  dto: MessageDto;
}

const attachmentsOf = (row: MessageWithRelations): MessageAttachment[] => row.attachments ?? [];

/**
 * Export a chat (owner decisions 2026-10-20): the SUPER ADMIN only, every
 * export written to the audit log, as a .zip holding a WhatsApp-style
 * transcript (`chat.txt`) and the chat's media (`media/`).
 *
 * An export copies parents' and children's messages and photos out of the
 * system, which is why it is one role's act and always logged. What it
 * contains is exactly what the super admin can read in the chat -- the same
 * per-message rule as the message list (`MessageService.exportBatches`) --
 * including internal staff notes, marked as such. A message deleted for
 * everyone appears as deleted and its media are NOT exported.
 */
@Injectable()
export class ConversationExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async prepare(actorId: string, conversationId: string): Promise<PreparedExport> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || actor.staffRole !== StaffRole.SUPER_ADMIN || !actor.isActive) {
      throw new CommError(CommErrorCode.CONVERSATION_EXPORT_DENIED, 'exporting a chat is for the super admin', 403);
    }
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = await this.conversations.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const items: Item[] = [];
    for await (const batch of this.messages.exportBatches(actor, conv.id)) items.push(...batch);
    const media = items.flatMap(({ row }) => (row.deletedForAll ? [] : attachmentsOf(row)));
    const now = new Date();
    const zone = String(await this.config.get('stats.zone'));

    // Logged BEFORE a byte leaves: an interrupted download is still an export.
    await this.prisma.$transaction(async (tx) => {
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'conversation.exported',
        entity: 'conversation',
        entityId: conv.id,
        after: {
          messages: items.length,
          mediaFiles: media.length,
          mediaBytes: media.reduce((n, a) => n + a.byteSize, 0),
          internalNotes: items.filter(({ row }) => row.visibility === Visibility.INTERNAL).length,
        },
        reason: 'chat exported by the super admin (transcript + media)',
      });
    });

    const names = [...new Set(items.map(({ dto }) => dto.authorDisplayName).filter((n): n is string => !!n))];
    const title = conv.title?.trim() || names.slice(0, 4).join(' · ') || 'Chat';
    return {
      fileName: `jawwid-chat-${localStamp(now, zone).slice(0, 10)}-${conv.id.slice(0, 8)}.zip`,
      write: (sink) => this.writeArchive(sink, { title, type: conv.type, items, zone, now, actor }),
    };
  }

  private async writeArchive(
    sink: ZipSink,
    x: { title: string; type: string; items: Item[]; zone: string; now: Date; actor: Actor },
  ): Promise<void> {
    const zip = new ZipWriter(sink);
    const lines: string[] = [];
    let n = 0;
    let mediaFiles = 0;

    for (const { row, dto } of x.items) {
      const stamp = `[${localStamp(row.createdAt, x.zone)}]`;
      const who = dto.authorDisplayName || roleName(dto.authorKind);
      if (row.type === 'system') {
        lines.push(`${stamp} -- ${systemText(row.body)} --`);
        continue;
      }
      if (row.deletedForAll) {
        lines.push(`${stamp} ${who}: This message was deleted.`);
        continue;
      }
      const marks = [
        row.visibility === Visibility.INTERNAL ? '(internal staff note)' : '',
        row.forwarded ? '(forwarded)' : '',
        row.moderation === 'pending' ? '(awaiting approval)' : row.moderation === 'rejected' ? '(rejected)' : '',
        row.card ? `(card: ${row.card.kind})` : '',
      ].filter(Boolean);
      const text = [...marks, row.body ?? ''].filter(Boolean).join(' ');
      if (text || attachmentsOf(row).length === 0) lines.push(`${stamp} ${who}: ${text}`);

      for (const a of attachmentsOf(row)) {
        n += 1;
        const name = `media/${String(n).padStart(4, '0')}-${fileNameFor(a.originalName, a.kind, a.mimeType)}`;
        const label = `${stamp} ${who}:`;
        if (!zip.fits(name, a.byteSize) || !zip.fits('chat.txt', 4 * 1024 * 1024)) {
          lines.push(`${label} <not included, the archive is full: ${name}>`);
          continue;
        }
        const bytes = await this.readAll(a.objectKey);
        if (!bytes) {
          lines.push(`${label} <file missing: ${name}>`);
          continue;
        }
        await zip.add(name, bytes, row.createdAt);
        mediaFiles += 1;
        lines.push(`${label} <attached: ${name}>`);
      }
    }

    const header = [
      'Jawwid -- chat export',
      `Chat: ${x.title}`,
      `Kind: ${x.type}`,
      `Exported: ${localStamp(x.now, x.zone)} (${x.zone})`,
      `Messages: ${x.items.length}, media files: ${mediaFiles}`,
      `Times are in ${x.zone}.`,
      'Includes internal staff notes. Confidential: contains family and children\'s data.',
      '',
    ];
    // A BOM so every text editor opens the Arabic as UTF-8.
    const transcript = Buffer.from(`${String.fromCharCode(0xfeff)}${[...header, ...lines].join('\n')}\n`, 'utf8');
    await zip.add('chat.txt', transcript, x.now);
    await zip.finish();
  }

  private async readAll(objectKey: string): Promise<Buffer | null> {
    const stored = await this.storage.read(objectKey).catch(() => null);
    if (!stored || stored === 'unsatisfiable') return null;
    if (Buffer.isBuffer(stored.body)) return stored.body;
    const parts: Buffer[] = [];
    for await (const chunk of stored.body) parts.push(Buffer.from(chunk));
    return Buffer.concat(parts);
  }
}

/** "2026-10-19 14:03" in the academy's zone. */
function localStamp(d: Date, zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function roleName(kind: string): string {
  return kind === 'staff' ? 'Jawwid' : kind === 'teacher' ? 'Teacher' : kind === 'contact' ? 'Parent' : 'Jawwid';
}

/** A system message's body is `{ kind, ... }`: name the event, never dump the JSON. */
function systemText(body: string | null): string {
  try {
    const kind = (JSON.parse(body ?? '{}') as { kind?: unknown }).kind;
    return typeof kind === 'string' ? kind.replace(/[_.]/g, ' ') : 'system event';
  } catch {
    return 'system event';
  }
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
};

/** A safe file name: the original one when there is one, otherwise kind + extension. */
export function fileNameFor(original: string | null, kind: string, mimeType: string): string {
  // Path separators, reserved characters and control characters out; no dot-only names.
  // eslint-disable-next-line no-control-regex
  const cleaned = (original ?? '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '').trim();
  if (cleaned) return [...cleaned].slice(-80).join('');
  return `${kind}.${EXT[mimeType.split(';')[0]!.trim().toLowerCase()] ?? 'bin'}`;
}
