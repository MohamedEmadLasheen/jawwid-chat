import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ActorId } from './actor.decorator';
import { ConversationExportService } from '../export/conversation-export.service';

/**
 * GET /conversations/:id/export -- the chat as a .zip (transcript + media).
 * Super admin only, audited before the first byte (ConversationExportService).
 * Every refusal is thrown before a header is written, so it reaches the client
 * as the usual JSON error.
 */
@Controller('conversations/:conversationId')
export class ExportController {
  constructor(private readonly exports: ConversationExportService) {}

  @Get('export')
  async export(@ActorId() actorId: string, @Param('conversationId') conversationId: string, @Res() res: Response): Promise<void> {
    const prepared = await this.exports.prepare(actorId, conversationId);
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${prepared.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let gone = false;
    res.once('close', () => {
      gone = true;
    });
    try {
      await prepared.write({
        write: async (chunk) => {
          if (gone) throw new Error('the client went away');
          if (!res.write(chunk)) {
            await new Promise<void>((resolve) => {
              res.once('drain', resolve);
              res.once('close', resolve);
            });
          }
        },
      });
      res.end();
    } catch {
      // Headers are sent; a broken archive is the only honest signal left.
      res.destroy();
    }
  }
}
