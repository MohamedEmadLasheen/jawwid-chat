/**
 * The real provider graph resolves -- in seconds, not never.
 *
 * A Nest provider cycle does not throw: the injector waits on it forever. PD-34
 * once closed one (RealtimeGateway -> MessageService -> NotificationPipeline ->
 * REALTIME_PUBLISHER -> RealtimeGateway) and nothing local saw it, because the
 * harness and these unit suites build services by hand. CI saw only 300 s
 * beforeAll timeouts in every suite that boots the app, and the API itself
 * would not have started.
 *
 * So this compiles the same AppModule main.ts and worker.ts boot, with no
 * database and no Redis (both connect lazily; compile() runs no lifecycle hook)
 * and fails within the bound instead of hanging.
 */
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { OutboxWorker } from '../../../src/communication/outbox/outbox.worker';
import { MessageService } from '../../../src/communication/messages/message.service';
import { RealtimeGateway } from '../../../src/communication/realtime/realtime.gateway';
import { NotificationPipeline } from '../../../src/communication/notifications/notification-pipeline.service';

const BOUND_MS = 20_000;

jest.setTimeout(BOUND_MS + 10_000);

it('AppModule compiles within the bound (a provider cycle would hang here)', async () => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`AppModule did not compile within ${BOUND_MS} ms: look for a provider cycle`)),
      BOUND_MS,
    );
  });
  try {
    const ref = await Promise.race([Test.createTestingModule({ imports: [AppModule] }).compile(), timeout]);
    // The worker's pipeline is wired (not silently left out as @Optional).
    expect(ref.get(OutboxWorker)).toBeDefined();
    expect(ref.get(NotificationPipeline)).toBeDefined();
    expect(ref.get(RealtimeGateway)).toBeDefined();
    expect(ref.get(MessageService)).toBeDefined();
    expect((ref.get(OutboxWorker) as unknown as { pipeline?: unknown }).pipeline).toBeInstanceOf(NotificationPipeline);
    await ref.close();
  } finally {
    clearTimeout(timer);
  }
});
