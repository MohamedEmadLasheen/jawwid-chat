import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OutboxWorker } from './communication/outbox/outbox.worker';
import { NotificationService } from './communication/notifications/notification.service';
import { DeliveryService } from './communication/notifications/delivery.service';
import { AnnouncementService } from './communication/announcements/announcement.service';
import { RetentionService } from './communication/notifications/retention.service';
import { CoreIngestService } from './communication/core/core-ingest.service';
import { CallService } from './communication/calls/call.service';
import { readBuildInfo } from './infra/build-info';

/**
 * Background worker entrypoint. Same image as the API, different command
 * (docs/infrastructure/decisions.md ADR-004), so the worker can never be
 * running a different commit than the API.
 *
 * It adds no queue of its own. AI #2's OutboxWorker already implements the
 * transactional outbox -- claiming rows with a conditional update so two
 * workers never publish the same event twice. This process only gives that
 * code a runtime: an application context, a polling loop, and a clean exit.
 *
 * Polling rather than a Redis queue is deliberate at this stage: the outbox is
 * written in the same transaction as the domain change, so the database is
 * already the source of truth for what needs publishing. Introducing BullMQ
 * here would add a second, weaker record of the same facts.
 */
const POLL_MS = Number(process.env.OUTBOX_POLL_MS ?? 1000);
const BATCH = Number(process.env.OUTBOX_BATCH_SIZE ?? 100);
const IDLE_BACKOFF_MS = Number(process.env.OUTBOX_IDLE_BACKOFF_MS ?? 5000);

async function bootstrap(): Promise<void> {
  const log = new Logger('Worker');
  const build = readBuildInfo();

  // No HTTP server: this process serves no traffic and must not hold a port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const outbox = app.get(OutboxWorker);
  const notifications = app.get(NotificationService);
  const deliveries = app.get(DeliveryService);
  const announcements = app.get(AnnouncementService);
  const retention = app.get(RetentionService);
  const calls = app.get(CallService);
  const coreIngest = app.get(CoreIngestService);

  let running = true;
  let draining = false;

  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    log.log(`${signal} received; finishing the current batch`);
    // Deliberately does NOT kill an in-flight drain. A batch interrupted
    // mid-publish would leave rows claimed but unpublished, and at-least-once
    // delivery only holds if a claimed row is either published or released.
    const wait = setInterval(() => {
      if (!draining) {
        clearInterval(wait);
        void app.close().then(() => process.exit(0));
      }
    }, 100);
    // Backstop, so a wedged batch cannot block the deployment forever.
    setTimeout(() => {
      log.error('grace period expired; forcing exit');
      process.exit(1);
    }, Number(process.env.SHUTDOWN_GRACE_MS ?? 15000)).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  log.log(
    `Jawwid Chat worker started ` +
      `[env=${build.environment} commit=${build.commit} poll=${POLL_MS}ms batch=${BATCH}]`,
  );

  while (running) {
    let worked = 0;
    draining = true;

    // Four sweeps, each independently guarded. A failure in one must not stop
    // the others: an announcement fan-out that throws cannot be allowed to stop
    // class reminders going out, and a dead push provider cannot be allowed to
    // stop the outbox draining.
    for (const [name, sweep] of [
      // 1. Events -> notifications. Must run first; the others act on its output.
      // The Core boundary's processor, first: a class session that arrived in
      // this tick should produce its reminders in the same tick rather than the
      // next one. It enqueues outbox events, which the sweep below then drains.
      ['core-ingest', () => coreIngest.drain(BATCH)],
      ['outbox', () => outbox.drain(BATCH)],
      // 2. Due notifications -> channels. This is what makes a class reminder
      //    fire while the parent's phone is off and the app has been closed for
      //    a week: the reminder is a row with a scheduled_at, and this sweep is
      //    what notices the time has come. Nothing about it depends on a client.
      ['dispatch', () => notifications.dispatchDue(new Date(), BATCH)],
      // 3. Deliveries whose backoff has elapsed. Bounded retries; a delivery
      //    that has exhausted its budget is failed, not retried forever.
      ['retry', () => deliveries.retryDue(new Date(), BATCH)],
      // 4. Announcements whose publish time has arrived.
      ['announce', () => announcements.fanOutDue(new Date())],
      // 5. Calls that rang out. Until this existed a missed call only became a
      //    notification when the CALLER hung up -- so a caller who walked away
      //    left the parent never learning the academy had tried to reach them.
      ['ring-timeout', () => calls.expireRingingCalls(new Date())],
      // 6. Retention. Self-throttling -- it no-ops until its interval elapses,
      //    so putting it in the same loop costs a clock comparison per pass and
      //    does not need a second scheduler. It never throws into this loop:
      //    housekeeping failing must not stop notifications being delivered.
      ['retention', async () => (await retention.runDue()).notificationsDeleted],
    ] as const) {
      if (!running) break;
      try {
        worked += await sweep();
      } catch (e) {
        log.error(
          `${name} sweep failed: ${e instanceof Error ? e.message : 'unknown error'}`,
        );
      }
    }

    draining = false;
    if (!running) break;
    // Back off when there is nothing to do, so an idle deployment is not
    // hammering the database once a second for no reason.
    await sleep(worked > 0 ? POLL_MS : IDLE_BACKOFF_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  // eslint-disable-next-line no-console
  console.error(`FATAL: worker failed to start: ${message}`);
  process.exit(1);
});
