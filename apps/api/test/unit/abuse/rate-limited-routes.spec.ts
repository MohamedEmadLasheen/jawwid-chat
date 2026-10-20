/**
 * Every rationed route carries its @RateLimited scope (Phase 8).
 *
 * The guard is opt-in, so the decorator IS the control: a route that loses it
 * in a refactor is silently unmetered and no other test notices. This reads the
 * metadata Nest itself routes by -- the HTTP method, the path, and the scope --
 * so renaming a route without carrying the decorator fails here too.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ActionScope, RATE_LIMITED_ACTION } from '@platform/auth/action-throttle.guard';
import { MessageController } from '@communication/api/message.controller';
import { CallController } from '@communication/api/call.controller';
import { StoryController } from '@communication/api/story.controller';
import { ScheduledCallController } from '../../../src/scheduled-calls/scheduled-call.controller';

type Ctor = { prototype: object };

const RATIONED: Array<[string, Ctor, string, string, ActionScope]> = [
  ['POST /conversations/:conversationId/messages', MessageController, 'send', '/', ActionScope.MESSAGE_SEND],
  ['POST /conversations/:conversationId/messages/forward', MessageController, 'forward', 'forward', ActionScope.MESSAGE_SEND],
  [
    'POST /conversations/:conversationId/messages/attachments/authorize',
    MessageController,
    'authorizeUpload',
    'attachments/authorize',
    ActionScope.ATTACHMENT_UPLOAD,
  ],
  ['POST /stories/media', StoryController, 'media', 'media', ActionScope.ATTACHMENT_UPLOAD],
  ['POST /stories/:id/publish', StoryController, 'publish', ':id/publish', ActionScope.STORY_PUBLISH],
  ['POST /calls', CallController, 'start', '/', ActionScope.CALL_START],
  ['POST /scheduled-calls/:id/join', ScheduledCallController, 'join', ':id/join', ActionScope.CALL_START],
];

const reflector = new Reflector();
const handler = (ctor: Ctor, name: string) => (ctor.prototype as Record<string, () => unknown>)[name];

describe('rationed routes carry @RateLimited', () => {
  it.each(RATIONED)('%s', (_route, ctor, name, path, scope) => {
    const fn = handler(ctor, name);
    expect(typeof fn).toBe('function');
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
    expect(reflector.get(RATE_LIMITED_ACTION, fn)).toBe(scope);
  });

  it('the controllers are mounted where the contract says', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MessageController)).toBe('conversations/:conversationId/messages');
    expect(Reflect.getMetadata(PATH_METADATA, StoryController)).toBe('stories');
    expect(Reflect.getMetadata(PATH_METADATA, CallController)).toBe('calls');
    expect(Reflect.getMetadata(PATH_METADATA, ScheduledCallController)).toBe('scheduled-calls');
  });

  it('opt-in: reads are not rationed (no round trip on history paging)', () => {
    expect(reflector.get(RATE_LIMITED_ACTION, handler(MessageController, 'list'))).toBeUndefined();
    expect(reflector.get(RATE_LIMITED_ACTION, handler(StoryController, 'feed'))).toBeUndefined();
    // No class-level scope that would silently ration every route.
    for (const ctor of [MessageController, StoryController, CallController, ScheduledCallController]) {
      expect(reflector.get(RATE_LIMITED_ACTION, ctor)).toBeUndefined();
    }
  });
});
