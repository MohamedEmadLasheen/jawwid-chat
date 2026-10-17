/**
 * StoryService's constructor, as Nest sees it.
 *
 * Regression: ConversationService was imported with `import type`, so the
 * emitted design metadata named `Object` for that parameter, Nest could not
 * resolve it, and @Optional() injected undefined -- every "message the
 * publisher" tap in the running app answered "replies are not available".
 * The integration harness builds StoryService by hand and passed the service
 * explicitly, which is exactly why no integration test could see it.
 */
import 'reflect-metadata';
import { StoryService } from '@communication/stories/story.service';
import { ConversationService } from '@communication/conversations/conversation.service';

describe('StoryService DI wiring', () => {
  it('declares ConversationService as a real constructor type, so Nest can inject it', () => {
    const types = Reflect.getMetadata('design:paramtypes', StoryService) as unknown[];
    expect(types).toContain(ConversationService);
  });
});
