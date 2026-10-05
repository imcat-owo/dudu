/**
 * Proactive initiative （主动约定） — app singletons and production wiring.
 *
 * expo-notifications is loaded lazily (dynamic import) so this module stays
 * importable in node tests.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { groupStore } from "../api-groups/store";
import type { ApiGroup } from "../api-groups/types";
import { crossDialogTraceStore, crossDialogVisibilityStore } from "../chat/cross-dialog-instance";
import { outreachStore } from "../outreach/instances";
import type { NotificationPort } from "../outreach/notify";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import type { InitiativeSchedulerDeps } from "./scheduler";
import { InitiativeStore } from "./store";
import { createInitiativeTools } from "./tools";

export const initiativeStore = new InitiativeStore(AsyncStorage);

/** expo-notifications → NotificationPort. Lazy: safe to call in node tests. */
export async function createNotificationPort(): Promise<NotificationPort> {
  const m = await import("expo-notifications");
  return {
    getPermissionsAsync: () => m.getPermissionsAsync(),
    cancelScheduledNotificationAsync: (id: string) => m.cancelScheduledNotificationAsync(id),
    scheduleNotificationAsync: (req) =>
      m.scheduleNotificationAsync({
        identifier: req.identifier,
        content: req.content,
        trigger: {
          type: m.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: req.trigger.seconds,
        },
      }),
  };
}

async function getActiveGroup(): Promise<ApiGroup | null> {
  try {
    const snap = groupStore.getSnapshot();
    if (!snap.groups || snap.groups.length === 0) return null;
    return snap.groups.find((g) => g.id === snap.activeId) ?? snap.groups[0] ?? null;
  } catch {
    return null;
  }
}

async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    return await personaStore.get(personaId);
  } catch {
    return null;
  }
}

function personaDisplayName(persona: Persona): string {
  const n = persona.name?.trim();
  return n && n.length > 0 ? n : "嘟嘟";
}

/** Full production deps for the scheduler/executor. Never throws. */
export async function buildInitiativeDeps(): Promise<InitiativeSchedulerDeps> {
  const notifications = await createNotificationPort().catch(
    () =>
      ({
        getPermissionsAsync: async () => ({ status: "denied" }),
        cancelScheduledNotificationAsync: async () => {},
        scheduleNotificationAsync: async () => "",
      }) as NotificationPort,
  );
  return {
    initiativeStore,
    outreachStore,
    storage: AsyncStorage,
    trace: crossDialogTraceStore,
    visibility: crossDialogVisibilityStore,
    notifications,
    getActiveGroup,
    generateText: async (group, systemPrompt, userPrompt) => {
      const { generateOneShot } = await import("../chat/group-meeting-tools");
      return generateOneShot(group, systemPrompt, userPrompt, { timeoutMs: 60_000 });
    },
    getPersona,
    personaDisplayName,
    nowMs: () => Date.now(),
  };
}

/** Manual fire of a rule right now (slot = now). Used by the UI and AI tools. */
export async function fireInitiativeNow(ruleId: string) {
  const { fireInitiativeRule } = await import("./executor");
  const deps = await buildInitiativeDeps();
  return fireInitiativeRule(deps, ruleId, Date.now());
}

/** Re-arm a rule's pre-scheduled notification after create/update/restore. */
export async function rescheduleInitiativeRule(
  rule: import("./rules").InitiativeRule,
): Promise<void> {
  const { ensureScheduled } = await import("./scheduler");
  const deps = await buildInitiativeDeps();
  await ensureScheduled(deps, rule);
}

/** Disarm a rule's pre-scheduled notification after archive/delete. */
export async function cancelInitiativeSchedule(ruleId: string): Promise<void> {
  const { cancelScheduled } = await import("./scheduler");
  const port = await createNotificationPort();
  await cancelScheduled(port, ruleId);
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionInitiativeTools() {
  return createInitiativeTools({
    initiativeStore,
    getPersona,
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
    fireNow: (ruleId) => fireInitiativeNow(ruleId),
    nowMs: () => Date.now(),
  });
}
