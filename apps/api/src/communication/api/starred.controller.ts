import { Controller, Get, Query } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { MessageService } from '../messages/message.service';

/** "Starred messages": the caller's own bookmarks, across the conversations they may still read. */
@Controller('me')
export class StarredController {
  constructor(private readonly messages: MessageService) {}

  @Get('starred')
  starred(@ActorId() actorId: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.messages.starred(actorId, { before, limit: limit ? Number(limit) : undefined });
  }
}
