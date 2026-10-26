import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OutboxWorker } from './communication/outbox/outbox.worker';
import { StorySweeper } from './communication/stories/story-sweeper.service';
import { CallService } from './communication/calls/call.service';
import { SchedulingService } from './lessons/scheduling.service';
import { LifecycleService } from './lessons/lifecycle.service';
import { NotificationService } from './communication/notifications/notification.service';
import { NotificationPipeline } from './communication/notifications/notification-pipeline.service';
import { readBuildInfo } from './infra/build-info';
import { listenForOutboxWake, OutboxPacer } from './communication/outbox/outbox-wake';
import { PaymentReminders } from './billing/payment-reminders.service';
import { SubscriptionEffects } from './subscriptions/subscription-effects.service';
import { subscriptionLockEnforced } from './platform/subscription-lock';
import { ConversationSeatService } from './communication/seats/conversation-seat.service';
import { PrismaService } from './platform/prisma.service';
import { JsonLogger } from './infra/observability/json-logger';
import { createErrorTracker, type ErrorTracker } from './infra/observability/error-tracker';
import { flushErrorTracker, installProcessErrorHandlers } from './infra/observability/process-errors';
import { safeErrorMessage } from './infra/observability/redact';

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
 * How often the story sweep runs.
 *
 * Deliberately NOT once per outbox poll: the outbox loop ticks every second and
 * the sweep is a scan over two indexed predicates that nothing is waiting on.
 * A minute is far tighter than it needs to be, because the sweep does not gate
 * access -- a story stops being readable at its expires_at whatever this value
 * is (see StorySweeper). Raising it delays bookkeeping and media purging, never
 * a revocation.
 */
const STORY_SWEEP_MS = Number(process.env.STORY_SWEEP_MS ?? 60_000);

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

/**
 * PD-11 T2: how often lessons are materialized from regular times and their
 * reminders scheduled. Both are idempotent (one lesson per slot and start, one
 * notification per rule, lesson and recipient), so every replica may run it.
 */
const LESSON_SWEEP_MS = Number(process.env.LESSON_SWEEP_MS ?? 300_000);

/**
 * PD-27: how often open instalments schedule their payment reminders. Idempotent
 * (one notification per rule, instalment and parent), so every replica may run
 * it; hourly is enough for reminders measured in days.
 */
const PAYMENT_REMINDER_SWEEP_MS = 60 * 60_000;
/** PD-34: adopt legacy deliveries into the Notification Center; purge once a day. */
const NOTIFICATION_ADOPT_MS = Number(process.env.NOTIFICATION_ADOPT_MS ?? 10_000);
const NOTIFICATION_PURGE_MS = 24 * 60 * 60_000;

/**
 * PD-30: how often every child's subscription state is recomputed (an
 * instalment becomes overdue by the calendar, not by a write), its changes
 * announced and the lesson holds made to follow. The state a write changes is
 * already current -- the database recomputes it in the writer's transaction --
 * so this bounds only how late an overdue lock, a card or a hold can be.
 * Exactly-once per event (SubscriptionEffects), so every replica may run it.
 * It runs on its OWN loop, beside the outbox loop rather than inside it: a
 * sweep over every child never delays a message's delivery.
 */
const SUBSCRIPTION_SWEEP_MS = Number(process.env.SUBSCRIPTION_SWEEP_MS ?? 60_000);

/**
 * PD-32: how often wrong parent sign-up codes older than a week are purged
 * (chat.purge_parent_signup_failures). Unauthenticated requests insert them, so
 * they must not pile up; one delete statement, safe on every replica.
 */
const SIGNUP_FAILURE_PURGE_MS = 6 * 60 * 60_000;

/**
 * PD-35: how often seats that no longer hold, or went idle, are ended. Access
 * never waits for it -- a seat's eligibility is re-checked on every access --
 * so this only tidies the member list and posts the line.
 */
const SEAT_SWEEP_MS = 60_000;

/**
 * After a wake hint (outbox-wake.ts), how long to keep polling at
 * WAKE_POLL_MS before falling back to the idle backoff. The hint can arrive
 * before the enqueuing transaction commits, so one read is not enough; a short
 * window of fast reads is, and costs nothing while the system is quiet.
 */
const WAKE_WINDOW_MS = 2000;
const WAKE_POLL_MS = 50;

const build = readBuildInfo();

// The same JSON lines as the API (docs/infrastructure/monitoring.md §3), with
// service "worker", so one log pipeline parses both processes.
const logger = new JsonLogger('worker', build);

