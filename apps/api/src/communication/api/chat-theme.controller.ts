import { Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { ChatThemeService } from '../themes/chat-theme.service';

/**
 * The caller's OWN look for one chat (owner decisions 2026-10-20): a preset
 * background and, optionally, a wallpaper photo. Private to the caller; read
 * back as `viewerState.theme` / `viewerState.wallpaperUrl` on the conversation.
 * The wallpaper is two steps, like a profile photo: `upload` returns a signed
 * PUT bound to type and size, then `POST ... wallpaper { objectKey }` commits it
 * once the stored bytes are checked.
 */
@Controller('conversations/:conversationId')
export class ChatThemeController {
  constructor(private readonly themes: ChatThemeService) {}

  @Put('theme')
  setTheme(@ActorId() actorId: string, @Param('conversationId') conversationId: string, @Body() body: { theme?: unknown }) {
    // An absent `theme` is refused (only an explicit null means the default look).
    return this.themes.setTheme(actorId, conversationId, body && 'theme' in body ? body.theme : undefined);
  }

  @Post('wallpaper/upload')
  upload(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: { mimeType?: unknown; byteSize?: unknown },
  ) {
    return this.themes.authorizeWallpaperUpload(actorId, conversationId, body ?? {});
  }

  @Post('wallpaper')
  commit(@ActorId() actorId: string, @Param('conversationId') conversationId: string, @Body() body: { objectKey?: unknown }) {
    return this.themes.commitWallpaper(actorId, conversationId, body ?? {});
  }

  @Delete('wallpaper')
  remove(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.themes.removeWallpaper(actorId, conversationId);
  }
}
