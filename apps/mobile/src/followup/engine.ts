/**
 * Memory-driven next-day follow-up （次日跟进） — fire-time engine.
 *
 * The delivery path is the initiative executor's (per-persona daily cap,
 * persona isolation, slot ledger, AI generation, dialog delivery, trace).
 * This engine adds the follow-up lifecycle around it:
 *
 * - master toggle off → stay silent;
 * - due item → first check "already discussed?" — if she already talked
 *   about the event after the item was created, auto-cancel (archive the
 *   backing rule, mark cancelled, trace it). Never ask about something
 *   she already told him.
 * - otherwise fire the backing one_time rule via the initiative path;
 *   then mark the item done — one follow-up per item, ever. A failed
 *   fire still marks done: no retry, no second chance (her hard rule).
 *
 * The discussed-check only looks at messages NEWER than the item's
 * baseline (message counts captured at creation), so her original
 * "我明天有个面试" never counts as "already discussed".
 */

import { type CrossDialogStorage, listDialogs, readDialog } from "../chat/cross-dialog";
import type { FireOutcome } from "../initiative/executor";
import type { TracePort } from "../outreach/notify";
import type { Persona } from "../persona/types";
import type { FollowupItem, FollowupStore } from "./store";

export interface FollowupEngineDeps {
  followupStore: FollowupStore;
  /** Cross-dialog storage (listDialogs/readDialog live here). */
  storage: CrossDialogStorage;
  trace: TracePort;
  getPersona(personaId: string): Promise<Persona | null>;
  /**
   * Fire the backing one_time initiative rule — the REAL delivery path
   * (cap, isolation, ledger, generation, delivery, trace all enforced).
   * Injected so tests don't need the full executor.
   */
  fireRule(ruleId: string, slotTime: number): Promise<FireOutcome>;
  /** Archive the backing rule + disarm its pre-scheduled notification. */
  retireRule(ruleId: string): Promise<void>;
  nowMs(): number;
}

/**
 * True when the event already came up in chat AFTER the item was created.
 * Persona-isolated by construction (listDialogs filters by persona).
 * Never throws — on any failure returns false (fail toward firing, not
 * toward silently dropping her follow-up).
 */
export async function wasDiscussed(
  deps: Pick<FollowupEngineDeps, "storage">,
  item: FollowupItem,
): Promise<boolean> {
  try {
    if (item.keywords.length === 0) return false;
    const dialogs = await listDialogs(deps.storage, item.personaId).catch(() => []);
    for (const d of dialogs) {
      const baseline = item.baselineCounts[d.id] ?? 0;
      const total = typeof d.messageCount === "number" ? d.messageCount : 0;
      const fresh = total - baseline;
      if (fresh <= 0) continue;
      // readDialog returns the LAST `limit` messages; take the newest `fresh`.
      const msgs = await readDialog(deps.storage, d.id, Math.min(50, fresh)).catch(() => []);
      const tail = msgs.slice(-fresh);
      for (const m of tail) {
        const text = (m.text ?? "").replace(/\s+/g, "");
        if (!text) continue;
        for (const kw of item.keywords) {
          if (kw.length >= 2 && text.includes(kw)) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Build the generation topic for the backing rule. The generic initiative
 * copy iron rule ("never claim she just sent a request") already applies —
 * this adds the follow-up specifics: natural, like he remembered.
 */
export function buildFollowupTopic(what: string, eventLabel: string): string {
  return (
    `她${eventLabel}有「${what}」这件事。现在那件事应该已经过去了，` +
    `自然地问一句结果/情况怎么样，就像你一直记得这件事、顺口一问。` +
    `绝对不要出现"跟进""提醒""备忘""打卡"这种词，也不要解释你为什么问。`
  );
}

export function buildFollowupTitle(what: string): string {
  const t = `问问${what}怎么样`;
  return t.length <= 40 ? t : t.slice(0, 40);
}

/**
 * Sweep due follow-ups. Never throws — one item's failure never breaks
 * the sweep, and a failed fire still marks the item done (no retry).
 */
export async function checkDueFollowups(
  deps: FollowupEngineDeps,
  nowMs: number = Date.now(),
): Promise<void> {
  let enabled = true;
  try {
    enabled = await deps.followupStore.isEnabled();
  } catch {
    enabled = true;
  }
  if (!enabled) return;

  let items: FollowupItem[] = [];
  try {
    items = await deps.followupStore.listDue(nowMs);
  } catch {
    return;
  }

  for (const item of items) {
    try {
      // Persona must still exist — a follow-up for a deleted persona stays silent.
      let persona: Persona | null = null;
      try {
        persona = await deps.getPersona(item.personaId);
      } catch {
        persona = null;
      }
      if (!persona) {
        await deps.followupStore.setStatus(item.id, "cancelled").catch(() => {});
        await deps.retireRule(item.ruleId).catch(() => {});
        continue;
      }

      // Auto-cancel: she already talked about it — don't ask again.
      if (await wasDiscussed(deps, item)) {
        await deps.followupStore.setStatus(item.id, "cancelled").catch(() => {});
        await deps.retireRule(item.ruleId).catch(() => {});
        await deps.trace
          .append({
            action: "followup_cancelled",
            fromThreadId: "followup",
            fromName: item.what,
            summary: `auto-cancelled: "${item.what}" already came up in chat`,
            reason: `follow-up for "${item.what}" (${item.eventLabel}) auto-cancelled — discussed after creation`,
            personaId: item.personaId,
          })
          .catch(() => {});
        continue;
      }

      // Fire through the real initiative path (cap/isolation/ledger/trace).
      await deps.fireRule(item.ruleId, item.followUpAtMs).catch(() => null);
      // One-shot: done whether it fired or not. No retry, ever.
      await deps.followupStore.setStatus(item.id, "done").catch(() => {});
    } catch {
      // One item never breaks the sweep.
    }
  }
}
