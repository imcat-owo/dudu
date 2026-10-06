/**
 * Together-days milestone celebrations — app singletons and production wiring.
 *
 * Delivery rides on the initiative engine: each celebration is a one_time
 * rule fired through the real proactive path (shared daily cap, quiet
 * hours, persona isolation, slot ledger, AI generation in the persona's
 * voice, dialog delivery — all enforced). Nothing is a parallel shadow
 * system.
 *
 * expo-notifications is NOT imported here directly — notification re-arming
 * goes through initiative/instances (lazy), so this module stays
 * importable in node tests.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cancelInitiativeSchedule,
  initiativeStore,
  rescheduleInitiativeRule,
} from "../initiative/instances";
import { memoryStore } from "../memory/instance";
import { ourSpaceStore } from "../our-space/instance";
import { daysTogether, resolveTogetherSince } from "../our-space/together";
import { personaStore } from "../persona/stores";
import { sweepMilestoneCelebrations } from "./milestone-sweeper";
import {
  loadMilestoneCelebrationsEnabled,
  loadMilestoneLedger,
  saveMilestoneLedger,
} from "./milestones";
import { createMilestoneTools } from "./tools";

/** Real shared memories for the celebration topic: timeline moments first (most relationship-specific), then blooming memories. Empty is honest. */
async function sampleSharedMemories(limit: number): Promise<string[]> {
  const out: string[] = [];
  try {
    const timeline = await ourSpaceStore.listTimeline(100).catch(() => []);
    for (const e of timeline) {
      if (e.kind === "moment" || e.kind === "milestone") {
        const s = [e.title, e.description].filter(Boolean).join(" — ").trim();
        if (s) out.push(s);
      }
      if (out.length >= limit) return out.slice(0, limit);
    }
  } catch {
    // Fall through to memories — empty stays honest.
  }
  try {
    const mems = await memoryStore.listCurrent().catch(() => []);
    const sorted = [...mems].sort((a, b) => (b.validFrom ?? 0) - (a.validFrom ?? 0));
    for (const m of sorted) {
      const c = (m.content ?? "").trim();
      if (c) out.push(c);
      if (out.length >= limit) break;
    }
  } catch {
    // Empty is honest: the topic says so instead of inventing memories.
  }
  return out.slice(0, limit);
}

let tickInFlight = false;

/** One tick of the milestone sweeper (called from the initiative foreground loop). Never throws. */
export async function runMilestoneTick(nowMs: number = Date.now()): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await sweepMilestoneCelebrations({
      resolveSince: async () => {
        try {
          const p = await ourSpaceStore.getCoupleProfile();
          const anniversaries = await ourSpaceStore.listAnniversaries();
          return resolveTogetherSince(p, anniversaries);
        } catch {
          return null;
        }
      },
      isEnabled: () => loadMilestoneCelebrationsEnabled(AsyncStorage),
      getActivePersonaId: async () => {
        try {
          return await personaStore.getActiveId();
        } catch {
          return null;
        }
      },
      loadLedger: () => loadMilestoneLedger(AsyncStorage),
      saveLedger: (ledger) => saveMilestoneLedger(AsyncStorage, ledger),
      sampleMemories: (limit) => sampleSharedMemories(limit),
      createRule: async (input) =>
        initiativeStore.create({
          personaId: input.personaId,
          title: input.title,
          topic: input.topic,
          type: "one_time",
          schedule: { kind: "one_time", atMs: input.atMs },
          target: { mode: "latest" },
        }),
      listRules: async () =>
        (await initiativeStore.list().catch(() => [])).map((r) => ({
          id: r.id,
          personaId: r.personaId,
          title: r.title,
          status: r.status,
        })),
      onRuleCreated: async (ruleId) => {
        const rule = await initiativeStore.get(ruleId).catch(() => null);
        if (rule) await rescheduleInitiativeRule(rule).catch(() => {});
      },
      nowMs: () => nowMs,
    });
  } catch {
    // Never break the initiative sweep.
  } finally {
    tickInFlight = false;
  }
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionMilestoneTools() {
  return createMilestoneTools({
    storage: AsyncStorage,
    initiativeStore,
    getActivePersonaId: async () => {
      try {
        return await personaStore.getActiveId();
      } catch {
        return null;
      }
    },
    archiveRule: async (ruleId: string) => {
      await initiativeStore.setStatus(ruleId, "archived").catch(() => {});
      await cancelInitiativeSchedule(ruleId).catch(() => {});
    },
    getDaysTogether: async () => {
      try {
        const p = await ourSpaceStore.getCoupleProfile();
        const anniversaries = await ourSpaceStore.listAnniversaries();
        const since = resolveTogetherSince(p, anniversaries);
        return { since, days: daysTogether(since, new Date()) };
      } catch {
        return { since: null, days: null };
      }
    },
  });
}
