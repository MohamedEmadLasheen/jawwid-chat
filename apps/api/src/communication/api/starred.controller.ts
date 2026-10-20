import { Controller, Get, Query } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { MessageService } from '../messages/message.service';

/**
 * The caller's own views across their chats: "Starred messages" (their
 * bookmarks, in conversations they may still read) and message search.
 */
@Controller('me')
export class StarredController {
  constructor(private readonly messages: MessageService) {}

  @Get('starred')
  starred(@ActorId() actorId: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.messages.starred(actorId, { before, limit: limit ? Number(limit) : undefined });
  }

  /** Search message text across every chat in the caller's list (newest first). */
  @Get('search')
  search(@ActorId() actorId: string, @Query('q') q?: string) {
    return this.messages.searchAll({ actorId, q });
  }
}
