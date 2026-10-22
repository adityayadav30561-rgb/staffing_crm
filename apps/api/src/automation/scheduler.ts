import type { DB } from '../db';
import { runRules, type RunResult } from './rules';

/** Runs the auto-task rules on an interval, and shortly after relevant changes ("kick"). */
export class Automation {
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private running: Promise<RunResult> | null = null;
  lastRun: { at: Date; result: RunResult } | null = null;

  constructor(private db: DB) {}

  start(intervalMs: number) {
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => void this.runNow().catch(() => {}), intervalMs);
    void this.runNow().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = this.kickTimer = null;
  }

  /** Debounced run after a write, so tasks open/close within seconds instead of minutes. */
  kick() {
    if (!this.timer) return; // disabled (tests call runNow directly)
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.runNow().catch(() => {}), 1500);
  }

  async runNow(now = new Date()): Promise<RunResult> {
    if (this.running) return this.running;
    this.running = runRules(this.db, now)
      .then((result) => {
        this.lastRun = { at: new Date(), result };
        return result;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
