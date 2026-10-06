/**
 * Together-days milestone sweeper — detects newly-hit milestones and
 * schedules ONE celebration each through the real initiative delivery path
 * (shared daily cap, quiet hours, persona isolation, slot ledger, no retry).
 *
 * Deps-injected for tests; production wiring lives in ./instances.
 * Never throws — a sweep must never break the foreground loop.
 */

import { daysTogether } from "../our-space/together";
import {
  buildMilestoneTopic,
  detectNewMilestones,
  type MilestoneLedger,
  milestoneId,
  nextCelebrationTimeMs,
} from "./milestones";

export interface MilestoneSweepDeps {
  /** Resolved together-since date (YYYY-MM-DD), or null when unknown. */
  resolveSince(): Promise<string | null>;
  isEnabled(): Promise<boolean>;
  /** Active persona id — the voice that celebrates. Null = no speaker, stay silent. */
  getActivePersonaId(): Promise<string | null>;
  loadLedger(): Promise<MilestoneLedger>;
  saveLedger(ledger: MilestoneLedger): Promise<void>;
  /** Real shared memories, newest first — may be empty (honest fallback). */
  sampleMemories(limit: number): Promise<string[]>;
  createRule(input: {
    personaId: string;
    title: string;
    topic: string;
    atMs: number;
  }): Promise<{ id: string }>;
  /** Re-arm the rule's pre-scheduled notification after creation. */
  onRuleCreated(ruleId: string): Promise<void>;
  nowMs(): number;
}

export interface MilestoneSweepResult {
  /** Day thresholds celebrated (scheduled) in this sweep. */
  fired: number[];
  /** Why nothing fired: ok | disabled | no-together-date | no-active-persona | none-due | create-failed | error */
  skipped: string;
}

export async function sweepMilestoneCelebrations(
  deps: MilestoneSweepDeps,
): Promise<MilestoneSweepResult> {
  const now = deps.nowMs();
  try {
    if (!(await deps.isEnabled())) return { fired: [], skipped: "disabled" };

    const since = await deps.resolveSince();
    const days = daysTogether(since, new Date(now));
    if (days === null || since === null) {
      return { fired: [], skipped: "no-together-date" };
    }

    // The celebration needs a voice. No active persona -> no celebration,
    // never invent a speaker.
    const personaId = await deps.getActivePersonaId();
    if (!personaId) return { fired: [], skipped: "no-active-persona" };

    const ledger = await deps.loadLedger();
    const done = [...ledger.celebrated, ...ledger.skipped];
    const fresh = detectNewMilestones(days, done);
    if (fresh.length === 0) return { fired: [], skipped: "none-due" };

    const memories = await deps.sampleMemories(3);
    const fired: number[] = [];
    for (const d of fresh) {
      const id = milestoneId(d);
      try {
        const rule = await deps.createRule({
          personaId,
          title: `在一起${d}天`,
          topic: buildMilestoneTopic(d, since, memories),
          atMs: nextCelebrationTimeMs(now),
        });
        await deps.onRuleCreated(rule.id);
        ledger.pending[id] = rule.id;
        ledger.celebrated.push(id);
        fired.push(d);
        // Persist per milestone: a crash between milestones can't
        // double-schedule the one already created.
        await deps.saveLedger({ ...ledger });
      } catch {
        // One failure must not block the others, and a failed create is
        // never marked celebrated — it retries on the next sweep.
      }
    }
    return { fired, skipped: fired.length > 0 ? "ok" : "create-failed" };
  } catch {
    return { fired: [], skipped: "error" };
  }
}
