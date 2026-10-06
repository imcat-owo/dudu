/**
 * 真人式分段发送 — bubble drip scheduler.
 *
 * After a turn's final assistant bubble is split, the first bubble
 * replaces the original message immediately and the rest "drip" in with
 * human-like delays through the REAL addMessage path (each drip emits +
 * persists, exactly like a normal message).
 *
 * No React Native imports — the timer is injectable so node tests can
 * drive it deterministically.
 */

import { bubbleDelayMs } from "./split";

export interface DripTimer {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const realTimer: DripTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class BubbleDrip {
  private queue: string[] = [];
  private timers: unknown[] = [];
  /** Bubbles still waiting to drip. Drives the typing indicator. */
  pendingCount = 0;

  constructor(
    private deliver: (text: string) => void,
    private onChange: () => void = () => {},
    private timer: DripTimer = realTimer,
  ) {}

  /** Start dripping. The first element's delay is based on prevLen. */
  start(bubbles: string[], prevLen: number): void {
    this.cancel();
    this.queue = [...bubbles];
    this.pump(prevLen);
  }

  private pump(prevLen: number): void {
    if (this.queue.length === 0) {
      this.setPending(0);
      return;
    }
    this.setPending(this.queue.length);
    const delay = bubbleDelayMs(prevLen);
    const id = this.timer.set(() => {
      const next = this.queue.shift();
      if (next === undefined) {
        this.setPending(0);
        return;
      }
      this.deliver(next);
      this.pump(next.length);
    }, delay);
    this.timers.push(id);
  }

  /** Deliver everything still queued, right now. No loss on stop(). */
  flush(): void {
    const rest = this.queue.splice(0);
    this.clearTimers();
    for (const b of rest) this.deliver(b);
    this.setPending(0);
  }

  cancel(): void {
    this.queue = [];
    this.clearTimers();
    this.setPending(0);
  }

  private clearTimers(): void {
    for (const t of this.timers) this.timer.clear(t);
    this.timers = [];
  }

  private setPending(n: number): void {
    if (this.pendingCount !== n) {
      this.pendingCount = n;
      this.onChange();
    }
  }
}
