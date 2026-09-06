import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OutboxWorker } from './outbox.worker';
import { NotificationService } from '../notifications/notification.service';

/**
 * Runs the workers.
 *
 * WHY THIS EXISTS: OutboxWorker.drain() and NotificationService.dispatchDue()
 * were implemented and tested, but nothing invoked them. A tested function that
 * nothing calls is not a feature -- without this class a deployed system commits
 * messages and never fans them out, and schedules reminders that never send.
 *
 * WHY AN INTERVAL AND NOT BullMQ: both methods claim their work with a
 * conditional UPDATE, so they are already safe to run concurrently, on several
 * instances, and across restarts. An interval is therefore sufficient and
 * correct. BullMQ remains the right answer for backoff visibility, metrics and
 * very high volume; this is deliberately the smallest thing that makes the
 * behaviour real, not a replacement for that decision.
 *
 * Disable with WORKERS_ENABLED=false (tests, or a web-only instance in a
 * deployment that runs workers separately).
 */
@Injectable()
export class WorkerScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(WorkerScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly outbox: OutboxWorker,
    private readonly notifications: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') {
      this.log.warn('workers disabled by WORKERS_ENABLED=false');
      return;
    }

    const outboxMs = Number(process.env.OUTBOX_POLL_MS ?? 1000);
    const notifyMs = Number(process.env.NOTIFICATION_POLL_MS ?? 5000);

    this.timers.push(this.every(outboxMs, 'outbox', () => this.outbox.drain()));
    this.timers.push(this.every(notifyMs, 'notifications', () => this.notifications.dispatchDue()));

    this.running = true;
    this.log.log(`workers started (outbox ${outboxMs}ms, notifications ${notifyMs}ms)`);
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * A tick never overlaps itself and never rejects: an unhandled rejection in a
   * timer would take the process down and stop all delivery.
   */
  private every(ms: number, name: string, fn: () => Promise<unknown>): NodeJS.Timeout {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void fn()
        .catch((e) => this.log.warn(`${name} tick failed: ${e instanceof Error ? e.message : e}`))
        .finally(() => {
          inFlight = false;
        });
    }, ms);
    timer.unref();
    return timer;
  }
}
