import { Body, Controller, Delete, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { MessageService } from '../messages/message.service';
import { AttachmentService } from '../attachments/attachment.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { ReceiptState } from '../contracts/vocab';

@Controller('conversations/:conversationId/messages')
@UseFilters(CommErrorFilter)
export class MessageController {
  constructor(
    private readonly messages: MessageService,
    private readonly attachments: AttachmentService,
  ) {}

  /**
   * Paginate by seq, not by timestamp.
   * `before` walks backwards through history; `after` catches up after a
   * reconnect. Both are deterministic regardless of device clocks.
   */
  @Get()
  async list(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list({
      conversationId,
      actorId,
      before,
      after,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Send. Always pass clientMessageId: retrying with the same value returns the
   * original message instead of creating a duplicate.
   */
  @Post()
  async send(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Body()
    body: {
      type?: string;
      body?: string;
      visibility?: string;
      clientMessageId?: string;
      replyToMessageId?: string;
      caseId?: string;
      requestedMode?: string;
      attachments?: Array<{
        kind: string;
        objectKey: string;
        mimeType: string;
        byteSize: number;
        checksumSha256?: string;
        originalName?: string;
        durationMs?: number;
        width?: number;
        height?: number;
        thumbnailObjectKey?: string;
      }>;
    },
  ) {
    for (const a of body.attachments ?? []) {
      this.attachments.validate(a.kind, a.mimeType, a.byteSize);
    }
    return this.messages.send({
      conversationId,
      senderId: actorId,
      type: body.type,
      body: body.body,
      visibility: body.visibility,
      clientMessageId: body.clientMessageId,
      replyToMessageId: body.replyToMessageId,
      caseId: body.caseId,
      requestedMode: body.requestedMode,
      attachments: body.attachments,
    });
  }

  /** Authorizes an upload before any object key exists. */
  @Post('attachments/authorize')
  async authorizeUpload(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: { kind: string; mimeType: string; byteSize: number },
  ) {
    return this.attachments.authorizeUpload({
      conversationId,
      actorId,
      kind: body.kind,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
    });
  }

  @Post('read')
  async markRead(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: { upToSeq: string },
  ) {
    await this.messages.markReadUpTo(conversationId, actorId, body.upToSeq);
    return { ok: true };
  }

  @Get('unread')
  async unread(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return { unread: await this.messages.unreadCount(conversationId, actorId) };
  }

  @Post(':messageId/delivered')
  async delivered(@ActorId() actorId: string, @Param('messageId') messageId: string) {
    const updated = await this.messages.markState([messageId], actorId, ReceiptState.DELIVERED);
    return { updated };
  }

  @Post(':messageId/reactions')
  async react(
    @ActorId() actorId: string,
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string },
  ) {
    await this.messages.react(messageId, actorId, body.emoji);
    return { ok: true };
  }

  @Delete(':messageId/reactions')
  async unreact(@ActorId() actorId: string, @Param('messageId') messageId: string) {
    await this.messages.unreact(messageId, actorId);
    return { ok: true };
  }

  /** Delete for me. The message stays intact for everyone else. */
  @Delete(':messageId/me')
  async deleteForMe(@ActorId() actorId: string, @Param('messageId') messageId: string) {
    await this.messages.deleteForMe(messageId, actorId);
    return { ok: true };
  }

  /** Delete for everyone. Author within the window, or a manager. */
  @Delete(':messageId')
  async deleteForEveryone(
    @ActorId() actorId: string,
    @Param('messageId') messageId: string,
    @Query('reason') reason = 'deleted by author',
  ) {
    await this.messages.deleteForEveryone(messageId, actorId, reason);
    return { ok: true };
  }
}
