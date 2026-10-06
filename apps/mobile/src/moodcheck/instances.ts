/**
 * Daily mood check-in （每日心情 check-in） — app singletons and
 * production wiring.
 *
 * Delivery rides on the initiative engine: the one_time check-in rule is
 * fired through fireInitiativeRule (daily cap, persona isolation, slot
 * ledger, AI generation, dialog delivery, trace — all enforced).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { crossDialogTraceStore } from "../chat/cross-dialog-instance";
import { type FireOutcome, fireInitiativeRule } from "../initiative/executor";
import {
  buildInitiativeDeps,
  initiativeStore,
  rescheduleInitiativeRule,
} from "../initiative/instances";
import { memoryStore } from "../memory/instance";
import { ourSpaceStore } from "../our-space/instance";
import { outreachStore } from "../outreach/instances";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import type { MoodcheckEngineDeps } from "./engine";
import { MoodcheckStore } from "./store";
import { createMoodcheckTools } from "./tools";

export const moodcheckStore = new MoodcheckStore(AsyncStorage);

async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    return await personaStore.get(personaId);
  } catch {
    return null;
  }
}

/** Full production deps for the mood check-in engine. Never throws. */
export async function buildMoodcheckEngineDeps(): Promise<MoodcheckEngineDeps> {
  const ideps = await buildInitiativeDeps();
  return {
    moodcheckStore,
    initiativeStore,
    listPersonas: async () => {
      try {
        const ps = await personaStore.list();
        return ps.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        return [];
      }
    },
    getPersona,
    fireRule: (ruleId: string, slotTime: number): Promise<FireOutcome> =>
      fireInitiativeRule(ideps, ruleId, slotTime),
    onMutated: (rule) => rescheduleInitiativeRule(rule),
    lastOpenedAt: async () => {
      try {
        return (await outreachStore.getLastOpenedAt()) ?? 0;
      } catch {
        return 0;
      }
    },
    trace: crossDialogTraceStore,
    nowMs: () => Date.now(),
  };
}

/** One tick of the mood check-in engine (called from the foreground loop). Never throws. */
export async function runMoodcheckTick(nowMs: number = Date.now()): Promise<void> {
  try {
    const { checkDueMoodcheck } = await import("./engine");
    const deps = await buildMoodcheckEngineDeps();
    await checkDueMoodcheck(deps, nowMs);
  } catch {
    // Never break the follow-up / initiative sweep.
  }
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionMoodcheckTools() {
  return createMoodcheckTools({
    moodcheckStore,
    setHerMood: (mood, note) => ourSpaceStore.setHerMood(mood, note),
    addMemory: (content, opts) => memoryStore.addMemory(content, opts),
    getPersona: async (personaId: string) => {
      const p = await getPersona(personaId);
      return p ? { id: p.id, name: p.name } : null;
    },
    listPersonas: async () => {
      try {
        const ps = await personaStore.list();
        return ps.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        return [];
      }
    },
    nowMs: () => Date.now(),
  });
}
