import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OutboxWorker } from './communication/outbox/outbox.worker';
import { NotificationService } from './communication/notifications/notification.service';
import { BroadcastWorker } from './communication/broadcast/broadcast.worker';
import { CallSweeper } from './communication/calls/call-sweeper';
import { AutomationSweeper } from './ai/automation/automation.sweeper';
import { RiskSweeper } from './ai/risk/risk.sweeper';
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
 * How often the Phase 5 TIME-DRIVEN sweeps run: missed calls, recording
 * retention, story expiry.
 *
 * Much less often than the outbox drain, because these are deadline sweeps
 * rather than a queue -- nothing is waiting on them, and the only cost of a
 * longer interval is that a missed call is marked missed up to this long after
 * its ring timeout. Ten seconds keeps that imperceptible while leaving the
 * database alone the rest of the time.
 */
const SWEEP_MS = Number(process.env.CALL_SWEEP_MS ?? 10_000);

async function bootstrap(): Promise<void> {
  const log = new Logger('Worker');
  const build = readBuildInfo();

  // No HTTP server: this process serves no traffic and must not hold a port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const outbox = app.get(OutboxWorker);
  const notifications = app.get(NotificationService);
  const broadcasts = app.get(BroadcastWorker);
  const sweeper = app.get(CallSweeper);
  // Phase 7. Both are idempotent by construction -- the automation engine
  // claims each occurrence with a unique insert before acting, and a duplicate
  // attention flag is refused by a partial unique index -- so several worker
  // replicas running them costs a little work and corrupts nothing.
  const automation = app.get(AutomationSweeper);
  const risk = app.get(RiskSweeper);
  // Phase 6. Driven on the SAME cadence as the Phase 5 sweeps rather than on a
  // scheduler of its own: escalation is a deadline sweep like the others, and
  // the only cost of the shared interval is that an item is escalated up to
  // SWEEP_MS after its threshold -- imperceptible against a threshold measured
  // in hours.

  let running = true;
  let draining = false;
  let lastSweep = 0;

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
    try {
      worked += await outbox.drain(BATCH);
    } catch (e) {
      // Never exit on a drain failure: the row stays pending and is retried.
      // A worker that dies on one bad event stops delivering every other event.
      log.error(`drain failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }

    // Each of the three below is wrapped separately, for the same reason the
    // outbox drain is: one failing subsystem must not stop the others. A wedged
    // broadcast fan-out must not be why nobody's notifications are going out.
    try {
      worked += await notifications.dispatchDue();
    } catch (e) {
      log.error(`notification dispatch failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }

    try {
      // Phase 5. Leased exactly like the outbox, so several worker replicas
      // take disjoint batches and one that dies releases its rows.
      worked += await broadcasts.drain();
    } catch (e) {
      log.error(`broadcast fan-out failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }

    if (Date.now() - lastSweep >= SWEEP_MS) {
      lastSweep = Date.now();
      try {
        // Idempotent and concurrency-safe by construction (see CallSweeper), so
        // several replicas running it costs a little work and corrupts nothing.
        await sweeper.sweep();
      } catch (e) {
        log.error(`sweep failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }

      // Phase 7, wrapped separately for the same reason every subsystem above
      // is: AI is an ENHANCEMENT, and an enhancement that can stop the outbox
      // draining or the missed-call sweep running is a single point of failure
      // wearing a different hat (§28).
      try {
        await automation.sweep();
      } catch (e) {
        log.error(`automation sweep failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }

      try {
        await risk.sweep();
      } catch (e) {
        log.error(`risk sweep failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }

      // Its own try, for the same reason every other subsystem here has one: a
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
