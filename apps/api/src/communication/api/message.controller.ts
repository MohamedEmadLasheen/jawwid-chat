import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { MessageService } from '../messages/message.service';
import { AttachmentService } from '../attachments/attachment.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { ReceiptState } from '../contracts/vocab';
import { RateLimited } from '../../platform/auth/action-throttle.guard';
import { ActionScope } from '../../platform/auth/throttle.service';

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
   * Search inside ONE conversation.
   *
   * Declared before the `:messageId` routes below, because Nest matches in
   * declaration order and `search` would otherwise be read as a message id.
   */
  @Get('search')
  async search(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Query('q') q = '',
    @Query('authorId') authorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.messages.search({
      actorId,
      query: q,
      conversationId,
      authorId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('unread')
  async unread(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return { unread: await this.messages.unreadCount(conversationId, actorId) };
  }

  /**
   * Send. Always pass clientMessageId: retrying with the same value returns the
   * original message instead of creating a duplicate.
   *
   * Every field is mapped explicitly. In particular there is no path from the
   * request body to `forwardedFrom`, `origin`, `seq` or the author: a client
   * that sends them is sending fields no code reads.
   */
  @RateLimited(ActionScope.MESSAGE_SEND)
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
    // Attachment checks are NOT duplicated here. They moved into
    // MessageService.send, which is the path every caller takes -- and a
    // controller-level copy of a security rule is a second definition to keep
    // in step with the first.
    return this.messages.send({
      conversationId,
      senderId: actorId,
      type: body.type,
      body: body.body,
      visibility: body.visibility,
      clientMessageId: body.clientMessageId,
      replyToMessageId: body.replyToMessageId,
      requestedMode: body.requestedMode,
      attachments: body.attachments,
    });
  }

  /** Authorizes an upload before any object key exists. */
  @RateLimited(ActionScope.ATTACHMENT_UPLOAD)
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

  @Post(':messageId/delivered')
  async delivered(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    const updated = await this.messages.markState([messageId], actorId, ReceiptState.DELIVERED);
    return { updated };
  }

  /**
   * Edit. Author only, inside communication.edit_window_minutes.
   *
   * PATCH rather than PUT: the request replaces one field of an existing
   * message, and the message's identity, order and send time are not the
   * caller's to supply.
   */
  @Patch(':messageId')
  async edit(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: { body?: string },
  ) {
    return this.messages.edit({
      messageId,
      actorId,
      conversationId,
      body: String(body?.body ?? ''),
    });
  }

  /** The edit history. Requires messages.moderate, not merely membership. */
  @Get(':messageId/revisions')
  async revisions(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    return { revisions: await this.messages.revisions(messageId, actorId, conversationId) };
  }

  /**
   * Forward into other conversations.
   *
   * The source is this route's conversation and the destinations are in the
   * body; each is authorized on its own, and the destinations go through the
   * ordinary send path so forwarding can never reach somewhere a message could
   * not.
   */
  @Post(':messageId/forward')
  async forward(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: { toConversationIds?: string[]; clientMessageIds?: Record<string, string> },
  ) {
    const messages = await this.messages.forward({
      messageId,
      actorId,
      conversationId,
      toConversationIds: body?.toConversationIds ?? [],
      clientMessageIds: body?.clientMessageIds,
    });
    return { messages };
  }

  @Post(':messageId/reactions')
  async react(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string },
  ) {
    await this.messages.react(messageId, actorId, String(body?.emoji ?? ''), conversationId);
    return { ok: true };
  }

  @Delete(':messageId/reactions')
  async unreact(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.messages.unreact(messageId, actorId, conversationId);
    return { ok: true };
  }

  /** Delete for me. The message stays intact for everyone else. */
  @Delete(':messageId/me')
  async deleteForMe(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.messages.deleteForMe(messageId, actorId, conversationId);
    return { ok: true };
  }

  /** Undo a "delete for me". Nothing was destroyed, so nothing is recreated. */
  @Post(':messageId/me/restore')
  async restoreForMe(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.messages.restoreForMe(messageId, actorId, conversationId);
    return { ok: true };
  }

  /** Delete for everyone. Author within the window, or messages.delete. */
  @Delete(':messageId')
  async deleteForEveryone(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Query('reason') reason = 'deleted by author',
  ) {
    await this.messages.deleteForEveryone(messageId, actorId, reason, conversationId);
    return { ok: true };
  }
}

/**
 * Search across every conversation this actor may read.
 *
 * A separate controller because it is not scoped to one conversation. The
 * scoping that matters is not in the path anyway -- it is in the query, built
 * from the same predicate the chat list is built from, so a message outside
 * this actor's scope is never a candidate row rather than a filtered one.
 */
@Controller('search')
@UseFilters(CommErrorFilter)
export class SearchController {
  constructor(private readonly messages: MessageService) {}

  @Get('messages')
  async messagesSearch(
    @ActorId() actorId: string,
    @Query('q') q = '',
    @Query('conversationId') conversationId?: string,
    @Query('authorId') authorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.messages.search({
      actorId,
      query: q,
      conversationId,
      authorId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }
}
