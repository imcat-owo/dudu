/**
 * Batch 7 I11 — per-message display metadata.
 *
 * The agent's messages carry no timestamp or model info, so this module
 * observes the message list and records, per message id, when the message
 * was first seen in this session and which model produced it (the active
 * group's model at the time). The chat UI shows "model · time" under
 * bubbles when the corresponding prefs are on; unknown fields are simply
 * omitted — never guessed.
 */

import { useSyncExternalStore } from "react";

export interface MessageMeta {
  /** ms epoch when first seen in this session. */
  at: number;
  /** Model name that produced it (assistant messages). */
  model?: string;
}

let metas = new Map<string, MessageMeta>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): Map<string, MessageMeta> {
  return metas;
}

/**
 * Record metadata for newly arrived messages. Call from the chat
 * subscription with the current message list and the active model name.
 */
export function observeMessages(
  messages: Array<{ id: string; role: string }>,
  activeModel?: string,
): void {
  let changed = false;
  const next = new Map(metas);
  const now = Date.now();
  for (const m of messages) {
    if (next.has(m.id)) continue;
    changed = true;
    next.set(m.id, {
      at: now,
      model: m.role === "assistant" ? activeModel : undefined,
    });
  }
  // Cap memory: keep the newest 2000.
  if (next.size > 2000) {
    const ids = [...next.keys()].slice(0, next.size - 2000);
    for (const id of ids) next.delete(id);
    changed = true;
  }
  if (changed) {
    metas = next;
    emit();
  }
}

export function getMessageMeta(id: string): MessageMeta | undefined {
  return metas.get(id);
}

export function useMessageMeta(id: string): MessageMeta | undefined {
  const map = useSyncExternalStore(subscribe, getSnapshot);
  return map.get(id);
}
