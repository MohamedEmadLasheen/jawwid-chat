import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OutboxWorker } from './communication/outbox/outbox.worker';
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

/**
 * How often the ring-timeout sweep runs. NOT the ring timeout itself -- that is
 * `call.ring_timeout_seconds` in chat.config and has exactly one home.
 *
 * This is only how often we ask, so it bounds how LATE an expiry can be: a call
 * is expired somewhere between its deadline and its deadline plus this
 * interval. At 5 seconds against a 45-second timeout that is under 12% of
 * lateness on a state the user already experiences as "it is still ringing".
 *
 * Running it on every outbox poll instead would mean a query per second per
 * replica for a table that is almost always empty of ringing calls.
 */
const CALL_SWEEP_MS = Number(process.env.CALL_SWEEP_INTERVAL_MS ?? 5000);

async function bootstrap(): Promise<void> {
  const log = new Logger('Worker');
  const build = readBuildInfo();

  // No HTTP server: this process serves no traffic and must not hold a port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const outbox = app.get(OutboxWorker);
  const calls = app.get(CallService);

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
      `[env=${build.environment} commit=${build.commit} poll=${POLL_MS}ms batch=${BATCH} ` +
      `callSweep=${CALL_SWEEP_MS}ms]`,
  );

  let lastSweepAt = 0;

  while (running) {
    let published = 0;
    draining = true;
    try {
      published = await outbox.drain(BATCH);
    } catch (e) {
      // Never exit on a drain failure: the row stays pending and is retried.
      // A worker that dies on one bad event stops delivering every other event.
      log.error(`drain failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      draining = false;
    }

    // Ring timeout. In the same loop rather than a timer of its own: a
    // setInterval would keep firing during a shutdown drain, and would run
    // whether or not this process still held its database connection.
    //
    // Safe on every replica at once -- the sweep claims each call with a single
    // conditional UPDATE, so concurrent workers cannot expire the same call
    // twice (CallService.expireRingingCalls). No leader election, no lock
    // service, nothing new to operate.
    if (Date.now() - lastSweepAt >= CALL_SWEEP_MS) {
      lastSweepAt = Date.now();
      try {
        await calls.expireRingingCalls();
      } catch (e) {
        // Same rule as the drain: a failed sweep is retried on the next pass.
        // The calls it did not expire are still ringing and still match.
        log.error(`call sweep failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    if (!running) break;
    // Back off when there is nothing to do, so an idle deployment is not
    // hammering the database once a second for no reason.
    await sleep(published > 0 ? POLL_MS : IDLE_BACKOFF_MS);
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
