export type QueuedMessage = { id: string; text: string };
type Snapshot = { pending: readonly QueuedMessage[]; running: boolean; paused: boolean };

/**
 * P1-7: whether the chat screen may hand the queue to run().
 *
 * run() throws chat.notReady / apigroup.noActive BEFORE agent.addMessage, but
 * ConversationQueue.flush() pops the message first — so flushing under these
 * conditions silently loses the message (the draft was already cleared by
 * send()). The guard must replicate every pre-addMessage throw condition.
 * Pure so the invariant is regression-tested.
 */
export interface FlushGateInput {
  loaded: boolean;
  isReady: boolean;
  runLocked: boolean;
  agentRunning: boolean;
  mode: string;
  hasActiveGroup: boolean;
}

export function canFlushQueue(input: FlushGateInput): boolean {
  if (!input.loaded || !input.isReady || input.runLocked || input.agentRunning) return false;
  // Local mode with no active API group: run() is guaranteed to throw
  // apigroup.noActive before the message reaches the transcript.
  if (input.mode === "local" && !input.hasActiveGroup) return false;
  return true;
}

/** One AG-UI run at a time, while the person can keep composing. */
export class ConversationQueue {
  private state: Snapshot = { pending: [], running: false, paused: false };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  enqueue(message: QueuedMessage) {
    this.update({ pending: [...this.state.pending, message] });
  }
  remove(id: string) {
    this.update({ pending: this.state.pending.filter((message) => message.id !== id) });
  }
  pause() {
    this.update({ paused: true });
  }
  resume() {
    this.update({ paused: false });
  }
  async flush(send: (message: QueuedMessage) => Promise<void>) {
    if (this.state.running || this.state.paused) return;
    this.update({ running: true });
    try {
      while (this.state.pending.length && !this.state.paused) {
        const [message, ...pending] = this.state.pending;
        this.update({ pending });
        await send(message);
      }
    } catch (error) {
      // The failed message is already in the transcript. Never resend it implicitly.
      this.update({ paused: true });
      throw error;
    } finally {
      this.update({ running: false });
    }
  }
}
