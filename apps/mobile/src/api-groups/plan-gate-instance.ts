/**
 * App-wide singleton for the coordination plan gate (vision: 开启原则).
 *
 * Attaches AsyncStorage persistence to the PURE plan-gate singleton so
 * approved plans (and pending proposals) survive an app restart — without
 * it, an in-flight plan-gated meeting bricks on every restart (P1-9).
 * UI and AI tools import the store from here so both sides share the same
 * persisted plans; tests keep importing the PURE module directly.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isValidPlan, planGateStore, type CoordinationPlan } from "./plan-gate";

const PLAN_GATE_KEY = "dudu.plan-gate.v1";

planGateStore.attachPersistence({
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(PLAN_GATE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidPlan);
    } catch {
      return [];
    }
  },
  save: async (plans: CoordinationPlan[]) => {
    await AsyncStorage.setItem(PLAN_GATE_KEY, JSON.stringify(plans));
  },
});

// Hydrate at import time: tool calls only happen after user interaction,
// by which point this has resolved. Corrupt/empty storage loads as [].
void planGateStore.hydrate().catch(() => {});

export { planGateStore };
