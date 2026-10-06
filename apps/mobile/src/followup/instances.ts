/**
 * Memory-driven next-day follow-up （次日跟进） — app singletons and
 * production wiring.
 *
 * Delivery rides on the initiative engine: the backing one_time rule is
 * fired through fireInitiativeRule (daily cap, persona isolation, slot
 * ledger, AI generation, dialog delivery, trace — all enforced).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { crossDialogTraceStore } from "../chat/cross-dialog-instance";
import { type FireOutcome, fireInitiativeRule } from "../initiative/executor";
import {
  buildInitiativeDeps,
  cancelInitiativeSchedule,
  initiativeStore,
  rescheduleInitiativeRule,
} from "../initiative/instances";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import type { FollowupEngineDeps } from "./engine";
import { FollowupStore } from "./store";
import { createFollowupTools } from "./tools";

export const followupStore = new FollowupStore(AsyncStorage);

async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    return await personaStore.get(personaId);
  } catch {
    return null;
  }
}

/** Full production deps for the follow-up engine. Never throws. */
export async function buildFollowupEngineDeps(): Promise<FollowupEngineDeps> {
  const ideps = await buildInitiativeDeps();
  return {
    followupStore,
    storage: AsyncStorage,
    trace: crossDialogTraceStore,
    getPersona,
    fireRule: (ruleId: string, slotTime: number): Promise<FireOutcome> =>
      fireInitiativeRule(ideps, ruleId, slotTime),
    retireRule: async (ruleId: string): Promise<void> => {
      await initiativeStore.setStatus(ruleId, "archived").catch(() => {});
      await cancelInitiativeSchedule(ruleId).catch(() => {});
    },
    nowMs: () => Date.now(),
  };
}

/** One tick of the follow-up engine (called from the foreground loop). Never throws. */
export async function runFollowupTick(nowMs: number = Date.now()): Promise<void> {
  try {
    const { checkDueFollowups } = await import("./engine");
    const deps = await buildFollowupEngineDeps();
    await checkDueFollowups(deps, nowMs);
  } catch {
    // Never break the initiative sweep.
  }
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionFollowupTools() {
  return createFollowupTools({
    followupStore,
    initiativeStore,
    storage: AsyncStorage,
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
    onMutated: (rule) => rescheduleInitiativeRule(rule),
    onRetired: (ruleId) => cancelInitiativeSchedule(ruleId),
    nowMs: () => Date.now(),
  });
}