// The worker needs error tracking MORE than the API does, not less. An API
// fault surfaces as a 500 somebody sees; a worker fault is a notification that
// silently never went out, and the loop below deliberately swallows every
// subsystem error to keep the others running. Without a tracker those are a
// log line on a machine nobody is watching. Inert without SENTRY_DSN.
const errors: ErrorTracker = createErrorTracker('worker', build);
installProcessErrorHandlers(errors, logger);

/**
 * A subsystem failure the loop survived: logged and reported, never rethrown.
 * The log carries the error's redacted message -- a Prisma error only as its
 * class and code, because Prisma prints the arguments of the failed call --
 * and never its stack. `route` names the subsystem, a fixed label.
 */
function report(log: Logger, what: string, route: string, e: unknown): void {
  log.error(`${what} failed: ${safeErrorMessage(e)}`);
  errors.captureException(e, { component: 'worker', route });
}

async function bootstrap(): Promise<void> {
  const log = new Logger('Worker');

  // No HTTP server: this process serves no traffic and must not hold a port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger,
  });
  const outbox = app.get(OutboxWorker);
  const stories = app.get(StorySweeper);
  const calls = app.get(CallService);
  const notifications = app.get(NotificationService);
  const scheduling = app.get(SchedulingService);
  const lifecycle = app.get(LifecycleService);
  const paymentReminders = app.get(PaymentReminders);
  const pipeline = app.get(NotificationPipeline);
  const subscriptions = app.get(SubscriptionEffects);
  const seats = app.get(ConversationSeatService);
  const prisma = app.get(PrismaService);

  let running = true;
  let draining = false;
  let subscriptionBusy = false;

  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    log.log(`${signal} received; finishing the current batch`);
    // Deliberately does NOT kill an in-flight drain. A batch interrupted
    // mid-publish would leave rows claimed but unpublished, and at-least-once
    // delivery only holds if a claimed row is either published or released.
    const wait = setInterval(() => {
      if (!draining && !subscriptionBusy) {
        clearInterval(wait);
        void flushErrorTracker(errors)
          .then(() => app.close())
          .then(() => process.exit(0));
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

  let nextStorySweep = 0;
  let lastSweepAt = 0;
  let nextLessonSweep = 0;
  let nextPaymentReminderSweep = 0;
  let nextSignupFailurePurge = 0;
  let nextNotificationAdopt = 0;
  let nextNotificationPurge = 0;
  let nextSeatSweep = 0;

  // PD-30: the subscription sweep's own loop (see SUBSCRIPTION_SWEEP_MS).
  log.log(`payment lock (SUBSCRIPTION_LOCK_ENFORCED): ${subscriptionLockEnforced() ? 'ENFORCED' : 'off'}`);
  const subscriptionLoop = (async () => {
    while (running) {
      subscriptionBusy = true;
      try {
        await subscriptions.sweep();
      } catch (e) {
        report(log, 'subscription sweep', 'subscriptions.sweep', e);
      } finally {
        subscriptionBusy = false;
      }
      for (let waited = 0; running && waited < SUBSCRIPTION_SWEEP_MS; waited += 500) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  })();

  // Realtime latency: a hint that a row was enqueued cuts the current sleep
  // short (OutboxPacer). Without Redis there are no hints and the loop simply
  // polls -- correctness never depends on one.
  const pacer = new OutboxPacer({
    pollMs: POLL_MS,
    idleMs: IDLE_BACKOFF_MS,
    wakePollMs: WAKE_POLL_MS,
    wakeWindowMs: WAKE_WINDOW_MS,
  });
  const closeWake = await listenForOutboxWake(() => pacer.wake()).catch((e) => {
    log.warn(`outbox wake hints unavailable, polling only: ${e instanceof Error ? e.message : 'unknown'}`);
    return null;
  });

  while (running) {
    let published = 0;
    draining = true;
    try {
      published = await outbox.drain(BATCH);
    } catch (e) {
      // Never exit on a drain failure: the row stays pending and is retried.
      // A worker that dies on one bad event stops delivering every other event.
      report(log, 'drain', 'outbox.drain', e);
    } finally {
      draining = false;
    }

    // Retire expired stories and purge media past its retention window. Inside
    // the same `draining` guard as the outbox so a shutdown finishes it, and
    // wrapped in its own try so a sweep failure can never stop event delivery --
    // the two have separate failure domains on purpose.
    if (Date.now() >= nextStorySweep) {
      draining = true;
      try {
        await stories.sweep();
      } catch (e) {
        report(log, 'story sweep', 'stories.sweep', e);
      } finally {
        draining = false;
        // Scheduled from completion rather than from the previous start, so a
        // slow sweep cannot queue up behind itself.
        nextStorySweep = Date.now() + STORY_SWEEP_MS;
      }
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
        report(log, 'call sweep', 'calls.expireRinging', e);
      }
    }

    // Lessons from regular times, their reminders and (hourly, inside the
    // sweep) the PD-22 daylight-saving warnings -- before dispatch, so a
    // reminder scheduled now and already due goes out on this pass.
    if (Date.now() >= nextLessonSweep) {
      draining = true;
      try {
        // Resume pauses that reached their return date first, so the materializer
        // that follows already creates their lessons.
        await lifecycle.sweep();
        await scheduling.sweep();
      } catch (e) {
        report(log, 'lesson sweep', 'lessons.sweep', e);
      } finally {
        draining = false;
        nextLessonSweep = Date.now() + LESSON_SWEEP_MS;
      }
    }

    // PD-27: payment reminders for open instalments (a parent added since the
    // instalment was created is reached here). Before dispatch, like lessons.
    if (Date.now() >= nextPaymentReminderSweep) {
      draining = true;
      try {
        await paymentReminders.sweep();
      } catch (e) {
        report(log, 'payment reminder sweep', 'billing.reminders', e);
      } finally {
        draining = false;
        nextPaymentReminderSweep = Date.now() + PAYMENT_REMINDER_SWEEP_MS;
      }
    }

    // PD-32: the week-old wrong sign-up codes go.
    if (Date.now() >= nextSignupFailurePurge) {
      draining = true;
      try {
        await prisma.$queryRaw`SELECT chat.purge_parent_signup_failures()`;
      } catch (e) {
        report(log, 'sign-up failure purge', 'signup.purge', e);
      } finally {
        draining = false;
        nextSignupFailurePurge = Date.now() + SIGNUP_FAILURE_PURGE_MS;
      }
    }

    // PD-35: seats that no longer hold, or went idle, end with a visible line.
    if (Date.now() >= nextSeatSweep) {
      draining = true;
      try {
        await seats.sweep();
      } catch (e) {
        report(log, 'seat sweep', 'seats.sweep', e);
      } finally {
        draining = false;
        nextSeatSweep = Date.now() + SEAT_SWEEP_MS;
      }
    }

    // Deliver the notifications the outbox scheduled.
    //
    // Nothing called this before, so a notification could be scheduled by the
    // engine and then sit in chat.notification forever -- the pipeline was
    // complete at both ends and disconnected in the middle. dispatchDue()
    // claims each row with a conditional update, so running it on every replica
    // at once cannot double-send.
    try {
      await notifications.dispatchDue();
    } catch (e) {
      // A row that failed to dispatch is rescheduled with backoff by the
      // service itself; a throw here must not stop the drain loop.
      report(log, 'notification dispatch', 'notifications.dispatchDue', e);
    }
    // PD-34: the Notification Center. Adopt sent legacy deliveries (calls,
    // stories, payment receipts) into entries, tell each person whose Center
    // gained a visible entry, and purge past retention. Each in its own try:
    // none of them may stop delivery.
    if (Date.now() >= nextNotificationAdopt) {
      try {
        await pipeline.adoptLegacy();
      } catch (e) {
        report(log, 'notification adoption', 'notifications.adopt', e);
      } finally {
        nextNotificationAdopt = Date.now() + NOTIFICATION_ADOPT_MS;
      }
    }
    try {
      await pipeline.announceDue();
    } catch (e) {
      report(log, 'notification announce', 'notifications.announce', e);
    }
    if (Date.now() >= nextNotificationPurge) {
      try {
        await pipeline.purge();
      } catch (e) {
        report(log, 'notification purge', 'notifications.purge', e);
      } finally {
        nextNotificationPurge = Date.now() + NOTIFICATION_PURGE_MS;
      }
    }

    if (!running) break;
    // Back off when there is nothing to do, so an idle deployment is not
    // hammering the database once a second for no reason -- unless a wake hint
    // just said a row is on its way, in which case poll fast for a moment.
    // Either sleep is cut short by the next hint.
    await pacer.pause(pacer.delayAfter(published));
  }
  await subscriptionLoop;
  await closeWake?.();
}

void bootstrap().catch(async (error: unknown) => {
  // Logged through the JSON logger (message only, redacted), reported, and
  // flushed before the non-zero exit the platform needs to see.
  logger.fatal(`worker failed: ${safeErrorMessage(error)}`, 'Worker');
  errors.captureException(error, { route: 'bootstrap', component: 'worker' });
  await flushErrorTracker(errors);
  process.exit(1);
});
